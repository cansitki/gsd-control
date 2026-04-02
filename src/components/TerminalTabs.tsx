import { useState, useEffect } from "react";
import { debugInvoke as invoke } from "../lib/debugInvoke";
import { useAppStore } from "../stores/appStore";
import { sanitizeShellArg } from "../lib/shell";
import Terminal from "./Terminal";

interface TmuxSession {
  name: string;
  workspace: string;
  workspaceDisplay: string;
  attached: boolean;
}

function SessionManager({ onClose }: { onClose: () => void }) {
  const workspaces = useAppStore((s) => s.workspaces);
  const terminalTabs = useAppStore((s) => s.terminalTabs);
  const connection = useAppStore((s) => s.connection);
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [killing, setKilling] = useState<string | null>(null);

  const fetchSessions = async () => {
    if (connection.status !== "connected") {
      setLoading(false);
      return;
    }
    setLoading(true);

    const results = await Promise.allSettled(
      workspaces.map(async (ws) => {
        const output = await invoke<string>("exec_in_workspace", {
          workspace: ws.coderName,
          command:
            "tmux list-sessions -F '#{session_name}' 2>/dev/null || true",
        });
        const sessions: TmuxSession[] = [];
        for (const line of output.split("\n")) {
          const name = line.trim();
          if (!name) continue;
          const attached = terminalTabs.some(
            (t) => t.tmuxSession === name && t.workspace === ws.coderName
          );
          sessions.push({
            name,
            workspace: ws.coderName,
            workspaceDisplay: ws.displayName,
            attached,
          });
        }
        return sessions;
      })
    );

    const all: TmuxSession[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        all.push(...result.value);
      }
    }

    setSessions(all);
    setLoading(false);
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleKill = async (session: TmuxSession) => {
    setKilling(session.name);
    try {
      await invoke("exec_in_workspace", {
        workspace: session.workspace,
        command: `tmux kill-session -t '${sanitizeShellArg(session.name)}' 2>/dev/null; true`,
      });
      setSessions((prev) =>
        prev.filter(
          (s) =>
            !(s.name === session.name && s.workspace === session.workspace)
        )
      );
    } catch {
      // ignore
    }
    setKilling(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-base-surface border border-base-border rounded-lg p-5 w-[420px] shadow-xl max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-base-text">Remote Sessions</h3>
          <button
            onClick={onClose}
            className="text-base-muted hover:text-base-text text-sm"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-base-muted py-4 text-center">
            Loading sessions...
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-base-muted py-4 text-center">
            No tmux sessions running
          </p>
        ) : (
          <div className="overflow-y-auto space-y-1">
            {sessions.map((s) => (
              <div
                key={`${s.workspace}:${s.name}`}
                className="flex items-center justify-between px-3 py-2 rounded bg-base-bg border border-base-border"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      s.attached ? "bg-accent-green" : "bg-base-muted/40"
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="text-xs text-base-text block truncate">
                      {s.name}
                    </span>
                    <span className="text-xs text-base-muted">
                      {s.workspaceDisplay}
                      {s.attached && " · attached"}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleKill(s)}
                  disabled={killing === s.name}
                  className="text-xs px-2 py-1 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors disabled:opacity-50 flex-shrink-0 ml-2"
                >
                  {killing === s.name ? "..." : "Kill"}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between items-center mt-4 pt-3 border-t border-base-border">
          <span className="text-xs text-base-muted">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""} ·{" "}
            {sessions.filter((s) => s.attached).length} attached
          </span>
          <button
            onClick={fetchSessions}
            className="text-xs px-2 py-1 rounded border border-base-border text-base-muted hover:text-base-text transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

const LAYOUTS = [
  { value: "tabs" as const, label: "▭" , title: "Single tab view" },
  { value: "grid-2" as const, label: "⬒2", title: "2-up grid" },
  { value: "grid-4" as const, label: "⬒4", title: "4-up grid" },
  { value: "grid-6" as const, label: "⬒6", title: "6-up grid" },
];

function TerminalTabs() {
  const terminalTabs = useAppStore((s) => s.terminalTabs);
  const activeTerminalId = useAppStore((s) => s.activeTerminalId);
  const terminalLayout = useAppStore((s) => s.terminalLayout);
  const setActiveTerminal = useAppStore((s) => s.setActiveTerminal);
  const removeTerminalTab = useAppStore((s) => s.removeTerminalTab);
  const addTerminalTab = useAppStore((s) => s.addTerminalTab);
  const setTerminalLayout = useAppStore((s) => s.setTerminalLayout);
  const workspaces = useAppStore((s) => s.workspaces);
  const [showSessions, setShowSessions] = useState(false);

  const handleNewTab = () => {
    if (workspaces.length === 0 || workspaces[0].projects.length === 0) return;
    const ws = workspaces[0];
    const proj = ws.projects[0];
    const id = `term-${Date.now()}`;
    addTerminalTab({
      id,
      workspace: ws.coderName,
      project: proj.path,
      title: `${ws.displayName} · ${proj.displayName}`,
      isActive: true,
    });
  };

  const isGrid = terminalLayout !== "tabs";
  const gridCount = isGrid ? parseInt(terminalLayout.split("-")[1], 10) : 0;
  const gridTabs = isGrid ? terminalTabs.slice(0, gridCount) : [];

  // Grid CSS classes
  const gridClass = isGrid
    ? gridCount <= 2
      ? "grid grid-cols-2 gap-[1px]"
      : gridCount <= 4
        ? "grid grid-cols-2 grid-rows-2 gap-[1px]"
        : "grid grid-cols-3 grid-rows-2 gap-[1px]"
    : "";

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center border-b border-base-border bg-base-surface px-2 flex-shrink-0">
        <div className="flex items-center overflow-x-auto flex-1 min-w-0">
          {terminalTabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer border-b-2 transition-colors flex-shrink-0 ${
                activeTerminalId === tab.id
                  ? "border-accent-orange text-accent-orange"
                  : "border-transparent text-base-muted hover:text-base-text"
              }`}
              onClick={() => setActiveTerminal(tab.id)}
            >
              <span className="truncate max-w-[120px]">{tab.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeTerminalTab(tab.id);
                }}
                className="text-base-muted hover:text-accent-red text-xs ml-1"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={handleNewTab}
            className="px-3 py-2 text-base-muted hover:text-accent-green text-sm flex-shrink-0"
            title="New terminal tab"
          >
            +
          </button>
        </div>

        {/* Layout + sessions */}
        <div className="flex items-center gap-0.5 ml-2 flex-shrink-0 border-l border-base-border pl-2">
          {LAYOUTS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTerminalLayout(opt.value)}
              className={`px-1.5 py-1 text-xs rounded transition-colors ${
                terminalLayout === opt.value
                  ? "bg-accent-orange/20 text-accent-orange"
                  : "text-base-muted hover:text-base-text"
              }`}
              title={opt.title}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={() => setShowSessions(true)}
            className="px-1.5 py-1 text-xs text-base-muted hover:text-base-text transition-colors ml-1"
            title="Manage remote sessions"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Terminal area — takes all remaining space */}
      <div className="flex-1 min-h-0 relative bg-[#141a14]">
        {terminalTabs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-base-muted text-sm mb-2">No terminals open</p>
              <button
                onClick={handleNewTab}
                className="text-xs text-accent-orange hover:text-accent-orange/80 border border-accent-orange/30 rounded px-3 py-1.5"
              >
                Open Terminal
              </button>
            </div>
          </div>
        ) : isGrid ? (
          /* Grid layout */
          <div className={`h-full ${gridClass}`} style={{ background: "#1a1e2e" }}>
            {gridTabs.map((tab) => (
              <div
                key={tab.id}
                className={`relative overflow-hidden ${
                  activeTerminalId === tab.id
                    ? "ring-1 ring-accent-orange/40 ring-inset"
                    : ""
                }`}
                onClick={() => setActiveTerminal(tab.id)}
              >
                {/* Grid cell label */}
                <div className="absolute top-0 left-0 right-0 z-10 px-2 py-0.5 bg-[#141a14]/80">
                  <span className="text-xs text-base-muted truncate block">
                    {tab.title}
                  </span>
                </div>
                <div className="absolute inset-0 pt-[18px]">
                  <Terminal
                    tabId={tab.id}
                    workspace={tab.workspace}
                    project={tab.project}
                    visible={true}
                    tmuxSession={tab.tmuxSession}
                  />
                </div>
              </div>
            ))}
            {/* Empty grid slots */}
            {Array.from({
              length: Math.max(0, gridCount - gridTabs.length),
            }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="flex items-center justify-center bg-[#141a14]"
              >
                <button
                  onClick={handleNewTab}
                  className="text-xs text-base-muted/30 hover:text-base-muted border border-dashed border-base-border/20 rounded px-3 py-1.5 transition-colors"
                >
                  + Open
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* Single tab layout */
          terminalTabs.map((tab) => (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{
                visibility:
                  activeTerminalId === tab.id ? "visible" : "hidden",
                zIndex: activeTerminalId === tab.id ? 1 : 0,
              }}
            >
              <Terminal
                tabId={tab.id}
                workspace={tab.workspace}
                project={tab.project}
                visible={activeTerminalId === tab.id}
                tmuxSession={tab.tmuxSession}
              />
            </div>
          ))
        )}
      </div>

      {showSessions && (
        <SessionManager onClose={() => setShowSessions(false)} />
      )}
    </div>
  );
}

export default TerminalTabs;
