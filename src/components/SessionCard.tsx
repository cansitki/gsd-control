import { useState, useMemo } from "react";
import { debugInvoke as invoke } from "../lib/debugInvoke";
import type { GSDSession, Block } from "../lib/types";
import { useAppStore } from "../stores/appStore";
import { sanitizeShellArg } from "../lib/shell";

interface Props {
  session: GSDSession;
}

/** Determine card urgency: error > warning > active > idle */
function getCardUrgency(session: GSDSession): "error" | "warning" | "active" | "idle" | "complete" {
  const { status, isRunning } = session;
  // Check if any tmux session has recent activity
  const hasRecentActivity = session.tmuxSessions?.some((s) => s.idle < 120) ?? false;

  if (status.phase === "error" || status.phase === "blocked") {
    // Stale error — if no recent activity, demote to idle
    return hasRecentActivity ? "error" : "idle";
  }
  if (status.phase === "evaluating-gates" || status.phase === "waiting") {
    // Stale warning — if no recent activity, demote to idle
    return hasRecentActivity ? "warning" : "idle";
  }
  if (isRunning && status.autoMode && hasRecentActivity) return "active";
  if (isRunning && hasRecentActivity) return "active";
  if (status.phase === "complete") return "complete";
  return "idle";
}

const URGENCY_BORDER: Record<string, string> = {
  error: "border-accent-red/60 shadow-[0_0_12px_rgba(196,92,92,0.15)]",
  warning: "border-accent-amber/50 shadow-[0_0_8px_rgba(212,168,67,0.1)]",
  active: "border-accent-green/40",
  complete: "border-accent-green/20",
  idle: "border-base-border",
};

const URGENCY_BADGE: Record<string, { text: string; className: string }> = {
  error: { text: "ERROR", className: "bg-accent-red/15 text-accent-red border border-accent-red/30" },
  warning: { text: "ATTENTION", className: "bg-accent-amber/15 text-accent-amber border border-accent-amber/30" },
  active: { text: "AUTO", className: "bg-accent-green/15 text-accent-green border border-accent-green/30" },
  complete: { text: "DONE", className: "bg-accent-green/10 text-accent-green/70 border border-accent-green/20" },
  idle: { text: "IDLE", className: "bg-base-bg text-base-muted border border-base-border" },
};

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
  const urgency = getCardUrgency(session);
  const badge = URGENCY_BADGE[urgency];

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

  const handleCardClick = () => {
    const existing = blocks.find(
      (t: Block) => t.workspace === coderName && t.project === project
    );
    if (existing) {
      setActiveBlock(existing.id);
      setCurrentView("terminal");
      return;
    }
    const id = `term-${Date.now()}`;
    addBlock({
      id,
      type: "terminal",
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
      const sessions = await invoke<string[]>("list_tmux_sessions", {
        workspace: coderName,
      });
      const pname = sanitizeShellArg(project.split("/").pop() || project);
      const pslug = sanitizeShellArg(project.replace(/\//g, "-"));
      const matching = sessions.filter(
        (s) =>
          s === pname || s === pslug ||
          s === `gsd-term-${pname}` || s === `gsd-term-${pslug}`
      );
      if (matching.length === 0) {
        showError("No tmux sessions found for this project");
        return;
      }
      const tmuxSession = matching[0];
      const tabId = `tmux-${Date.now()}`;
      await invoke("terminal_open_tmux", {
        id: tabId,
        workspace: coderName,
        tmuxSession,
      });
      addBlock({
        id: tabId,
        type: "terminal",
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

  // Progress: slices or tasks
  const sliceProgress = status.sliceCurrent != null && status.sliceTotal != null && status.sliceTotal > 0
    ? { current: status.sliceCurrent, total: status.sliceTotal, pct: (status.sliceCurrent / status.sliceTotal) * 100 }
    : null;
  const taskProgress = status.taskCurrent != null && status.taskTotal != null && status.taskTotal > 0
    ? { current: status.taskCurrent, total: status.taskTotal }
    : null;

  return (
    <div
      onClick={handleCardClick}
      className={`bg-base-surface border rounded-lg p-4 hover:border-accent-orange/30 transition-all cursor-pointer ${URGENCY_BORDER[urgency]}`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              urgency === "error" ? "bg-accent-red animate-pulse" :
              urgency === "warning" ? "bg-accent-amber animate-pulse" :
              urgency === "active" ? "bg-accent-green animate-pulse" :
              urgency === "complete" ? "bg-accent-green" :
              "bg-base-muted/40"
            }`}
          />
          <h3 className="text-sm font-semibold text-base-text truncate">{displayName}</h3>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${badge.className}`}>
            {badge.text}
          </span>
        </div>
        <span className="text-xs text-base-muted flex-shrink-0 ml-2">{workspace}</span>
      </div>

      {/* Milestone + Slice */}
      {status.milestone && (
        <div className="mb-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-accent-blue font-medium">{status.milestone}</span>
            {status.slice && (
              <>
                <span className="text-base-muted">·</span>
                <span className="text-base-text">{status.slice}</span>
              </>
            )}
            {status.phase && status.phase !== "complete" && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                status.phase === "error" || status.phase === "blocked"
                  ? "bg-accent-red/10 text-accent-red"
                  : status.phase === "planning" || status.phase === "evaluating-gates"
                    ? "bg-accent-amber/10 text-accent-amber"
                    : "bg-accent-blue/10 text-accent-blue"
              }`}>
                {status.phase}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Current task */}
      {status.lastTaskDescription && (
        <div className="mb-2 text-xs text-base-muted">
          <span className="text-base-muted/60">▸ </span>
          <span className="text-base-text">{status.lastTaskDescription}</span>
        </div>
      )}

      {/* Progress bar */}
      {sliceProgress && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[10px] text-base-muted mb-1">
            <span>
              {sliceProgress.current}/{sliceProgress.total} slices
              {taskProgress && ` · task ${taskProgress.current}/${taskProgress.total}`}
            </span>
            <span>{Math.round(sliceProgress.pct)}%</span>
          </div>
          <div className="h-1.5 bg-base-bg rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                urgency === "error" ? "bg-accent-red" :
                urgency === "warning" ? "bg-accent-amber" :
                "bg-accent-orange"
              }`}
              style={{ width: `${sliceProgress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Tmux sessions */}
      {sortedTmux.length > 0 && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          <span className="text-accent-blue">
            {sortedTmux.length} {sortedTmux.length === 1 ? "session" : "sessions"}
          </span>
          {(() => {
            const top = sortedTmux[0];
            if (top.idle < 60) return <span className="text-accent-green text-[10px]">active</span>;
            const mins = Math.floor(top.idle / 60);
            const hours = Math.floor(mins / 60);
            return <span className="text-base-muted text-[10px]">{hours > 0 ? `idle ${hours}h` : `idle ${mins}m`}</span>;
          })()}
        </div>
      )}

      {/* Terminal preview */}
      {session.terminalPreview && session.terminalPreview.length > 0 && (
        <div className="mb-2 bg-base-bg rounded p-2 font-mono text-[10px] text-base-muted leading-tight max-h-16 overflow-hidden">
          {session.terminalPreview.map((line, i) => (
            <div key={i} className="whitespace-pre overflow-hidden text-ellipsis">{line}</div>
          ))}
        </div>
      )}

      {/* Metrics row */}
      <div className="flex items-center gap-3 text-xs flex-wrap mb-2">
        {status.cost != null && status.cost > 0 && (
          <span className="text-accent-amber font-medium">${status.cost.toFixed(2)}</span>
        )}
        {status.cacheHitRate != null && (
          <span className="text-base-muted">{status.cacheHitRate}% hit</span>
        )}
        {status.tokensRead && (
          <span className="text-base-muted">↓{status.tokensRead} ↑{status.tokensWrite}</span>
        )}
        {status.timeElapsed && (
          <span className="text-base-muted">{status.timeElapsed}</span>
        )}
        {status.timeRemaining && (
          <span className="text-base-muted">~{status.timeRemaining} left</span>
        )}
        {status.gitBranch && (
          <span className="text-base-muted">⎇ {status.gitBranch}</span>
        )}
      </div>

      {/* Last commit */}
      {status.lastCommitMessage && (
        <div className="mb-2 text-[10px] text-base-muted/70 truncate">
          {status.lastCommitMessage}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-2 border-t border-base-border/50" onClick={(e) => e.stopPropagation()}>
        {isRunning && status.autoMode ? (
          <>
            <button onClick={handleAttachTmux} className="text-xs px-2 py-1 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors">
              Attach
            </button>
            <button onClick={handleStop} className="ml-auto text-xs px-2 py-1 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors">
              Stop
            </button>
          </>
        ) : isRunning ? (
          <>
            <button onClick={handleAttachTmux} className="text-xs px-2 py-1 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors">
              Attach
            </button>
            <button onClick={handleStop} className="ml-auto text-xs px-2 py-1 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors">
              Stop
            </button>
          </>
        ) : (
          <>
            <button onClick={handleStartAuto} disabled={launching} className="text-xs px-2 py-1 rounded border border-accent-green/30 text-accent-green hover:bg-accent-green/10 transition-colors disabled:opacity-50">
              {launching ? "Starting..." : "Start Auto"}
            </button>
            <button onClick={handleAttachTmux} className="text-xs px-2 py-1 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors">
              Attach
            </button>
          </>
        )}
      </div>

      {/* Error feedback */}
      {error && (
        <div className="mt-2 text-xs text-accent-red bg-accent-red/10 rounded px-2 py-1">{error}</div>
      )}
    </div>
  );
}

export { getCardUrgency };
export default SessionCard;
