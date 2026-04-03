import { useEffect, useCallback, useRef } from "react";
import { debugInvoke as invoke } from "../lib/debugInvoke";
import { useAppStore, createEmptySession } from "../stores/appStore";
import type { GSDSession, GSDStatus, TmuxSessionInfo } from "../lib/types";
import { emptyStatus } from "../lib/logParser";

// Retry backoff delays in ms: immediate, 2s, 5s
const RETRY_DELAYS = [0, 2000, 5000];
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Only update a session in the store if something actually changed.
 * Prevents unnecessary React re-renders on every 30s poll cycle.
 */
function setSessionIfChanged(next: GSDSession): void {
  const current = useAppStore.getState().sessions[next.id];
  if (current) {
    // Compare the fields that matter for rendering
    const same =
      current.isRunning === next.isRunning &&
      current.status.autoMode === next.status.autoMode &&
      current.status.milestone === next.status.milestone &&
      current.status.slice === next.status.slice &&
      current.status.taskCurrent === next.status.taskCurrent &&
      current.status.taskTotal === next.status.taskTotal &&
      current.status.phase === next.status.phase &&
      current.status.cost === next.status.cost &&
      current.status.tokensRead === next.status.tokensRead &&
      current.status.tokensWrite === next.status.tokensWrite &&
      current.status.cacheHitRate === next.status.cacheHitRate &&
      (current.tmuxSessions?.length ?? 0) === (next.tmuxSessions?.length ?? 0) &&
      current.displayName === next.displayName;
    if (same) return;
  }
  useAppStore.getState().setSession(next);
}

// Python script that runs on the workspace and outputs JSON with all GSD data
const GSD_FETCH_SCRIPT = `
import json, os, sys, glob

home = os.path.expanduser("~")
results = []

# Find all .gsd directories (skip internal .gsd/projects/ refs and root .gsd)
for event_log in glob.glob(home + "/**/.gsd/event-log.jsonl", recursive=True):
    if "/.gsd/projects/" in event_log:
        continue
    gsd_dir = os.path.dirname(event_log)
    project_dir = os.path.dirname(gsd_dir)
    if project_dir == home:
        continue
    project_name = os.path.basename(project_dir)

    data = {"name": project_name, "path": project_dir.replace(home + "/", "")}

    # Read STATE.md
    try:
        state = open(os.path.join(gsd_dir, "STATE.md")).read()
        data["state"] = state
    except: data["state"] = ""

    # Read cost from session JSONL files (cumulative — single source of truth)
    try:
        sessions_dir = os.path.join(home, ".gsd", "sessions")
        cwd_encoded = "--" + os.path.join(home, project_dir.replace(home + "/", "")).lstrip("/").replace("/", "-") + "--"
        session_path = os.path.join(sessions_dir, cwd_encoded)
        # Also check worktree session dirs
        worktree_prefix = cwd_encoded.rstrip("-") + "-.gsd-worktrees-"
        all_session_dirs = []
        if os.path.isdir(session_path):
            all_session_dirs.append(session_path)
        if os.path.isdir(sessions_dir):
            for d in os.listdir(sessions_dir):
                if d.startswith(worktree_prefix) and os.path.isdir(os.path.join(sessions_dir, d)):
                    all_session_dirs.append(os.path.join(sessions_dir, d))
        total_cost = 0
        total_input = 0
        total_output = 0
        total_cache_read = 0
        total_cache_write = 0
        total_units = 0
        model = ""
        for sdir in all_session_dirs:
            for f in sorted(glob.glob(os.path.join(sdir, "*.jsonl"))):
                try:
                    with open(f) as fh:
                        for line in fh:
                            try: obj = json.loads(line)
                            except: continue
                            if obj.get("type") != "message": continue
                            msg = obj.get("message", {})
                            usage = msg.get("usage", {})
                            cost_obj = usage.get("cost", {})
                            c = cost_obj.get("total", 0)
                            if c <= 0: continue
                            total_cost += c
                            total_units += 1
                            total_input += usage.get("input", 0)
                            total_output += usage.get("output", 0)
                            total_cache_read += usage.get("cacheRead", 0)
                            total_cache_write += usage.get("cacheWrite", 0)
                            model = msg.get("model", model)
                except: continue
        # Fallback to metrics.json if no session data
        if total_cost == 0:
            try:
                metrics = json.load(open(os.path.join(gsd_dir, "metrics.json")))
                units = metrics.get("units", [])
                total_cost = round(sum(u.get("cost", 0) for u in units), 2)
                total_units = len(units)
                model = units[-1].get("model", "") if units else ""
                for u in units:
                    t = u.get("tokens", {})
                    total_input += t.get("input", 0)
                    total_output += t.get("output", 0)
                    total_cache_read += t.get("cacheRead", 0)
                    total_cache_write += t.get("cacheWrite", 0)
            except: pass
        data["totalCost"] = round(total_cost, 2)
        data["totalUnits"] = total_units
        data["model"] = model
        data["totalTokens"] = {
            "input": total_input,
            "output": total_output,
            "cacheRead": total_cache_read,
            "cacheWrite": total_cache_write,
            "total": total_input + total_output + total_cache_read + total_cache_write
        }
    except:
        data["totalCost"] = 0
        data["totalUnits"] = 0
        data["totalTokens"] = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}

    # Check tmux for sessions related to this project
    try:
        import subprocess
        tmux = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}|||#{session_activity}"],
                             capture_output=True, text=True, timeout=3)
        import time
        now = int(time.time())
        all_sessions = []
        for line in (tmux.stdout.strip().split("\\n") if tmux.stdout.strip() else []):
            parts = line.split("|||")
            sname = parts[0]
            activity = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else now
            idle_secs = now - activity
            all_sessions.append({"name": sname, "idle": idle_secs})
        # Filter to sessions matching this project
        pname = project_name
        pslug = project_name.replace("/", "-")
        project_sessions = [s for s in all_sessions
                           if s["name"] == pname
                           or s["name"] == pslug
                           or s["name"].startswith("gsd-term-" + pname)
                           or pname in s["name"]]
        # Exclude watcher
        project_sessions = [s for s in project_sessions if s["name"] != "gsd-watcher"]
        data["tmuxSessions"] = [s["name"] for s in project_sessions]
        data["sessionDetails"] = project_sessions

        # Capture last 5 lines from the most active (lowest idle) session
        if project_sessions:
            most_active = min(project_sessions, key=lambda s: s["idle"])
            try:
                cap = subprocess.run(
                    ["tmux", "capture-pane", "-p", "-t", most_active["name"]],
                    capture_output=True, text=True, timeout=3
                )
                lines = [l for l in cap.stdout.split("\\n") if l.strip()]
                data["terminalPreview"] = lines[-5:] if lines else []
            except:
                data["terminalPreview"] = []
        else:
            data["terminalPreview"] = []
    except:
        data["tmuxSessions"] = []
        data["sessionDetails"] = []
        data["terminalPreview"] = []

    # Git branch
    try:
        import subprocess
        git = subprocess.run(["git", "-C", project_dir, "branch", "--show-current"],
                            capture_output=True, text=True, timeout=3)
        data["gitBranch"] = git.stdout.strip()
    except:
        data["gitBranch"] = ""

    # Last event
    try:
        lines = open(event_log).readlines()
        if lines:
            last_event = json.loads(lines[-1])
            data["lastEvent"] = last_event
    except:
        data["lastEvent"] = None

    results.append(data)

print(json.dumps(results))
`.trim();

interface RemoteProjectData {
  name: string;
  path: string;
  state: string;
  totalCost: number;
  totalUnits: number;
  model?: string;
  totalTokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  lastMilestoneCost?: number;
  lastMilestoneTokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  lastMilestoneCacheHit?: number;
  tmuxSessions: string[];
  sessionDetails?: { name: string; idle: number }[];
  terminalPreview?: string[];
  gitBranch: string;
  lastEvent?: { cmd: string; params: Record<string, string>; ts: string } | null;
}

function parseStateMd(state: string): Partial<GSDStatus> {
  const result: Partial<GSDStatus> = {};

  const milestoneMatch = state.match(
    /\*\*Active Milestone:\*\*\s*(.+)/
  );
  if (milestoneMatch) result.milestone = milestoneMatch[1].trim();

  const sliceMatch = state.match(
    /\*\*Active Slice:\*\*\s*(.+)/
  );
  if (sliceMatch && sliceMatch[1].trim() !== "None") {
    result.slice = sliceMatch[1].trim();
  }

  const phaseMatch = state.match(/\*\*Phase:\*\*\s*(\S+)/);
  if (phaseMatch) result.phase = phaseMatch[1];

  // Count milestones
  const completed = (state.match(/- ✅/g) || []).length;
  const inProgress = (state.match(/- 🔄/g) || []).length;
  const pending = (state.match(/- ⬜/g) || []).length;
  const total = completed + inProgress + pending;
  if (total > 0) {
    result.sliceCurrent = completed;
    result.sliceTotal = total;
  }

  // Next action
  const nextMatch = state.match(/## Next Action\n(.+)/);
  if (nextMatch) result.lastTaskDescription = nextMatch[1].trim();

  return result;
}

export function useSSH() {
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const setSession = useAppStore((s) => s.setSession);
  const setLastPollTime = useAppStore((s) => s.setLastPollTime);
  const setWorkspaceHealth = useAppStore((s) => s.setWorkspaceHealth);
  const hasHydrated = useAppStore((s) => s._hasHydrated);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectingRef = useRef(false);
  const connectAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to break circular dependency between connect ↔ scheduleRetry
  const connectFnRef = useRef<(opts?: { isRetry?: boolean }) => Promise<boolean>>(
    async () => false
  );

  // Schedule a retry with exponential backoff, or give up after MAX_RETRY_ATTEMPTS
  const scheduleRetry = useCallback((errorMsg: string): false => {
    const nextAttempt = connectAttemptRef.current + 1;
    if (nextAttempt >= MAX_RETRY_ATTEMPTS) {
      console.error(`SSH connect: giving up after ${MAX_RETRY_ATTEMPTS} attempts`);
      setConnectionStatus("error", errorMsg);
      connectAttemptRef.current = 0;
      return false;
    }

    connectAttemptRef.current = nextAttempt;
    const delay = RETRY_DELAYS[nextAttempt] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
    console.log(`SSH connect: scheduling retry ${nextAttempt + 1}/${MAX_RETRY_ATTEMPTS} in ${delay}ms`);
    setConnectionStatus("reconnecting", errorMsg);

    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      // Use ref to get latest connect — avoids stale closure
      connectFnRef.current({ isRetry: true });
    }, delay);

    return false;
  }, [setConnectionStatus]);

  const connect = useCallback(async (opts?: { isRetry?: boolean }) => {
    // Guard against concurrent connect attempts (retry vs manual reconnect race)
    if (connectingRef.current) {
      console.log("SSH connect: skipped — already in progress");
      return false;
    }
    connectingRef.current = true;

    // Reset attempt counter on fresh (non-retry) connect
    if (!opts?.isRetry) {
      connectAttemptRef.current = 0;
    }

    // Read current state directly — React closures may be stale during hydration
    const currentConfig = useAppStore.getState().config;
    const profile = currentConfig.sshProfiles.find((p) => p.id === currentConfig.activeProfileId);
    if (!profile) {
      console.error("SSH connect: no profile configured (activeProfileId:", currentConfig.activeProfileId, ", profiles:", currentConfig.sshProfiles.length, ")");
      setConnectionStatus("error", "No SSH profile configured");
      connectingRef.current = false;
      return false;
    }

    const attempt = connectAttemptRef.current;
    const statusLabel = attempt > 0 ? "reconnecting" : "connecting";
    console.log(`SSH connect: attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS} with profile ${profile.name} → ${profile.coderUser}@${profile.host || "(coder alias)"}`);
    setConnectionStatus(statusLabel as "connecting" | "reconnecting");

    try {
      // Secret retrieval may fail — proceed without key (Coder aliases don't need it)
      let keyPath = "";
      if (profile.hasKey) {
        try {
          const { getSecret, SECRET_KEYS } = await import("../lib/secrets");
          const keyContent = await getSecret(SECRET_KEYS.sshKey(profile.id));
          if (keyContent) {
            keyPath = await invoke<string>("write_ssh_key", {
              profileId: profile.id,
              keyContent,
            });
          }
        } catch (e) {
          console.warn("SSH connect: key retrieval failed, proceeding without key —", e);
        }
      }

      const result = await invoke<{ connected: boolean; error: string | null }>(
        "ssh_connect",
        {
          host: profile.host,
          user: profile.user,
          keyPath,
          coderUser: profile.coderUser,
        }
      );

      if (result.connected) {
        console.log("SSH connect: success ✓");
        setConnectionStatus("connected");
        connectAttemptRef.current = 0;
        connectingRef.current = false;
        return true;
      } else {
        console.error("SSH connect: failed —", result.error);
        connectingRef.current = false;
        return scheduleRetry(result.error ?? "Connection failed");
      }
    } catch (e) {
      console.error("SSH connect: exception —", e);
      connectingRef.current = false;
      return scheduleRetry(String(e));
    }
  }, [setConnectionStatus, scheduleRetry]);

  // Keep the ref in sync with latest connect
  connectFnRef.current = connect;

  const fetchGSDData = useCallback(async () => {
    // Read workspaces from store directly to avoid stale closure
    const workspaces = useAppStore.getState().workspaces;

    await Promise.allSettled(
      workspaces.map(async (ws) => {
        try {
          // Run the Python script on the workspace
          const raw = await invoke<string>("exec_in_workspace", {
            workspace: ws.coderName,
            command: `python3 -c '${GSD_FETCH_SCRIPT.replace(/'/g, "'\"'\"'")}'`,
          });

          if (!raw || !raw.trim()) return;

          let projects: RemoteProjectData[];
          try {
            projects = JSON.parse(raw.trim());
          } catch {
            console.warn(`Failed to parse GSD data from ${ws.coderName}:`, raw.substring(0, 200));
            return;
          }

          // Match remote projects to configured projects
          for (const proj of ws.projects) {
            const remote = projects.find(
              (p) => p.path === proj.path || p.name === proj.path || p.path.endsWith(proj.path)
            );

            const sessionId = `${ws.coderName}:${proj.path}`;
            const baseStatus = emptyStatus();

            if (remote) {
              const stateInfo = remote.state ? parseStateMd(remote.state) : {};
              const hasSessions = remote.tmuxSessions.length > 0;
              const details = remote.sessionDetails || [];

              // Determine actual status from session activity
              const activeSession = details.find((s) => s.idle < 60);
              const isRunning = hasSessions;
              const isActive = !!activeSession;

              let phase = stateInfo.phase || null;
              if (hasSessions && !phase) {
                phase = isActive ? "running" : "idle";
              }

              const status: GSDStatus = {
                ...baseStatus,
                ...stateInfo,
                cost: remote.totalCost,
                cacheHitRate: remote.lastMilestoneCacheHit ?? null,
                gitBranch: remote.gitBranch || null,
                autoMode: isActive,
                phase,
              };

              if (remote.totalTokens && remote.totalTokens.total > 0) {
                const t = remote.totalTokens;
                const readM = (t.cacheRead + t.input) / 1e6;
                const writeK = t.output / 1e3;
                status.tokensRead = `${readM.toFixed(1)}M`;
                status.tokensWrite = `${writeK.toFixed(0)}K`;
              }

              const tmuxSessions: TmuxSessionInfo[] = details.map((d) => ({
                name: d.name,
                idle: d.idle,
                attached: false,
              }));

              setSessionIfChanged({
                id: sessionId,
                workspace: ws.displayName,
                project: proj.path,
                projectPath: proj.path,
                displayName: proj.displayName,
                status,
                isRunning,
                lastUpdated: Date.now(),
                logs: [],
                tmuxSessions,
                terminalPreview: remote.terminalPreview || [],
              });
            } else {
              setSessionIfChanged(
                createEmptySession(ws.coderName, proj.path, proj.path, proj.displayName)
              );
            }
          }

          setWorkspaceHealth(ws.coderName, 'ok');
        } catch (e) {
          console.error(`Failed to fetch GSD data from ${ws.coderName}:`, e);
          setWorkspaceHealth(ws.coderName, 'error');
          for (const proj of ws.projects) {
            setSessionIfChanged(
              createEmptySession(ws.coderName, proj.path, proj.path, proj.displayName)
            );
          }
        }
      })
    );

    setLastPollTime(Date.now());

    // Write combined status snapshot to the first workspace for the Telegram watcher.
    // Best-effort — failures don't affect the poll cycle.
    try {
      const allSessions = useAppStore.getState().sessions;
      const snapshot = {
        timestamp: Date.now(),
        workspaces: workspaces.map((ws) => ({
          name: ws.displayName,
          coderName: ws.coderName,
          projects: ws.projects.map((proj) => {
            const sid = `${ws.coderName}:${proj.path}`;
            const session = allSessions[sid];
            return {
              name: proj.displayName,
              path: proj.path,
              milestone: session?.status?.milestone || null,
              slice: session?.status?.slice || null,
              phase: session?.status?.phase || null,
              cost: session?.status?.cost || 0,
              autoMode: session?.status?.autoMode || false,
              isRunning: session?.isRunning || false,
              nextAction: session?.status?.lastTaskDescription || null,
              milestonesDone: session?.status?.sliceCurrent || 0,
              milestonesTotal: session?.status?.sliceTotal || 0,
            };
          }),
        })),
      };
      const snapshotJson = JSON.stringify(snapshot);
      const primaryWs = workspaces[0];
      if (primaryWs) {
        invoke("exec_in_workspace", {
          workspace: primaryWs.coderName,
          command: `cat > /home/coder/.gsd-watcher-status.json << 'SNAPSHOT_EOF'\n${snapshotJson}\nSNAPSHOT_EOF`,
        }).catch(() => {}); // fire-and-forget
      }
    } catch {
      // Best-effort — don't break the poll cycle
    }
  }, [setSession, setWorkspaceHealth, setLastPollTime]);

  // Check if all workspaces are unhealthy — triggers reconnect
  const checkHealthAndReconnect = useCallback(async () => {
    const health = useAppStore.getState().workspaceHealth;
    const ws = useAppStore.getState().workspaces;
    if (ws.length === 0) return;

    const allUnhealthy = ws.every((w) => health[w.coderName] === 'error');
    if (!allUnhealthy) return;

    // All workspaces failed — verify with a direct health check before reconnecting
    // Use the first workspace for the health check probe
    const probeWorkspace = ws[0].coderName;
    console.warn(`SSH health: all workspaces unhealthy, running health check on ${probeWorkspace}...`);
    try {
      const result = await invoke<{ status: string; message: string }>("ssh_health_check", {
        workspace: probeWorkspace,
      });
      if (result.status !== "ok") {
        console.warn(`SSH health: check returned ${result.status} — ${result.message}, triggering reconnect`);
        connect({ isRetry: true });
      } else {
        console.log("SSH health: check returned ok — workspace errors are transient");
      }
    } catch (e) {
      console.warn("SSH health: health check invoke failed —", e, "— triggering reconnect");
      connect({ isRetry: true });
    }
  }, [connect]);

  // Auto-connect + fetch on mount, then poll every 30 seconds
  // Wait for zustand hydration so config.sshProfiles is populated from localStorage
  useEffect(() => {
    if (!hasHydrated) return;

    const init = async () => {
      console.log("SSH init: hydration complete, attempting auto-connect...");
      const connected = await connect();
      if (connected) {
        console.log("SSH init: connected, starting initial data fetch");
        await fetchGSDData();
      } else {
        console.warn("SSH init: auto-connect failed — retries may be scheduled, polling will start regardless");
      }

      // Always start polling — if connection recovers via retry, next poll picks up data
      pollRef.current = setInterval(async () => {
        const status = useAppStore.getState().connection.status;
        if (status !== "connected") return; // Skip polling when not connected
        try {
          await fetchGSDData();
          // After each poll, check if all workspaces are unhealthy
          await checkHealthAndReconnect();
        } catch (e) {
          console.error("Poll error:", e);
        }
      }, 30_000);
    };
    init();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [hasHydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  return { connect, fetchGSDData };
}
