import { useEffect, useState, useCallback, useRef } from "react";
import { debugInvoke as invoke } from "../lib/debugInvoke";
import { addDebugLog } from "../lib/debugLogBuffer";
import { useAppStore } from "../stores/appStore";
import { escapeShellSingleQuote } from "../lib/shell";

// ---------- Preview types ----------

interface PreviewState {
  fileName: string | null;
  content: string | null;
  loading: boolean;
  error: string | null;
  isText: boolean;
  mimeType: string | null;
  fileSize: string;
}

// ---------- Types ----------

interface FileEntry {
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  size: string;
  date: string;
  permissions: string;
}

interface ExplorerBlockProps {
  blockId: string;
  visible: boolean;
  remotePath?: string;
  workspace: string;
}

// ---------- Constants ----------

/** MIME types we treat as previewable text. */
const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/javascript",
  "application/xml",
  "application/x-yaml",
  "application/x-sh",
  "application/x-shellscript",
  "application/x-ruby",
  "application/x-perl",
  "application/x-python",
  "application/toml",
  "application/x-toml",
  "inode/x-empty",
]);

/** Files above this size (bytes) get a warning instead of fetching content. */
const MAX_PREVIEW_SIZE = 1_048_576; // 1 MB

/** Max bytes fetched for text preview. */
const PREVIEW_BYTE_LIMIT = 50_000;

// ---------- Helpers ----------

/** Map file extension to an emoji icon. */
function fileIcon(name: string, isDir: boolean, isSymlink: boolean): string {
  if (isDir) return "📁";
  if (isSymlink) return "🔗";
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
      return "📜";
    case "md":
    case "mdx":
    case "txt":
      return "📝";
    case "json":
    case "yaml":
    case "yml":
    case "toml":
      return "⚙️";
    case "rs":
      return "🦀";
    case "sh":
    case "bash":
    case "zsh":
      return "🔧";
    case "py":
      return "🐍";
    case "css":
    case "scss":
    case "less":
      return "🎨";
    case "html":
    case "htm":
      return "🌐";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return "🖼️";
    case "lock":
      return "🔒";
    default:
      return "📄";
  }
}

/** Format byte size to human-readable string. */
function humanSize(sizeStr: string): string {
  const bytes = parseInt(sizeStr, 10);
  if (isNaN(bytes)) return sizeStr;
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/**
 * Parse a single line of `ls -la` output into a FileEntry.
 * Expected format: permissions links owner group size month day time name
 * Returns null for lines that can't be parsed or should be skipped (., .., total).
 */
function parseLsLine(line: string): FileEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Skip the "total N" line
  if (trimmed.startsWith("total ")) return null;

  // ls -la fields: permissions, links, owner, group, size, month, day, time/year, name...
  // We need at least 9 fields; name can contain spaces
  const parts = trimmed.split(/\s+/);
  if (parts.length < 9) return null;

  const permissions = parts[0];
  // Skip . and .. entries
  const name = parts.slice(8).join(" ");
  // For symlinks, ls shows "name -> target" — extract just the name
  const displayName = name.includes(" -> ") ? name.split(" -> ")[0] : name;
  if (displayName === "." || displayName === "..") return null;

  const firstChar = permissions.charAt(0);
  const isDir = firstChar === "d";
  const isSymlink = firstChar === "l";
  const size = parts[4];
  const date = `${parts[5]} ${parts[6]} ${parts[7]}`;

  return { name: displayName, isDir, isSymlink, size, date, permissions };
}

/**
 * Resolve a new path from current path + clicked segment.
 * Handles ".." for up navigation and normalizes slashes.
 */
function resolvePath(current: string, segment: string): string {
  if (segment === "..") {
    const parts = current.replace(/\/+$/, "").split("/");
    parts.pop();
    return parts.length <= 1 ? "/" : parts.join("/");
  }
  const base = current.endsWith("/") ? current : current + "/";
  return base + segment;
}

/** Split a path into breadcrumb segments. */
function pathSegments(path: string): { label: string; path: string }[] {
  const segments: { label: string; path: string }[] = [{ label: "/", path: "/" }];
  const parts = path.split("/").filter(Boolean);
  let accumulated = "";
  for (const part of parts) {
    accumulated += "/" + part;
    segments.push({ label: part, path: accumulated });
  }
  return segments;
}

/** Check whether a MIME type is considered previewable text. */
function isTextMime(mime: string): boolean {
  const trimmed = mime.trim().toLowerCase();
  if (TEXT_MIME_EXACT.has(trimmed)) return true;
  return TEXT_MIME_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

// ---------- Component ----------

export default function ExplorerBlock({
  blockId,
  visible,
  remotePath,
  workspace,
}: ExplorerBlockProps) {
  const [currentPath, setCurrentPath] = useState(remotePath || "/home");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({
    fileName: null,
    content: null,
    loading: false,
    error: null,
    isText: true,
    mimeType: null,
    fileSize: "0",
  });
  const updateBlock = useAppStore((s) => s.updateBlock);
  const addBlock = useAppStore((s) => s.addBlock);
  const connection = useAppStore((s) => s.connection);
  const mountedRef = useRef(true);
  const fetchIdRef = useRef(0);

  /** Fetch directory listing for a given path. */
  const fetchListing = useCallback(
    async (path: string) => {
      const fetchId = ++fetchIdRef.current;
      setLoading(true);
      setError(null);

      addDebugLog(`[ExplorerBlock:${blockId}] fetching listing for '${path}' on ${workspace}`);

      try {
        const escapedPath = escapeShellSingleQuote(path);
        const command = `ls -la --group-directories-first '${escapedPath}'`;
        const output = await invoke<string>("exec_in_workspace", {
          workspace,
          command,
        });

        // Stale response guard — a newer fetch was triggered
        if (fetchId !== fetchIdRef.current || !mountedRef.current) return;

        const lines = output.split("\n");
        const parsed: FileEntry[] = [];
        for (const line of lines) {
          const entry = parseLsLine(line);
          if (entry) parsed.push(entry);
        }

        setEntries(parsed);
        setLoading(false);
        addDebugLog(
          `[ExplorerBlock:${blockId}] fetched ${parsed.length} entries for '${path}'`
        );
      } catch (err) {
        if (fetchId !== fetchIdRef.current || !mountedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setEntries([]);
        setLoading(false);
        addDebugLog(
          `[ExplorerBlock:${blockId}] fetch error path='${path}' cmd='ls -la' err='${msg}'`
        );
      }
    },
    [blockId, workspace]
  );

  /** Navigate to a new directory. */
  const navigateTo = useCallback(
    (newPath: string) => {
      setCurrentPath(newPath);
      updateBlock(blockId, { remotePath: newPath });
    },
    [blockId, updateBlock]
  );

  /** Preview a file — detect binary, fetch text content, handle large/empty files. */
  const handleFilePreview = useCallback(
    async (entry: FileEntry) => {
      const fullPath = currentPath.endsWith("/")
        ? currentPath + entry.name
        : currentPath + "/" + entry.name;
      const escapedPath = escapeShellSingleQuote(fullPath);

      addDebugLog(
        `[ExplorerBlock:${blockId}] preview start file='${entry.name}' size=${entry.size}`
      );

      // Check file size — if > 1MB, show warning without fetching
      const sizeBytes = parseInt(entry.size, 10);
      if (!isNaN(sizeBytes) && sizeBytes > MAX_PREVIEW_SIZE) {
        setPreview({
          fileName: entry.name,
          content: null,
          loading: false,
          error: `File too large to preview (${humanSize(entry.size)})`,
          isText: false,
          mimeType: null,
          fileSize: entry.size,
        });
        addDebugLog(
          `[ExplorerBlock:${blockId}] preview skip — file too large (${humanSize(entry.size)})`
        );
        return;
      }

      // Start loading
      setPreview({
        fileName: entry.name,
        content: null,
        loading: true,
        error: null,
        isText: true,
        mimeType: null,
        fileSize: entry.size,
      });

      // Step 1: detect MIME type
      let detectedMime = "text/plain";
      try {
        const mimeOutput = await invoke<string>("exec_in_workspace", {
          workspace,
          command: `file --mime-type -b '${escapedPath}'`,
        });
        detectedMime = mimeOutput.trim();
        addDebugLog(
          `[ExplorerBlock:${blockId}] preview mime='${detectedMime}' file='${entry.name}'`
        );
      } catch {
        // On error/timeout, assume text and try to preview anyway
        addDebugLog(
          `[ExplorerBlock:${blockId}] preview mime detection failed, assuming text`
        );
      }

      if (!mountedRef.current) return;

      const textFile = isTextMime(detectedMime);

      if (!textFile) {
        // Binary file — show metadata, no content fetch
        setPreview({
          fileName: entry.name,
          content: null,
          loading: false,
          error: null,
          isText: false,
          mimeType: detectedMime,
          fileSize: entry.size,
        });
        addDebugLog(
          `[ExplorerBlock:${blockId}] preview binary file='${entry.name}' mime='${detectedMime}'`
        );
        return;
      }

      // Step 2: fetch text content (first 50KB)
      try {
        const content = await invoke<string>("exec_in_workspace", {
          workspace,
          command: `head -c ${PREVIEW_BYTE_LIMIT} '${escapedPath}'`,
        });
        if (!mountedRef.current) return;

        setPreview({
          fileName: entry.name,
          content: content.length === 0 ? null : content,
          loading: false,
          error: content.length === 0 ? "Empty file" : null,
          isText: true,
          mimeType: detectedMime,
          fileSize: entry.size,
        });
        addDebugLog(
          `[ExplorerBlock:${blockId}] preview loaded file='${entry.name}' bytes=${content.length}`
        );
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setPreview({
          fileName: entry.name,
          content: null,
          loading: false,
          error: `Failed to read file: ${msg}`,
          isText: true,
          mimeType: detectedMime,
          fileSize: entry.size,
        });
        addDebugLog(
          `[ExplorerBlock:${blockId}] preview error file='${entry.name}' err='${msg}'`
        );
      }
    },
    [blockId, currentPath, workspace]
  );

  /** Handle clicking a directory or file entry. */
  const handleEntryClick = useCallback(
    (entry: FileEntry) => {
      if (entry.isDir || entry.isSymlink) {
        navigateTo(resolvePath(currentPath, entry.name));
        return;
      }
      // File click — open preview
      handleFilePreview(entry);
    },
    [currentPath, handleFilePreview, navigateTo]
  );

  /** Close the preview panel. */
  const closePreview = useCallback(() => {
    setPreview((prev) => ({ ...prev, fileName: null, content: null, error: null }));
  }, []);

  /** Open a terminal block cd'd to the current directory. */
  const handleOpenTerminalHere = useCallback(() => {
    const dirName = currentPath.split("/").filter(Boolean).pop() || "/";
    const termId = `term-${Date.now()}`;
    addBlock({
      id: termId,
      type: "terminal",
      workspace,
      project: currentPath,
      title: `📁 ${dirName}`,
      isActive: true,
    });
    addDebugLog(
      `[ExplorerBlock:${blockId}] open-terminal-here path='${currentPath}' blockId='${termId}'`
    );
  }, [addBlock, blockId, currentPath, workspace]);

  /** Navigate up one level. */
  const handleUp = useCallback(() => {
    navigateTo(resolvePath(currentPath, ".."));
  }, [currentPath, navigateTo]);

  /** Refresh current directory. */
  const handleRefresh = useCallback(() => {
    addDebugLog(`[ExplorerBlock:${blockId}] refresh`);
    fetchListing(currentPath);
  }, [blockId, currentPath, fetchListing]);

  // Fetch listing whenever currentPath changes
  useEffect(() => {
    mountedRef.current = true;
    fetchListing(currentPath);
    return () => {
      mountedRef.current = false;
    };
  }, [currentPath, fetchListing]);

  if (!visible) return null;

  // Not connected state
  if (connection.status !== "connected") {
    return (
      <div className="flex items-center justify-center h-full bg-[#141a14] text-base-muted">
        <div className="text-center px-4">
          <span className="text-2xl">🔌</span>
          <p className="text-sm mt-2">SSH not connected</p>
          <p className="text-xs mt-1 text-base-muted">
            Connect to a Coder instance to browse files
          </p>
        </div>
      </div>
    );
  }

  const breadcrumbs = pathSegments(currentPath);
  const isRoot = currentPath === "/";

  return (
    <div className="flex flex-col h-full bg-[#141a14] text-sm">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 h-9 border-b border-base-border bg-[#1a201a] shrink-0">
        {/* Up button */}
        <button
          type="button"
          className="px-1.5 py-0.5 text-sm text-base-muted rounded hover:bg-[#2a302a] hover:text-base-fg disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={handleUp}
          disabled={isRoot || loading}
          title="Parent directory"
        >
          ↑
        </button>
        {/* Refresh button */}
        <button
          type="button"
          className="px-1.5 py-0.5 text-sm text-base-muted rounded hover:bg-[#2a302a] hover:text-base-fg disabled:opacity-30"
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh"
        >
          ↻
        </button>
        {/* Open terminal here */}
        <button
          type="button"
          className="px-1.5 py-0.5 text-sm text-base-muted rounded hover:bg-[#2a302a] hover:text-base-fg"
          onClick={handleOpenTerminalHere}
          title="Open terminal here"
        >
          &gt;_
        </button>
        {/* Breadcrumb bar */}
        <div className="flex-1 flex items-center gap-0.5 overflow-x-auto text-xs ml-1.5 scrollbar-none">
          {breadcrumbs.map((seg, i) => (
            <span key={seg.path} className="flex items-center shrink-0">
              {i > 0 && <span className="text-base-muted mx-0.5">/</span>}
              <button
                type="button"
                className={`px-1 py-0.5 rounded hover:bg-[#2a302a] hover:text-base-fg ${
                  i === breadcrumbs.length - 1
                    ? "text-base-fg font-medium"
                    : "text-base-muted"
                }`}
                onClick={() => navigateTo(seg.path)}
                disabled={loading}
              >
                {seg.label}
              </button>
            </span>
          ))}
        </div>
        {/* Loading spinner in toolbar */}
        {loading && (
          <div className="w-3.5 h-3.5 border-2 border-base-muted border-t-transparent rounded-full animate-spin shrink-0" />
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto relative">
        {/* Error state */}
        {error && !loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-4">
              <span className="text-2xl">⚠️</span>
              <p className="text-sm mt-2 text-red-400">Failed to list directory</p>
              <p className="text-xs mt-1 text-base-muted max-w-xs break-words">
                {error}
              </p>
              <button
                type="button"
                className="mt-3 px-3 py-1 text-xs bg-[#2a302a] text-base-fg rounded hover:bg-[#353b35]"
                onClick={handleRefresh}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Empty directory state */}
        {!error && !loading && entries.length === 0 && (
          <div className="flex items-center justify-center h-full text-base-muted">
            <div className="text-center">
              <span className="text-2xl">📂</span>
              <p className="text-sm mt-2">Empty directory</p>
            </div>
          </div>
        )}

        {/* File listing */}
        {!error && entries.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#1a201a] text-base-muted border-b border-base-border">
              <tr>
                <th className="text-left py-1 pl-3 pr-2 font-medium">Name</th>
                <th className="text-right py-1 px-2 font-medium w-20">Size</th>
                <th className="text-right py-1 px-2 pr-3 font-medium w-28">Modified</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.name}
                  className="border-b border-base-border/30 hover:bg-[#1e241e] cursor-pointer"
                  onClick={() => handleEntryClick(entry)}
                >
                  <td className="py-1 pl-3 pr-2 truncate max-w-0">
                    <span className="mr-1.5">{fileIcon(entry.name, entry.isDir, entry.isSymlink)}</span>
                    <span className={entry.isDir ? "text-base-fg" : "text-base-muted"}>
                      {entry.name}
                    </span>
                    {entry.isSymlink && (
                      <span className="text-base-muted ml-1 text-[10px]">→</span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-right text-base-muted whitespace-nowrap">
                    {entry.isDir ? "—" : humanSize(entry.size)}
                  </td>
                  <td className="py-1 px-2 pr-3 text-right text-base-muted whitespace-nowrap">
                    {entry.date}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Loading overlay */}
        {loading && entries.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-base-muted border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Preview panel — slides up from bottom when a file is selected */}
      {preview.fileName && (
        <div className="shrink-0 border-t border-base-border bg-[#1a201a] max-h-[45%] flex flex-col">
          {/* Preview header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-base-border/50 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-medium text-base-fg truncate">
                {preview.fileName}
              </span>
              <span className="text-[10px] text-base-muted shrink-0">
                {humanSize(preview.fileSize)}
                {preview.mimeType && ` · ${preview.mimeType}`}
              </span>
            </div>
            <button
              type="button"
              className="ml-2 px-1.5 py-0.5 text-xs text-base-muted rounded hover:bg-[#2a302a] hover:text-base-fg shrink-0"
              onClick={closePreview}
              title="Close preview"
            >
              ✕
            </button>
          </div>

          {/* Preview content */}
          <div className="flex-1 overflow-auto p-3">
            {/* Loading state */}
            {preview.loading && (
              <div className="flex items-center justify-center py-6">
                <div className="w-4 h-4 border-2 border-base-muted border-t-transparent rounded-full animate-spin" />
                <span className="ml-2 text-xs text-base-muted">Loading preview…</span>
              </div>
            )}

            {/* Error / warning state */}
            {!preview.loading && preview.error && (
              <div className="text-center py-4">
                <span className="text-lg">
                  {preview.error.startsWith("File too large") ? "📦" : preview.error === "Empty file" ? "📄" : "⚠️"}
                </span>
                <p className="text-xs mt-1 text-base-muted">{preview.error}</p>
              </div>
            )}

            {/* Binary file metadata */}
            {!preview.loading && !preview.error && !preview.isText && (
              <div className="text-center py-4">
                <span className="text-lg">🔒</span>
                <p className="text-xs mt-1.5 text-base-muted">
                  Binary file — cannot preview
                </p>
                <p className="text-[10px] mt-1 text-base-muted">
                  {preview.mimeType} · {humanSize(preview.fileSize)}
                </p>
              </div>
            )}

            {/* Text content */}
            {!preview.loading && !preview.error && preview.isText && preview.content && (
              <pre className="text-xs text-base-muted font-mono whitespace-pre-wrap break-words leading-relaxed">
                {preview.content}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
