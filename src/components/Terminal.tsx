import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { debugInvoke as invoke } from "../lib/debugInvoke";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../stores/appStore";
import { sanitizeShellArg } from "../lib/shell";
import "@xterm/xterm/css/xterm.css";

interface Props {
  tabId: string;
  workspace: string;
  project: string;
  visible: boolean;
  tmuxSession?: string;
}

function tmuxSessionName(_tabId: string, project: string): string {
  return `gsd-term-${sanitizeShellArg(project)}`;
}

interface ContextMenuState {
  x: number;
  y: number;
}

/**
 * Manually compute cols/rows from container rect and xterm cell dimensions.
 * This bypasses FitAddon entirely — FitAddon's parentElement measurement
 * is unreliable with absolute/relative positioning chains.
 */
function fitTerminal(
  term: XTerm,
  container: HTMLDivElement,
  tabId: string,
  connected: boolean,
  lastCols: React.MutableRefObject<number>,
  lastRows: React.MutableRefObject<number>,
) {
  const core = (term as any)._core;
  if (!core?._renderService?.dimensions) return;

  const cellWidth = core._renderService.dimensions.css.cell.width;
  const cellHeight = core._renderService.dimensions.css.cell.height;
  if (!cellWidth || !cellHeight) return;

  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  // Account for scrollbar width
  const scrollbarWidth = core.viewport?.scrollBarWidth ?? 0;
  const cols = Math.max(2, Math.floor((rect.width - scrollbarWidth) / cellWidth));
  const rows = Math.max(1, Math.floor(rect.height / cellHeight));

  if (cols === term.cols && rows === term.rows) return;

  term.resize(cols, rows);
  lastCols.current = cols;
  lastRows.current = rows;

  if (connected) {
    invoke("terminal_resize", { id: tabId, cols, rows }).catch(() => {});
  }
}

function Terminal({ tabId, workspace, project, visible, tmuxSession: tmuxSessionProp }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const connectedRef = useRef(false);
  const connectingRef = useRef(false);
  const mountedRef = useRef(true);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastColsRef = useRef(0);
  const lastRowsRef = useRef(0);
  const updateTerminalTabRef = useRef(useAppStore.getState().updateTerminalTab);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    updateTerminalTabRef.current = useAppStore.getState().updateTerminalTab;
  });

  // Debounced fit — used by resize observers and window events
  const debouncedFit = useCallback(() => {
    if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    fitTimerRef.current = setTimeout(() => {
      const container = containerRef.current;
      const term = terminalRef.current;
      if (!container || !term) return;
      fitTerminal(term, container, tabId, connectedRef.current, lastColsRef, lastRowsRef);
    }, 50);
  }, [tabId]);

  // Re-fit when tab becomes visible
  useEffect(() => {
    if (!visible || !terminalRef.current || !containerRef.current) return;
    const raf = requestAnimationFrame(() => debouncedFit());
    return () => cancelAnimationFrame(raf);
  }, [visible, debouncedFit]);

  // Copy — xterm selection first, then tmux paste buffer
  const handleCopy = useCallback(async () => {
    const term = terminalRef.current;
    if (!term) { setContextMenu(null); return; }
    const sel = term.getSelection();
    if (sel) {
      navigator.clipboard.writeText(sel).catch(() => {});
      setContextMenu(null);
      return;
    }
    try {
      const buf = await invoke<string>("exec_in_workspace", {
        workspace,
        command: `tmux show-buffer 2>/dev/null || true`,
      });
      if (buf?.trim()) navigator.clipboard.writeText(buf.trim()).catch(() => {});
    } catch { /* ignore */ }
    setContextMenu(null);
  }, [workspace]);

  // Paste
  const handlePaste = useCallback(() => {
    navigator.clipboard.readText().then((text) => {
      if (!text || !connectedRef.current) return;
      const encoded = new TextEncoder().encode(text);
      invoke("terminal_write", { id: tabId, data: Array.from(encoded) }).catch(() => {});
    }).catch(() => {});
    setContextMenu(null);
  }, [tabId]);

  const handleSelectAll = useCallback(() => {
    terminalRef.current?.selectAll();
    setContextMenu(null);
  }, []);

  const handleClear = useCallback(() => {
    terminalRef.current?.clear();
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    mountedRef.current = true;
    connectedRef.current = false;
    connectingRef.current = false;

    const term = new XTerm({
      fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      allowTransparency: false,
      scrollOnUserInput: true,
      fastScrollModifier: "alt",
      convertEol: false,
      rightClickSelectsWord: true,
      theme: {
        background: "#141a14",
        foreground: "#c8cdd8",
        cursor: "#f97316",
        selectionBackground: "rgba(249, 115, 22, 0.3)",
        black: "#141a14",
        red: "#ef4444",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#c8cdd8",
        brightBlack: "#5a6478",
        brightRed: "#f87171",
        brightGreen: "#6ee7b7",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f1f5f9",
      },
    });

    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    terminalRef.current = term;

    // --- Fit: retry until cell dimensions are ready ---
    const doFit = () => {
      const el = containerRef.current;
      if (!el || !term) return false;
      const core = (term as any)._core;
      const cellW = core?._renderService?.dimensions?.css?.cell?.width;
      if (!cellW) return false;
      fitTerminal(term, el, tabId, connectedRef.current, lastColsRef, lastRowsRef);
      return true;
    };

    const retryFit = (n: number, ms: number) => {
      if (!mountedRef.current || n <= 0) return;
      if (doFit()) return;
      setTimeout(() => retryFit(n - 1, ms * 1.5), ms);
    };

    // Wait for fonts, then retry fit
    (document.fonts?.ready ?? Promise.resolve()).then(() => {
      requestAnimationFrame(() => retryFit(15, 30));
    });

    // Re-fit on font swap
    const onFontChange = () => debouncedFit();
    document.fonts?.addEventListener?.("loadingdone", onFontChange);

    // --- Context menu: block native, show custom ---
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    };
    const containerEl = containerRef.current;
    containerEl.addEventListener("contextmenu", handleContextMenu);

    // --- Keyboard: Cmd+C copy, Cmd+V paste ---
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        const sel = term.getSelection();
        if (sel) {
          e.preventDefault();
          navigator.clipboard.writeText(sel).catch(() => {});
          return;
        }
        if (e.metaKey) {
          e.preventDefault();
          invoke<string>("exec_in_workspace", {
            workspace,
            command: `tmux show-buffer 2>/dev/null || true`,
          }).then((buf) => {
            if (buf?.trim()) navigator.clipboard.writeText(buf.trim()).catch(() => {});
          }).catch(() => {});
          return;
        }
      }
      if ((e.metaKey && e.key === "v") || (e.ctrlKey && e.shiftKey && e.key === "V")) {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (!text || !connectedRef.current) return;
          const encoded = new TextEncoder().encode(text);
          invoke("terminal_write", { id: tabId, data: Array.from(encoded) }).catch(() => {});
        }).catch(() => {});
      }
    };
    containerEl.addEventListener("keydown", handleKeyDown, true);

    // --- Data listeners ---
    const unlistenData = listen<number[]>(`terminal_data_${tabId}`, (event) => {
      if (mountedRef.current) term.write(new Uint8Array(event.payload));
    });

    const unlistenClose = listen(`terminal_closed_${tabId}`, () => {
      if (mountedRef.current) {
        term.writeln("\r\n\x1b[38;5;242m[Connection closed — press any key to reconnect]\x1b[0m");
        connectedRef.current = false;
        connectingRef.current = false;
      }
    });

    // --- Connect ---
    const tmuxName = sanitizeShellArg(tmuxSessionProp || tmuxSessionName(tabId, project));
    const safeProject = sanitizeShellArg(project);

    const connect = async () => {
      if (!mountedRef.current || connectingRef.current) return;
      connectingRef.current = true;

      term.writeln(`\x1b[38;5;208mGSD Control Terminal\x1b[0m`);
      term.writeln(`\x1b[38;5;242mWorkspace: ${workspace} · Project: ${project}\x1b[0m`);
      term.writeln(`\x1b[38;5;242mConnecting...\x1b[0m`);

      try {
        await invoke("terminal_close", { id: tabId }).catch(() => {});

        const checkResult = await invoke<string>("exec_in_workspace", {
          workspace,
          command: `tmux has-session -t ${tmuxName} 2>/dev/null && echo exists || echo missing`,
        });

        if (checkResult.trim() === "exists") {
          term.writeln(`\x1b[38;5;242mReattaching to session: ${tmuxName}\x1b[0m`);
        } else {
          term.writeln(`\x1b[38;5;242mCreating session: ${tmuxName}\x1b[0m`);
          await invoke("exec_in_workspace", {
            workspace,
            command: `tmux new-session -d -s ${tmuxName} -c ~/${safeProject}`,
          });
        }

        updateTerminalTabRef.current(tabId, { tmuxSession: tmuxName });

        // tmux mouse on for scroll wheel; Shift+drag for xterm selection
        await invoke("exec_in_workspace", {
          workspace,
          command: `tmux set-option -t ${tmuxName} mouse on 2>/dev/null; true`,
        });

        term.writeln("");
        if (!mountedRef.current) { connectingRef.current = false; return; }

        await invoke("terminal_open_tmux", {
          id: tabId,
          workspace,
          tmuxSession: tmuxName,
        });

        if (!mountedRef.current) { connectingRef.current = false; return; }
        connectedRef.current = true;
        connectingRef.current = false;

        term.reset();

        // Fit after connect — multiple passes
        requestAnimationFrame(() => {
          doFit();
          setTimeout(doFit, 100);
          setTimeout(doFit, 300);
          setTimeout(doFit, 1000);
        });
      } catch (e) {
        connectingRef.current = false;
        if (!mountedRef.current) return;
        console.error(`Terminal ${tabId}: connection failed —`, e);
        term.writeln(`\x1b[38;5;196mConnection failed: ${e}\x1b[0m`);
        term.writeln(`\x1b[38;5;242mPress any key to retry...\x1b[0m`);
      }
    };

    connect();

    // --- Input ---
    term.onData((data) => {
      if (!connectedRef.current) {
        if (!connectingRef.current) connect();
        return;
      }
      const filtered = data.replace(/\x1b\[\??[\d;]*c/g, "").replace(/\x1b\[>[\d;]*c/g, "");
      if (!filtered) return;
      const encoded = new TextEncoder().encode(filtered);
      invoke("terminal_write", { id: tabId, data: Array.from(encoded) }).catch(() => {});
    });

    // --- Resize observers ---
    const resizeObserver = new ResizeObserver(() => debouncedFit());
    resizeObserver.observe(containerEl);

    const handleWindowResize = () => debouncedFit();
    window.addEventListener("resize", handleWindowResize);

    // Re-render on app resume from minimize
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && terminalRef.current) {
        terminalRef.current.refresh(0, terminalRef.current.rows - 1);
        debouncedFit();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const handleFocus = () => {
      if (terminalRef.current) {
        terminalRef.current.refresh(0, terminalRef.current.rows - 1);
        debouncedFit();
      }
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      mountedRef.current = false;
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      document.fonts?.removeEventListener?.("loadingdone", onFontChange);
      containerEl.removeEventListener("contextmenu", handleContextMenu);
      containerEl.removeEventListener("keydown", handleKeyDown, true);
      unlistenData.then((fn) => fn());
      unlistenClose.then((fn) => fn());
      invoke("terminal_close", { id: tabId }).catch(() => {});
      term.dispose();
      terminalRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, workspace, project, tmuxSessionProp]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
      className="bg-[#141a14] overflow-hidden"
      onClick={() => setContextMenu(null)}
    >
      {/* Custom context menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
        >
          <div
            className="absolute bg-base-surface border border-base-border rounded-lg shadow-xl py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleCopy}
              className="w-full text-left px-3 py-1.5 text-xs text-base-text hover:bg-base-bg transition-colors flex items-center justify-between"
            >
              <span>Copy</span>
              <span className="text-base-muted ml-4">⌘C</span>
            </button>
            <button
              onClick={handlePaste}
              className="w-full text-left px-3 py-1.5 text-xs text-base-text hover:bg-base-bg transition-colors flex items-center justify-between"
            >
              <span>Paste</span>
              <span className="text-base-muted ml-4">⌘V</span>
            </button>
            <div className="border-t border-base-border my-1" />
            <button
              onClick={handleSelectAll}
              className="w-full text-left px-3 py-1.5 text-xs text-base-text hover:bg-base-bg transition-colors flex items-center justify-between"
            >
              <span>Select All</span>
              <span className="text-base-muted ml-4">⌘A</span>
            </button>
            <button
              onClick={handleClear}
              className="w-full text-left px-3 py-1.5 text-xs text-base-text hover:bg-base-bg transition-colors"
            >
              Clear Terminal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Terminal;
