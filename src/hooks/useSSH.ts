import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, createEmptySession } from "../stores/appStore";
import type { GSDStatus, TmuxSessionInfo } from "../lib/types";
import { emptyStatus } from "../lib/logParser";

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

    # Read metrics
    try:
        metrics = json.load(open(os.path.join(gsd_dir, "metrics.json")))
        units = metrics.get("units", [])
        data["totalCost"] = round(sum(u.get("cost", 0) for u in units), 2)
        data["totalUnits"] = len(units)
        data["model"] = units[-1].get("model", "") if units else ""
        # Sum all tokens across all units
        total_input = 0
        total_output = 0
        total_cache_read = 0
        total_cache_write = 0
        for u in units:
            t = u.get("tokens", {})
            total_input += t.get("input", 0)
            total_output += t.get("output", 0)
            total_cache_read += t.get("cacheRead", 0)
            total_cache_write += t.get("cacheWrite", 0)
        data["totalTokens"] = {
            "input": total_input,
            "output": total_output,
            "cacheRead": total_cache_read,
            "cacheWrite": total_cache_write,
            "total": total_input + total_output + total_cache_read + total_cache_write
        }
        # Last milestone unit
        milestone_units = [u for u in units if u.get("type") == "complete-milestone"]
        if milestone_units:
            last = milestone_units[-1]
            data["lastMilestoneCost"] = round(last.get("cost", 0), 2)
            data["lastMilestoneTokens"] = last.get("tokens", {})
            data["lastMilestoneCacheHit"] = last.get("cacheHitRate")
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
  const workspaces = useAppStore((s) => s.workspaces);
  const setSession = useAppStore((s) => s.setSession);
  const setLastPollTime = useAppStore((s) => s.setLastPollTime);
  const setWorkspaceHealth = useAppStore((s) => s.setWorkspaceHealth);
  const hasHydrated = useAppStore((s) => s._hasHydrated);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback(async () => {
    // Read current state directly — React closures may be stale during hydration
    const currentConfig = useAppStore.getState().config;
    const profile = currentConfig.sshProfiles.find((p) => p.id === currentConfig.activeProfileId);
    if (!profile) {
      console.error("SSH connect: no profile configured (activeProfileId:", currentConfig.activeProfileId, ", profiles:", currentConfig.sshProfiles.length, ")");
      setConnectionStatus("error", "No SSH profile configured");
      return false;
    }

    console.log("SSH connect: attempting with profile", profile.name, "→", profile.coderUser, "@", profile.host || "(coder alias)");
    setConnectionStatus("connecting");
    try {
      // Write SSH key from vault to temp file if the profile has one
      let keyPath = "";
      if (profile.hasKey) {
        const { getSecret, SECRET_KEYS } = await import("../lib/secrets");
        const keyContent = await getSecret(SECRET_KEYS.sshKey(profile.id));
        if (keyContent) {
          keyPath = await invoke<string>("write_ssh_key", {
            profileId: profile.id,
            keyContent,
          });
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
        return true;
      } else {
        console.error("SSH connect: failed —", result.error);
        setConnectionStatus("error", result.error ?? "Connection failed");
        return false;
      }
    } catch (e) {
      console.error("SSH connect: exception —", e);
      setConnectionStatus("error", String(e));
      return false;
    }
  }, [setConnectionStatus]);

  const fetchGSDData = useCallback(async () => {
    for (const ws of workspaces) {
      try {
        // Run the Python script on the workspace
        const raw = await invoke<string>("exec_in_workspace", {
          workspace: ws.coderName,
          command: `python3 -c '${GSD_FETCH_SCRIPT.replace(/'/g, "'\"'\"'")}'`,
        });

        if (!raw || !raw.trim()) continue;

        let projects: RemoteProjectData[];
        try {
          projects = JSON.parse(raw.trim());
        } catch {
          console.warn(`Failed to parse GSD data from ${ws.coderName}:`, raw.substring(0, 200));
          continue;
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
            // active = has a session with activity in last 60s
            // idle = has a session but no recent activity
            // off = no sessions at all
            const activeSession = details.find((s) => s.idle < 60);
            const isRunning = hasSessions;
            const isActive = !!activeSession;

            // Determine phase from state + session info
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

            // Add token info — total across all units
            if (remote.totalTokens && remote.totalTokens.total > 0) {
              const t = remote.totalTokens;
              const readM = (t.cacheRead + t.input) / 1e6;
              const writeK = t.output / 1e3;
              status.tokensRead = `${readM.toFixed(1)}M`;
              status.tokensWrite = `${writeK.toFixed(0)}K`;
            }

            // Map sessionDetails into TmuxSessionInfo[]
            const tmuxSessions: TmuxSessionInfo[] = details.map((d) => ({
              name: d.name,
              idle: d.idle,
              attached: false, // Python script doesn't track attached status yet
            }));

            setSession({
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
            // No GSD data found — create empty session
            setSession(
              createEmptySession(ws.coderName, proj.path, proj.path, proj.displayName)
            );
          }
        }

        setWorkspaceHealth(ws.coderName, 'ok');
      } catch (e) {
        console.error(`Failed to fetch GSD data from ${ws.coderName}:`, e);
        setWorkspaceHealth(ws.coderName, 'error');
        // Create empty sessions so they still show
        for (const proj of ws.projects) {
          setSession(
            createEmptySession(ws.coderName, proj.path, proj.path, proj.displayName)
          );
        }
      }
    }

    setLastPollTime(Date.now());
  }, [workspaces, setSession, setWorkspaceHealth, setLastPollTime]);

  // Auto-connect + fetch on mount, then poll every 30 seconds
  // Wait for zustand hydration so config.sshProfiles is populated from localStorage
  useEffect(() => {
    if (!hasHydrated) return;

    const init = async () => {
      console.log("SSH init: hydration complete, attempting auto-connect...");
      const connected = await connect();
      if (connected) {
        console.log("SSH init: connected, starting data fetch + 30s poll");
        await fetchGSDData();
        // Poll for updates every 30 seconds
        pollRef.current = setInterval(async () => {
          try {
            await fetchGSDData();
          } catch (e) {
            console.error("Poll error:", e);
          }
        }, 30_000);
      } else {
        console.warn("SSH init: auto-connect failed — no polling started");
      }
    };
    init();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasHydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  return { connect, fetchGSDData };
}
