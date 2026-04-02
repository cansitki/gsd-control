import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import type { ViewMode, TerminalTab } from "../lib/types";
import { sanitizeShellArg } from "../lib/shell";

function AddProjectModal({
  workspace,
  onClose,
}: {
  workspace: { coderName: string; displayName: string };
  onClose: () => void;
}) {
  const addProject = useAppStore((s) => s.addProject);
  const workspaces = useAppStore((s) => s.workspaces);
  const [folderName, setFolderName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const folder = folderName.trim();
    const display = displayName.trim() || folder;
    if (!folder) {
      setStatus("Folder name required");
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(folder)) {
      setStatus("Use only letters, numbers, dashes, dots, underscores");
      return;
    }

    // Check if project is already in the sidebar
    const ws = workspaces.find((w) => w.coderName === workspace.coderName);
    if (ws?.projects.some((p) => p.path === folder)) {
      setStatus("Project already exists in this workspace");
      return;
    }

    setCreating(true);
    setStatus("Adding...");
    try {
      // Add to store first, then check/create on remote
      addProject(workspace.coderName, { path: folder, displayName: display });

      // Try to create the folder if it doesn't exist (best-effort)
      try {
        await invoke("exec_in_workspace", {
          workspace: workspace.coderName,
          command: `test -d ~/${sanitizeShellArg(folder)} || mkdir -p ~/${sanitizeShellArg(folder)}`,
        });
      } catch {
        // Remote not reachable — project still added to sidebar
      }

      onClose();
    } catch (e) {
      setStatus(`Failed: ${String(e)}`);
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-base-surface border border-base-border rounded-lg p-5 w-80 shadow-xl">
        <h3 className="text-xs font-bold text-base-text mb-4">
          Add Project to {workspace.displayName}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-base-muted mb-1">
              Folder name (on workspace)
            </label>
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g. bmu-info"
              className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <div>
            <label className="block text-xs text-base-muted mb-1">
              Display name (optional)
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={folderName || "e.g. my-project"}
              className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          {status && (
            <p className="text-xs text-accent-red">{status}</p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="text-xs px-3 py-1.5 rounded bg-accent-orange text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadModal({
  workspace,
  project,
  onClose,
}: {
  workspace: string;
  project: { path: string; displayName: string };
  onClose: () => void;
}) {
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const uploaded: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setStatus(`Uploading ${file.name}... (${i + 1}/${files.length})`);

      try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        // Convert to base64
        let binary = "";
        for (let j = 0; j < bytes.length; j++) {
          binary += String.fromCharCode(bytes[j]);
        }
        const base64 = btoa(binary);

        await invoke("upload_file", {
          workspace,
          projectPath: project.path,
          fileName: file.name,
          fileDataBase64: base64,
        });
        uploaded.push(file.name);
      } catch (err) {
        setStatus(`Failed to upload ${file.name}: ${err}`);
        setUploading(false);
        return;
      }
    }

    setUploadedFiles((prev) => [...prev, ...uploaded]);
    setStatus(`✓ Uploaded ${uploaded.length} file(s)`);
    setUploading(false);
    // Reset input
    e.target.value = "";
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-base-surface border border-base-border rounded-lg p-5 w-96 shadow-xl">
        <h3 className="text-xs font-bold text-base-text mb-1">
          Upload Files
        </h3>
        <p className="text-xs text-base-muted mb-4">
          to ~/{project.path}/ on {workspace}
        </p>

        <label
          className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${
            uploading
              ? "border-base-border bg-base-bg/50 cursor-wait"
              : "border-base-border hover:border-accent-orange/50 bg-base-bg"
          }`}
        >
          <svg
            className="w-8 h-8 text-base-muted mb-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <span className="text-xs text-base-muted">
            {uploading ? "Uploading..." : "Click to select files"}
          </span>
          <input
            type="file"
            multiple
            onChange={handleFileSelect}
            disabled={uploading}
            className="hidden"
          />
        </label>

        {uploadedFiles.length > 0 && (
          <div className="mt-3 space-y-1">
            {uploadedFiles.map((f) => (
              <div
                key={f}
                className="text-xs text-accent-green flex items-center gap-1.5"
              >
                <span>✓</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        )}

        {status && (
          <p
            className={`text-xs mt-2 ${
              status.startsWith("✓") ? "text-accent-green" : status.startsWith("Failed") ? "text-accent-red" : "text-base-muted"
            }`}
          >
            {status}
          </p>
        )}

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            disabled={uploading}
            className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors disabled:opacity-50"
          >
            {uploadedFiles.length > 0 ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddWorkspaceModal({ onClose }: { onClose: () => void }) {
  const workspaces = useAppStore((s) => s.workspaces);
  const [sshCommand, setSshCommand] = useState("");
  const [wsName, setWsName] = useState("");
  const [wsDisplay, setWsDisplay] = useState("");
  const [status, setStatus] = useState("");
  const [testing, setTesting] = useState(false);
  const [parsed, setParsed] = useState(false);

  // Parse SSH command from Coder: "ssh coder.workspace" or "ssh main.workspace.user.coder"
  const handleParse = () => {
    const cmd = sshCommand.trim();
    // Match: ssh coder.WORKSPACE
    let match = cmd.match(/ssh\s+coder\.(\S+)/i);
    if (match) {
      setWsName(match[1]);
      setParsed(true);
      setStatus("");
      return;
    }
    // Match: ssh main.WORKSPACE.USER.coder
    match = cmd.match(/ssh\s+main\.(\S+?)\.(\S+?)\.coder/i);
    if (match) {
      setWsName(match[1]);
      setParsed(true);
      setStatus("");
      return;
    }
    // Match: just a workspace name
    if (cmd && !cmd.includes(" ")) {
      setWsName(cmd);
      setParsed(true);
      setStatus("");
      return;
    }
    setStatus("Could not parse. Paste the SSH command from Coder, or type the workspace name.");
  };

  const handleAdd = async () => {
    const name = wsName.trim();
    if (!name) { setStatus("Workspace name required"); return; }
    if (workspaces.some((w) => w.coderName === name)) { setStatus("Workspace already exists"); return; }

    setTesting(true);
    setStatus("Testing connection...");
    let reachable = false;
    try {
      const result = await invoke<{ connected: boolean; error: string | null }>(
        "test_workspace",
        { workspace: name }
      );
      reachable = !!result.connected;
      if (!result.connected) {
        setStatus("Warning: could not reach workspace. Added anyway.");
      }
    } catch {
      setStatus("Warning: could not reach workspace. Added anyway.");
    }

    const store = useAppStore.getState();
    useAppStore.setState({
      workspaces: [
        ...store.workspaces,
        { coderName: name, displayName: wsDisplay.trim() || name, projects: [] },
      ],
    });

    // Auto-discover projects with .gsd directories
    if (reachable) {
      setStatus("Discovering projects...");
      try {
        const output = await invoke<string>("exec_in_workspace", {
          workspace: name,
          command: "for d in ~/*/; do [ -d \"$d/.gsd\" ] && basename \"$d\"; done 2>/dev/null",
        });
        const projects = output
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("."));

        if (projects.length > 0) {
          const currentStore = useAppStore.getState();
          const ws = currentStore.workspaces.find((w) => w.coderName === name);
          if (ws) {
            const newProjects = projects
              .filter((p) => !ws.projects.some((existing) => existing.path === p))
              .map((p) => ({ path: p, displayName: p }));
            if (newProjects.length > 0) {
              useAppStore.setState({
                workspaces: currentStore.workspaces.map((w) =>
                  w.coderName === name
                    ? { ...w, projects: [...w.projects, ...newProjects] }
                    : w
                ),
              });
            }
          }
          setStatus(`✓ Found ${projects.length} project${projects.length !== 1 ? "s" : ""}`);
        } else {
          setStatus("Added. No GSD projects found — add them from the sidebar.");
        }
      } catch {
        setStatus("Added workspace. Could not auto-discover projects.");
      }
      setTesting(false);
      setTimeout(() => onClose(), 1500);
    } else {
      setTesting(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-base-surface border border-base-border rounded-lg p-5 w-96 shadow-xl">
        <h3 className="text-xs font-bold text-base-text mb-1">Add Workspace</h3>
        <p className="text-xs text-base-muted mb-4">
          Go to your Coder dashboard → select workspace → "Connect via SSH" → copy the command from step 2 and paste it below.
        </p>
        <div className="space-y-3">
          {!parsed ? (
            <>
              <div>
                <label className="block text-xs text-base-muted mb-1">Paste SSH command from Coder</label>
                <input type="text" value={sshCommand}
                  onChange={(e) => setSshCommand(e.target.value)}
                  placeholder="ssh coder.my-workspace"
                  className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none font-mono"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleParse()} />
                <p className="text-xs text-base-muted/60 mt-1">
                  Formats: <span className="text-base-muted">ssh coder.workspace</span> or <span className="text-base-muted">ssh main.workspace.user.coder</span> or just the workspace name
                </p>
              </div>
              {status && <p className="text-xs text-accent-red">{status}</p>}
              <div className="flex gap-2 justify-end pt-1">
                <button onClick={onClose}
                  className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors">
                  Cancel
                </button>
                <button onClick={handleParse} disabled={!sshCommand.trim()}
                  className="text-xs px-3 py-1.5 rounded bg-accent-orange text-white hover:opacity-90 transition-opacity disabled:opacity-30">
                  Parse
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-base-bg border border-accent-green/30 rounded p-2">
                <p className="text-xs text-accent-green">✓ Detected workspace: <span className="font-semibold">{wsName}</span></p>
              </div>
              <div>
                <label className="block text-xs text-base-muted mb-1">Display Name (optional)</label>
                <input type="text" value={wsDisplay}
                  onChange={(e) => setWsDisplay(e.target.value)}
                  placeholder={wsName}
                  className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
              </div>
              {status && <p className="text-xs text-accent-red">{status}</p>}
              <div className="flex gap-2 justify-end pt-1">
                <button onClick={() => { setParsed(false); setWsName(""); }}
                  className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors">
                  Back
                </button>
                <button onClick={handleAdd} disabled={testing}
                  className="text-xs px-3 py-1.5 rounded bg-accent-orange text-white hover:opacity-90 transition-opacity disabled:opacity-50">
                  {testing ? "Adding..." : "Add Workspace"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  const workspaces = useAppStore((s) => s.workspaces);
  const sessions = useAppStore((s) => s.sessions);
  const currentView = useAppStore((s) => s.currentView);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  const connection = useAppStore((s) => s.connection);
  const addTerminalTab = useAppStore((s) => s.addTerminalTab);
  const terminalTabs = useAppStore((s) => s.terminalTabs);
  const setActiveTerminal = useAppStore((s) => s.setActiveTerminal);
  const removeProject = useAppStore((s) => s.removeProject);

  const [addingTo, setAddingTo] = useState<{
    coderName: string;
    displayName: string;
  } | null>(null);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<{
    workspace: string;
    project: { path: string; displayName: string };
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    workspace: string;
    project: { path: string; displayName: string };
  } | null>(null);
  const [confirmRemoveWorkspace, setConfirmRemoveWorkspace] = useState<{
    coderName: string;
    displayName: string;
  } | null>(null);
  const [confirmRemoveProject, setConfirmRemoveProject] = useState<{
    workspace: string;
    projectPath: string;
    projectName: string;
  } | null>(null);
  const [sessionPicker, setSessionPicker] = useState<{
    workspace: string;
    wsDisplay: string;
    project: { path: string; displayName: string };
    sessions: { name: string; windows: number; attached: boolean; isIdle: boolean; idleSeconds: number }[];
  } | null>(null);

  const navItems: { view: ViewMode; label: string; icon: string }[] = [
    { view: "dashboard", label: "Dashboard", icon: "grid" },
    { view: "terminal", label: "Terminal", icon: "terminal" },
    { view: "logs", label: "Logs", icon: "file-text" },
    { view: "settings", label: "Settings", icon: "settings" },
  ];

  return (
    <>
      <aside className="w-56 border-r border-base-border flex flex-col bg-base-surface">
        {/* Logo */}
        <div className="px-4 py-3 border-b border-base-border">
          <h1 className="text-accent-orange font-bold text-sm tracking-wider">
            GSD CONTROL
          </h1>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connection.status === "connected"
                  ? "bg-accent-green"
                  : connection.status === "connecting"
                    ? "bg-accent-amber animate-pulse"
                    : "bg-accent-red"
              }`}
            />
            <span className="text-xs text-base-muted">
              {connection.status}
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-2 py-2 border-b border-base-border">
          {navItems.map((item) => (
            <button
              key={item.view}
              onClick={() => setCurrentView(item.view)}
              className={`w-full text-left px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                currentView === item.view
                  ? "bg-base-bg text-accent-orange"
                  : "text-base-muted hover:text-base-text hover:bg-base-bg/50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Workspace tree */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <p className="text-xs text-base-muted uppercase tracking-wider px-3 mb-2">
            Workspaces
          </p>
          {workspaces.map((ws) => (
            <div key={ws.coderName} className="mb-3">
              <div className="px-3 py-1 text-xs font-semibold text-base-text flex items-center justify-between group">
                <span>{ws.displayName}</span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={() =>
                      setAddingTo({
                        coderName: ws.coderName,
                        displayName: ws.displayName,
                      })
                    }
                    className="text-base-muted hover:text-accent-orange w-4 h-4 flex items-center justify-center rounded hover:bg-base-bg"
                    title="Add project"
                  >
                    <span className="text-sm leading-none">+</span>
                  </button>
                  <button
                    onClick={() =>
                      setConfirmRemoveWorkspace({
                        coderName: ws.coderName,
                        displayName: ws.displayName,
                      })
                    }
                    className="text-base-muted hover:text-accent-red w-4 h-4 flex items-center justify-center rounded hover:bg-base-bg"
                    title="Remove workspace"
                  >
                    <span className="text-xs leading-none">×</span>
                  </button>
                </div>
              </div>
              {ws.projects.map((proj) => {
                const sessionId = `${ws.coderName}:${proj.path}`;
                const session = sessions[sessionId];
                const isActive = selectedProject === sessionId;
                const isRunning = session?.isRunning;

                const handleProjectClick = async () => {
                  setSelectedProject(sessionId);

                  // If there's already a tab for this project, just switch to it
                  const existing = terminalTabs.find(
                    (t: TerminalTab) =>
                      t.workspace === ws.coderName && t.project === proj.path
                  );
                  if (existing) {
                    setActiveTerminal(existing.id);
                    setCurrentView("terminal");
                    return;
                  }

                  // Open terminal tab immediately — Terminal component handles
                  // tmux session creation/attachment internally
                  const id = `term-${Date.now()}`;
                  addTerminalTab({
                    id,
                    workspace: ws.coderName,
                    project: proj.path,
                    title: `${ws.displayName} · ${proj.displayName}`,
                    isActive: true,
                  });
                  setCurrentView("terminal");
                };

                const handleContextMenu = (e: React.MouseEvent) => {
                  e.preventDefault();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    workspace: ws.coderName,
                    project: proj,
                  });
                };

                return (
                  <button
                    key={proj.path}
                    onClick={handleProjectClick}
                    onContextMenu={handleContextMenu}
                    className={`w-full text-left px-3 py-1 rounded text-xs flex items-center gap-2 transition-colors ${
                      isActive
                        ? "bg-base-bg text-accent-orange"
                        : "text-base-muted hover:text-base-text hover:bg-base-bg/50"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        isRunning && session?.status.autoMode
                          ? "bg-accent-green animate-pulse"
                          : isRunning
                            ? "bg-accent-amber"
                            : "bg-base-muted/40"
                      }`}
                    />
                    <span className="truncate">{proj.displayName}</span>
                    {session?.tmuxSessions && session.tmuxSessions.length > 0 && (
                      <span className="text-accent-blue text-xs flex-shrink-0">
                        ({session.tmuxSessions.length})
                      </span>
                    )}
                    {session?.status.cost != null && (
                      <span className="ml-auto text-accent-amber text-xs">
                        ${session.status.cost.toFixed(0)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Add workspace button */}
          <button
            onClick={() => setAddingWorkspace(true)}
            className="w-full text-left px-3 py-1.5 mt-1 rounded text-xs text-base-muted hover:text-accent-orange hover:bg-base-bg/50 transition-colors"
          >
            + Add Workspace
          </button>
        </div>
      </aside>

      {/* Add project modal */}
      {addingTo && (
        <AddProjectModal
          workspace={addingTo}
          onClose={() => setAddingTo(null)}
        />
      )}

      {/* Add workspace modal */}
      {addingWorkspace && (
        <AddWorkspaceModal onClose={() => setAddingWorkspace(false)} />
      )}

      {/* Upload modal */}
      {uploadTarget && (
        <UploadModal
          workspace={uploadTarget.workspace}
          project={uploadTarget.project}
          onClose={() => setUploadTarget(null)}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setContextMenu(null)}
        >
          <div
            className="absolute bg-base-surface border border-base-border rounded-lg shadow-xl py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setUploadTarget({
                  workspace: contextMenu.workspace,
                  project: contextMenu.project,
                });
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-base-text hover:bg-base-bg transition-colors"
            >
              📤 Upload Files
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmRemoveProject({
                  workspace: contextMenu.workspace,
                  projectPath: contextMenu.project.path,
                  projectName: contextMenu.project.displayName,
                });
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-accent-red hover:bg-base-bg transition-colors"
            >
              ✕ Remove Project
            </button>
          </div>
        </div>
      )}

      {/* Confirm remove workspace modal */}
      {confirmRemoveWorkspace && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-base-surface border border-base-border rounded-lg p-5 w-80 shadow-xl">
            <h3 className="text-xs font-bold text-base-text mb-2">
              Remove Workspace
            </h3>
            <p className="text-xs text-base-muted mb-4">
              Remove workspace <span className="text-base-text font-semibold">{confirmRemoveWorkspace.displayName}</span> and all its projects from the sidebar? (Does not delete remote data.)
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmRemoveWorkspace(null)}
                className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const store = useAppStore.getState();
                  useAppStore.setState({
                    workspaces: store.workspaces.filter(
                      (w) => w.coderName !== confirmRemoveWorkspace.coderName
                    ),
                  });
                  setConfirmRemoveWorkspace(null);
                }}
                className="text-xs px-3 py-1.5 rounded bg-accent-red text-white hover:opacity-90 transition-opacity"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm remove project modal */}
      {confirmRemoveProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-base-surface border border-base-border rounded-lg p-5 w-80 shadow-xl">
            <h3 className="text-xs font-bold text-base-text mb-2">
              Remove Project
            </h3>
            <p className="text-xs text-base-muted mb-4">
              Remove <span className="text-base-text font-semibold">{confirmRemoveProject.projectName}</span> from the sidebar? (Does not delete remote data.)
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmRemoveProject(null)}
                className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  removeProject(
                    confirmRemoveProject.workspace,
                    confirmRemoveProject.projectPath
                  );
                  setConfirmRemoveProject(null);
                }}
                className="text-xs px-3 py-1.5 rounded bg-accent-red text-white hover:opacity-90 transition-opacity"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session picker */}
      {sessionPicker && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setSessionPicker(null)}
        >
          <div
            className="bg-base-surface border border-base-border rounded-lg p-5 w-96 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xs font-bold text-base-text mb-1">
              Sessions for {sessionPicker.project.displayName}
            </h3>
            <p className="text-xs text-base-muted mb-4">
              Reattach to an existing session or start a new one.
            </p>
            <div className="space-y-1.5 mb-4 max-h-[40vh] overflow-y-auto">
              {sessionPicker.sessions.map((s) => {
                const idleText = s.isIdle
                  ? s.idleSeconds > 3600
                    ? `idle ${Math.floor(s.idleSeconds / 3600)}h`
                    : s.idleSeconds > 60
                      ? `idle ${Math.floor(s.idleSeconds / 60)}m`
                      : "idle"
                  : "active";

                return (
                  <div
                    key={s.name}
                    className="flex items-center gap-2 px-3 py-2 rounded bg-base-bg border border-base-border"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        s.isIdle ? "bg-base-muted/40" : "bg-accent-green animate-pulse"
                      }`}
                    />
                    <button
                      onClick={() => {
                        const id = `term-${Date.now()}`;
                        addTerminalTab({
                          id,
                          workspace: sessionPicker.workspace,
                          project: sessionPicker.project.path,
                          title: `${sessionPicker.wsDisplay} · ${sessionPicker.project.displayName}`,
                          isActive: true,
                          tmuxSession: s.name,
                        });
                        setCurrentView("terminal");
                        setSessionPicker(null);
                      }}
                      className="text-xs text-base-text hover:text-accent-orange transition-colors truncate text-left flex-1 min-w-0"
                    >
                      {s.name}
                    </button>
                    <span className={`text-xs flex-shrink-0 ${s.isIdle ? "text-base-muted" : "text-accent-green"}`}>
                      {idleText}
                    </span>
                    <span className="text-xs text-base-muted flex-shrink-0">
                      {s.windows}w
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          await invoke("exec_in_workspace", {
                            workspace: sessionPicker.workspace,
                            command: `tmux kill-session -t '${sanitizeShellArg(s.name)}' 2>/dev/null; true`,
                          });
                          setSessionPicker({
                            ...sessionPicker,
                            sessions: sessionPicker.sessions.filter(
                              (x) => x.name !== s.name
                            ),
                          });
                        } catch {
                          // ignore
                        }
                      }}
                      className="text-xs px-1.5 py-0.5 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors flex-shrink-0"
                      title="Kill this session"
                    >
                      Kill
                    </button>
                  </div>
                );
              })}
              {sessionPicker.sessions.length === 0 && (
                <p className="text-xs text-base-muted text-center py-2">
                  All sessions killed
                </p>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSessionPicker(null)}
                className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = `term-${Date.now()}`;
                  addTerminalTab({
                    id,
                    workspace: sessionPicker.workspace,
                    project: sessionPicker.project.path,
                    title: `${sessionPicker.wsDisplay} · ${sessionPicker.project.displayName}`,
                    isActive: true,
                  });
                  setCurrentView("terminal");
                  setSessionPicker(null);
                }}
                className="text-xs px-3 py-1.5 rounded bg-accent-orange text-white hover:opacity-90 transition-opacity"
              >
                New Session
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Sidebar;
