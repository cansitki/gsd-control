import { useState, useMemo } from "react";
import { debugInvoke as invoke } from "../lib/debugInvoke";
import type { GSDSession, Block } from "../lib/types";
import { useAppStore } from "../stores/appStore";
import { sanitizeShellArg } from "../lib/shell";

interface Props {
  session: GSDSession;
}

function SessionCard({ session }: Props) {
  const { status, displayName, workspace, isRunning, project } = session;
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaces = useAppStore((s) => s.workspaces);
  const blocks = useAppStore((s) => s.blocks);
  const addBlock = useAppStore((s) => s.addBlock);
  const setActiveBlock = useAppStore((s) => s.setActiveBlock);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const wsConfig = workspaces.find((w) => w.displayName === workspace);
  const coderName = wsConfig?.coderName ?? workspace;

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

  const sortedTmux = useMemo(
    () =>
      session.tmuxSessions
        ? [...session.tmuxSessions].sort((a, b) => a.idle - b.idle)
        : [],
    [session.tmuxSessions]
  );

  /** Click the card body → open a terminal for this project */
  const handleCardClick = () => {
    // If there's already a tab for this project, switch to it
    const existing = blocks.find(
      (t: Block) => t.workspace === coderName && t.project === project
    );
    if (existing) {
      setActiveBlock(existing.id);
      setCurrentView("terminal");
      return;
    }

    // Open new terminal tab
    const id = `term-${Date.now()}`;
    addBlock({
      id,
      type: 'terminal',
      workspace: coderName,
      project,
      title: `${workspace} · ${displayName}`,
      isActive: true,
    });
    setCurrentView("terminal");
  };

  const handleStartAuto = async () => {
    setLaunching(true);
    setError(null);
    try {
      await invoke("gsd_start_auto", {
        workspace: coderName,
        projectPath: project,
        milestone: null,
      });
    } catch (e) {
      console.error("Failed to start GSD:", e);
      showError(`Failed to start: ${e}`);
    }
    setLaunching(false);
  };

  const handleStop = async () => {
    setError(null);
    try {
      await invoke("gsd_stop", {
        workspace: coderName,
        projectPath: project,
      });
    } catch (e) {
      console.error("Failed to stop GSD:", e);
      showError(`Failed to stop: ${e}`);
    }
  };

  const handleAttachTmux = async () => {
    setError(null);
    try {
      // List tmux sessions on this workspace
      const sessions = await invoke<string[]>("list_tmux_sessions", {
        workspace: coderName,
      });

      // Find sessions matching this specific project
      const pname = sanitizeShellArg(project.split("/").pop() || project);
      const pslug = sanitizeShellArg(project.replace(/\//g, "-"));
      const matching = sessions.filter(
        (s) =>
          s === pname ||
          s === pslug ||
          s === `gsd-term-${pname}` ||
          s === `gsd-term-${pslug}`
      );

      if (matching.length === 0) {
        showError("No tmux sessions found for this project");
        return;
      }

      // Use the first matching session
      const tmuxSession = matching[0];
      const tabId = `tmux-${Date.now()}`;

      // Open terminal attached to the tmux session
      await invoke("terminal_open_tmux", {
        id: tabId,
        workspace: coderName,
        tmuxSession,
      });

      addBlock({
        id: tabId,
        type: 'terminal',
        workspace: coderName,
        project,
        title: `${displayName} · tmux:${tmuxSession}`,
        isActive: true,
      });
      setCurrentView("terminal");
    } catch (e) {
      console.error("Failed to attach tmux:", e);
      showError(`Failed to attach: ${e}`);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className="bg-base-surface border border-base-border rounded-lg p-4 hover:border-accent-orange/30 transition-colors cursor-pointer"
    >  {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isRunning && status.autoMode
                ? "bg-accent-green animate-pulse"
                : isRunning
                  ? "bg-accent-amber"
                  : status.phase === "complete"
                    ? "bg-accent-green"
                    : "bg-base-muted/40"
            }`}
          />
          <h3 className="text-sm font-semibold text-base-text">
            {displayName}
          </h3>
        </div>
        <span className="text-xs text-base-muted">{workspace}</span>
      </div>

      {/* Tmux sessions */}
      {sortedTmux.length > 0 && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          <span className="text-accent-blue font-medium">
            {sortedTmux.length}{" "}
            {sortedTmux.length === 1 ? "session" : "sessions"}
          </span>
          {(() => {
            const top = sortedTmux[0];
            if (top.idle < 60) {
              return (
                <span className="text-accent-blue">active</span>
              );
            }
            const mins = Math.floor(top.idle / 60);
            const hours = Math.floor(mins / 60);
            const idleStr = hours > 0 ? `idle ${hours}h` : `idle ${mins}m`;
            return (
              <span className="text-base-muted">{idleStr}</span>
            );
          })()}
        </div>
      )}

      {/* Terminal preview */}
      {session.terminalPreview && session.terminalPreview.length > 0 && (
        <div className="mb-2 bg-base-bg rounded p-2 font-mono text-[10px] text-base-muted leading-tight">
          {session.terminalPreview.map((line, i) => (
            <div key={i} className="whitespace-pre overflow-hidden text-ellipsis">
              {line}
            </div>
          ))}
        </div>
      )}

      {/* Milestone */}
      {status.milestone && (
        <div className="mb-2">
          <span className="text-xs text-base-muted">Milestone</span>
          <div className="text-xs text-accent-blue font-medium">
            {status.milestone}
            {status.phase && (
              <span
                className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                  status.phase === "complete"
                    ? "bg-accent-green/10 text-accent-green"
                    : status.phase === "planning" || status.phase === "evaluating-gates"
                      ? "bg-accent-amber/10 text-accent-amber"
                      : "bg-accent-blue/10 text-accent-blue"
                }`}
              >
                {status.phase}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Progress */}
      {status.sliceTotal != null && status.sliceTotal > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs text-base-muted mb-1">
            <span>
              {status.sliceCurrent}/{status.sliceTotal} milestones done
            </span>
          </div>
          <div className="h-1 bg-base-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-orange rounded-full transition-all duration-500"
              style={{
                width: `${((status.sliceCurrent ?? 0) / status.sliceTotal) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Metrics */}
      <div className="flex items-center gap-3 text-xs flex-wrap">
        {status.cost != null && status.cost > 0 && (
          <span className="text-accent-amber font-medium">
            ${status.cost.toFixed(2)}
          </span>
        )}
        {status.tokensRead && (
          <span className="text-base-muted">
            R{status.tokensRead} W{status.tokensWrite}
          </span>
        )}
        {status.cacheHitRate != null && (
          <span className="text-base-muted">{status.cacheHitRate}%hit</span>
        )}
        {status.gitBranch && (
          <span className="text-base-muted">⎇ {status.gitBranch}</span>
        )}
      </div>

      {/* Next action */}
      {status.lastTaskDescription && (
        <div className="mt-2 text-xs text-base-muted truncate">
          {status.lastTaskDescription}
        </div>
      )}

      {/* Action buttons — stopPropagation so they don't trigger card click */}
      <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {isRunning && status.autoMode ? (
          <>
            <span className="text-xs px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green font-medium">
              AUTO
            </span>
            <button
              onClick={handleAttachTmux}
              className="text-xs px-2 py-1 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              Attach
            </button>
            <button
              onClick={handleStop}
              className="ml-auto text-xs px-2 py-1 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors"
            >
              Stop
            </button>
          </>
        ) : isRunning ? (
          <>
            <span className="text-xs px-1.5 py-0.5 rounded bg-accent-amber/10 text-accent-amber font-medium">
              IDLE
            </span>
            <button
              onClick={handleAttachTmux}
              className="text-xs px-2 py-1 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              Attach
            </button>
            <button
              onClick={handleStop}
              className="ml-auto text-xs px-2 py-1 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors"
            >
              Stop
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleStartAuto}
              disabled={launching}
              className="text-xs px-2 py-1 rounded border border-accent-green/30 text-accent-green hover:bg-accent-green/10 transition-colors disabled:opacity-50"
            >
              {launching ? "Starting..." : "Start Auto"}
            </button>
            <button
              onClick={handleAttachTmux}
              className="text-xs px-2 py-1 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              Attach tmux
            </button>
          </>
        )}
      </div>

      {/* Error feedback */}
      {error && (
        <div className="mt-2 text-xs text-accent-red bg-accent-red/10 rounded px-2 py-1">
          {error}
        </div>
      )}
    </div>
  );
}

export default SessionCard;
