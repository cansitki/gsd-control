import { useState, useEffect, memo, useRef } from "react";
import { debugInvoke as invoke } from "../lib/debugInvoke";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { useAppStore } from "../stores/appStore";
import { WATCHER_SCRIPT } from "../lib/watcherScript";
import { escapeShellSingleQuote } from "../lib/shell";
import { getDebugLogs, getDebugLogVersion, clearDebugLogs as clearLogBuffer } from "../lib/debugLogBuffer";
import type { SSHProfile, WorkspaceConfig, DebugLevel } from "../lib/types";

function Settings() {
  const config = useAppStore((s) => s.config);
  const connection = useAppStore((s) => s.connection);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const workspaces = useAppStore((s) => s.workspaces);
  const [deployStatus, setDeployStatus] = useState("");
  const [testStatus, setTestStatus] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [addingProfile, setAddingProfile] = useState(false);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [appVersion, setAppVersion] = useState("...");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  // ── Connection ────────────────────────────────────────────────────────

  const handleReconnect = async () => {
    const profile = config.sshProfiles.find((p) => p.id === config.activeProfileId);
    if (!profile) return;

    console.log("Settings: reconnecting with profile", profile.name, "→", profile.coderUser);
    setReconnecting(true);
    setConnectionStatus("connecting");
    try {
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
          console.warn("Settings: key retrieval failed, proceeding without key —", e);
        }
      }
      const result = await invoke<{ connected: boolean; error: string | null }>(
        "ssh_connect",
        { host: profile.host, user: profile.user, keyPath, coderUser: profile.coderUser }
      );
      if (result.connected) {
        console.log("Settings: reconnect success ✓");
        setConnectionStatus("connected");
      } else {
        console.error("Settings: reconnect failed —", result.error);
        setConnectionStatus("error", result.error ?? "Connection failed");
      }
    } catch (e) {
      console.error("Settings: reconnect exception —", e);
      setConnectionStatus("error", String(e));
    }
    setReconnecting(false);
  };

  const handleDisconnect = async () => {
    try {
      await invoke("ssh_disconnect");
      setConnectionStatus("disconnected");
    } catch {
      setConnectionStatus("disconnected");
    }
  };

  // ── Update ────────────────────────────────────────────────────────────

  const handleCheckForUpdates = async () => {
    setIsChecking(true);
    setUpdateStatus("Checking...");
    try {
      const token = config.githubToken || "";
      const info = await invoke<{ available: boolean; version: string | null }>(
        "check_update",
        { githubToken: token }
      );
      if (!info.available) {
        setUpdateStatus("✓ You're on the latest version");
        setIsChecking(false);
        setTimeout(() => setUpdateStatus(""), 4000);
        return;
      }
      setUpdateStatus(`v${info.version} available — downloading & installing...`);
      try {
        await invoke("install_update", { githubToken: token });
        setUpdateStatus("Installed! Restarting...");
        await relaunch();
      } catch (installErr) {
        console.error("install_update failed:", installErr);
        setUpdateStatus(`v${info.version} available — install failed: ${installErr}. Opening download...`);
        const releaseUrl = `https://github.com/cansitki/gsd-control/releases/tag/v${info.version}`;
        invoke("open_url", { url: releaseUrl }).catch(() => {});
        setIsChecking(false);
        setTimeout(() => setUpdateStatus(""), 12000);
      }
    } catch (e) {
      setUpdateStatus(`Failed: ${e}`);
      setIsChecking(false);
      setTimeout(() => setUpdateStatus(""), 6000);
    }
  };

  // ── Telegram ──────────────────────────────────────────────────────────

  const handleTestTelegram = async () => {
    if (!config.telegram.botToken || !config.telegram.chatId) {
      setTestStatus("Missing bot token or chat ID");
      return;
    }
    setTestStatus("Sending...");
    try {
      const ws = workspaces[0];
      await invoke("exec_in_workspace", {
        workspace: ws.coderName,
        command: `curl -s -X POST "https://api.telegram.org/bot${escapeShellSingleQuote(config.telegram.botToken)}/sendMessage" -H "Content-Type: application/json" -d '{"chat_id":"${escapeShellSingleQuote(config.telegram.chatId)}","text":"🧪 GSD Control test message — Telegram is working!"}' >/dev/null 2>&1 && echo ok || echo fail`,
      });
      setTestStatus("✓ Sent!");
    } catch (e) {
      setTestStatus(`Failed: ${e}`);
    }
    setTimeout(() => setTestStatus(""), 3000);
  };

  const handleDeployWatcher = async () => {
    if (workspaces.length === 0) {
      setDeployStatus("No workspaces configured");
      return;
    }
    // Deploy watcher to the first workspace only — it reads the snapshot file
    // written by the app (which has all-workspace data) for /status responses.
    const primaryWs = workspaces[0];
    setDeployStatus(`Deploying watcher to ${primaryWs.displayName}...`);
    try {
      // btoa() only handles Latin1 — use TextEncoder for UTF-8 emoji/unicode
      const utf8Bytes = new TextEncoder().encode(WATCHER_SCRIPT);
      let binary = "";
      for (const byte of utf8Bytes) binary += String.fromCharCode(byte);
      const scriptB64 = btoa(binary);
      const wsName = primaryWs.displayName;
      await invoke("exec_in_workspace", {
        workspace: primaryWs.coderName,
        command: `echo '${scriptB64}' | base64 -d > /home/coder/.gsd-watcher.js`,
      });
      await invoke("exec_in_workspace", {
        workspace: primaryWs.coderName,
        command: `tmux kill-session -t gsd-watcher 2>/dev/null; true`,
      });
      await invoke("exec_in_workspace", {
        workspace: primaryWs.coderName,
        command: `tmux new-session -d -s gsd-watcher 'env TELEGRAM_BOT_TOKEN='"'"'${escapeShellSingleQuote(config.telegram.botToken)}'"'"' TELEGRAM_CHAT_ID='"'"'${escapeShellSingleQuote(config.telegram.chatId)}'"'"' WORKSPACE_NAME='"'"'${escapeShellSingleQuote(wsName)}'"'"' node /home/coder/.gsd-watcher.js 2>&1 | tee /home/coder/.gsd-watcher.log'`,
      });
      setDeployStatus(`✓ Watcher running on ${wsName}`);
    } catch (e) {
      setDeployStatus(`Failed: ${e}`);
    }
    setTimeout(() => setDeployStatus(""), 5000);
  };

  // ── Profile helpers ───────────────────────────────────────────────────

  const handleSaveProfile = (profile: SSHProfile) => {
    const existing = config.sshProfiles.find((p) => p.id === profile.id);
    let profiles: SSHProfile[];
    if (existing) {
      profiles = config.sshProfiles.map((p) => (p.id === profile.id ? profile : p));
    } else {
      profiles = [...config.sshProfiles, profile];
    }
    const activeId = config.activeProfileId || profile.id;
    updateConfig({ sshProfiles: profiles, activeProfileId: activeId });
    setEditingProfile(null);
    setAddingProfile(false);
  };

  const handleRemoveProfile = (id: string) => {
    const profiles = config.sshProfiles.filter((p) => p.id !== id);
    const activeId = config.activeProfileId === id ? (profiles[0]?.id ?? "") : config.activeProfileId;
    updateConfig({ sshProfiles: profiles, activeProfileId: activeId });
  };

  // ── Workspace helpers ─────────────────────────────────────────────────

  const handleRemoveWorkspace = (coderName: string) => {
    useAppStore.getState().removeWorkspace(coderName);
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl mx-auto">
      <h2 className="text-sm font-bold text-base-text mb-6">Settings</h2>

      {/* Connection Status */}
      <section className="mb-8">
        <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider mb-3">
          Connection
        </h3>
        <div className="bg-base-bg border border-base-border rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  connection.status === "connected"
                    ? "bg-accent-green"
                    : connection.status === "connecting"
                      ? "bg-accent-amber animate-pulse"
                      : connection.status === "error"
                        ? "bg-accent-red"
                        : "bg-base-muted/40"
                }`}
              />
              <span className="text-xs font-semibold text-base-text capitalize">
                {connection.status}
              </span>
            </div>
            <div className="flex gap-2">
              {connection.status === "connected" ? (
                <button
                  onClick={handleDisconnect}
                  className="text-xs px-3 py-1 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={handleReconnect}
                  disabled={reconnecting || config.sshProfiles.length === 0}
                  className="text-xs px-3 py-1 rounded border border-accent-green/30 text-accent-green hover:bg-accent-green/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reconnecting ? "Connecting..." : "Connect"}
                </button>
              )}
            </div>
          </div>
          {connection.error && (
            <div className="text-xs text-accent-red bg-accent-red/5 border border-accent-red/20 rounded px-3 py-2 mb-2">
              {connection.error}
            </div>
          )}
          {config.sshProfiles.length > 0 && (
            <div className="text-xs text-base-muted">
              Active profile: {config.sshProfiles.find((p) => p.id === config.activeProfileId)?.name ?? "None"}
              {" · "}
              Coder user: {config.sshProfiles.find((p) => p.id === config.activeProfileId)?.coderUser ?? "—"}
            </div>
          )}
          {config.sshProfiles.length === 0 && (
            <div className="text-xs text-accent-amber">
              No SSH profiles configured. Add one below to connect.
            </div>
          )}
        </div>
      </section>

      {/* SSH Profiles */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider">
            SSH Profiles
          </h3>
          <button
            onClick={() => setAddingProfile(true)}
            className="text-xs px-2 py-1 rounded border border-accent-green/30 text-accent-green hover:bg-accent-green/10 transition-colors"
          >
            + Add Profile
          </button>
        </div>
        <div className="space-y-2">
          {config.sshProfiles.map((profile) => (
            editingProfile === profile.id ? (
              <ProfileEditor
                key={profile.id}
                profile={profile}
                onSave={handleSaveProfile}
                onCancel={() => setEditingProfile(null)}
              />
            ) : (
              <div
                key={profile.id}
                className={`bg-base-bg border rounded p-3 transition-colors ${
                  profile.id === config.activeProfileId
                    ? "border-accent-orange/50"
                    : "border-base-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        profile.id === config.activeProfileId ? "bg-accent-green" : "bg-base-muted/40"
                      }`}
                    />
                    <span className="text-xs font-semibold text-base-text">{profile.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingProfile(profile.id)}
                      className="text-xs px-2 py-0.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors"
                    >
                      Edit
                    </button>
                    {profile.id !== config.activeProfileId && (
                      <button
                        onClick={() => updateConfig({ activeProfileId: profile.id })}
                        className="text-xs px-2 py-0.5 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors"
                      >
                        Activate
                      </button>
                    )}
                    <button
                      onClick={() => handleRemoveProfile(profile.id)}
                      className="text-xs px-2 py-0.5 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="text-xs text-base-muted mt-1.5 space-y-0.5">
                  <div>Host: <span className="text-base-text">{profile.host || "—"}</span></div>
                  <div>User: <span className="text-base-text">{profile.user || "—"}</span></div>
                  <div>Coder User: <span className="text-base-text">{profile.coderUser || "—"}</span></div>
                  <div>SSH Alias: <span className="text-base-text font-mono">main.&lt;workspace&gt;.{profile.coderUser || "?"}.coder</span></div>
                  {profile.hasKey && <div className="text-accent-green">🔑 SSH key stored in vault</div>}
                </div>
              </div>
            )
          ))}
          {addingProfile && (
            <ProfileEditor
              onSave={handleSaveProfile}
              onCancel={() => setAddingProfile(false)}
            />
          )}
          {config.sshProfiles.length === 0 && !addingProfile && (
            <p className="text-xs text-base-muted">No profiles configured. Click "Add Profile" to set up SSH.</p>
          )}
        </div>
      </section>

      {/* Monitored Workspaces */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider">
            Monitored Workspaces
          </h3>
          <button
            onClick={() => setAddingWorkspace(true)}
            className="text-xs px-2 py-1 rounded border border-accent-green/30 text-accent-green hover:bg-accent-green/10 transition-colors"
          >
            + Add Workspace
          </button>
        </div>
        <div className="space-y-2">
          {workspaces.map((ws) => (
            <WorkspaceCard
              key={ws.coderName}
              ws={ws}
              coderUser={config.sshProfiles.find((p) => p.id === config.activeProfileId)?.coderUser}
              connected={connection.status === "connected"}
              onRemove={() => handleRemoveWorkspace(ws.coderName)}
            />
          ))}
          {addingWorkspace && (
            <AddWorkspaceInline
              workspaces={workspaces}
              onClose={() => setAddingWorkspace(false)}
            />
          )}
          {workspaces.length === 0 && !addingWorkspace && (
            <p className="text-xs text-base-muted">No workspaces configured. Click "Add Workspace" to monitor one.</p>
          )}
        </div>
      </section>

      {/* Telegram */}
      <section className="mb-8">
        <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider mb-3">
          Telegram Notifications
        </h3>
        <div className="space-y-3">
          <Field
            label="Bot Token"
            value={config.telegram.botToken}
            onChange={(v) =>
              updateConfig({ telegram: { ...config.telegram, botToken: v } })
            }
            placeholder="123456:ABC-DEF..."
          />
          <Field
            label="Chat ID"
            value={config.telegram.chatId}
            onChange={(v) =>
              updateConfig({ telegram: { ...config.telegram, chatId: v } })
            }
            placeholder="Your chat ID"
          />
          <div className="flex gap-2">
            <button
              onClick={handleTestTelegram}
              className="text-xs px-3 py-1.5 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              Test Message
            </button>
            <button
              onClick={handleDeployWatcher}
              className="text-xs px-3 py-1.5 rounded border border-accent-orange/30 text-accent-orange hover:bg-accent-orange/10 transition-colors"
            >
              Restart Watchers
            </button>
            {(testStatus || deployStatus) && (
              <span className="text-xs text-base-muted self-center">
                {testStatus || deployStatus}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Notification Triggers */}
      <section className="mb-8">
        <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider mb-3">
          Notification Triggers
        </h3>
        <div className="space-y-2">
          <Toggle
            label="Milestone Complete"
            checked={config.notifications.milestoneComplete}
            onChange={(v) =>
              updateConfig({ notifications: { ...config.notifications, milestoneComplete: v } })
            }
          />
          <Toggle
            label="Auto-mode Stopped"
            checked={config.notifications.autoStop}
            onChange={(v) =>
              updateConfig({ notifications: { ...config.notifications, autoStop: v } })
            }
          />
          <Toggle
            label="Errors & Crashes"
            checked={config.notifications.errors}
            onChange={(v) =>
              updateConfig({ notifications: { ...config.notifications, errors: v } })
            }
          />
          <Toggle
            label="Silent Stop (bar disappears)"
            checked={config.notifications.silentStop}
            onChange={(v) =>
              updateConfig({ notifications: { ...config.notifications, silentStop: v } })
            }
          />
          <Toggle
            label="Rate Limit Hit"
            checked={config.notifications.rateLimitHit}
            onChange={(v) =>
              updateConfig({ notifications: { ...config.notifications, rateLimitHit: v } })
            }
          />
        </div>
      </section>

      {/* Cost Alert */}
      <section className="mb-8">
        <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider mb-3">
          Cost Alert
        </h3>
        <Field
          label="Alert threshold ($)"
          value={config.costAlertThreshold?.toString() ?? ""}
          onChange={(v) =>
            updateConfig({ costAlertThreshold: v ? parseFloat(v) : null })
          }
          placeholder="e.g. 100"
        />
      </section>

      {/* App */}
      <section className="mb-8">
        <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider mb-3">
          App
        </h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-base-muted">
              Version: {appVersion}
            </span>
            <button
              onClick={handleCheckForUpdates}
              disabled={isChecking}
              className="text-xs px-3 py-1.5 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isChecking ? "Checking..." : "Check for Updates"}
            </button>
            {updateStatus && (
              <span className="text-xs text-base-muted">{updateStatus}</span>
            )}
          </div>
          <Field
            label="GitHub Token (optional)"
            value={config.githubToken}
            onChange={(v) => updateConfig({ githubToken: v })}
            placeholder="ghp_..."
            type="password"
          />
          <p className="text-xs text-base-muted/60">
            Optional. Only needed for private repositories.
          </p>
        </div>
      </section>

      {/* Debug Logs — isolated component to avoid re-rendering entire Settings on every log entry */}
      <DebugLogsSection />
    </div>
  );
}

// ── DebugLogsSection — isolated to avoid re-rendering Settings on every log ──

const DebugLogsSection = memo(function DebugLogsSection() {
  const debugLevel = useAppStore((s) => s.debugLevel);
  const setDebugLevel = useAppStore((s) => s.setDebugLevel);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logCount, setLogCount] = useState(0);

  // Poll the ring buffer every 500ms when visible — zero Zustand overhead
  useEffect(() => {
    let lastVersion = -1;

    const tick = () => {
      const v = getDebugLogVersion();
      if (v !== lastVersion) {
        lastVersion = v;
        const all = getDebugLogs();
        setLogs(all.slice(-200));
        setLogCount(all.length);
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }
    };
    tick(); // initial read
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="mb-8">
      <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider mb-3">
        Debug Logs
      </h3>
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          {(["off", "normal", "extreme"] as DebugLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => setDebugLevel(level)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors capitalize ${
                debugLevel === level
                  ? "bg-accent-blue/20 text-accent-blue border-accent-blue/50"
                  : "border-base-border text-base-muted hover:text-base-text"
              }`}
            >
              {level}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(logs.join("\n")).catch(() => {});
            }}
            className="text-xs px-3 py-1.5 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors"
          >
            📋 Copy Logs
          </button>
          <button
            onClick={() => { clearLogBuffer(); setLogs([]); setLogCount(0); }}
            className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors"
          >
            Clear
          </button>
          <span className="text-xs text-base-muted">{logCount} entries</span>
        </div>
        <div ref={scrollRef} className="bg-base-bg border border-base-border rounded p-2 max-h-[300px] overflow-y-auto font-mono">
          {logs.length === 0 ? (
            <p className="text-xs text-base-muted">No logs yet — logs are captured automatically.</p>
          ) : (
            logs.map((log, i) => (
              <div
                key={i}
                className={`text-xs py-0.5 ${
                  log.includes("ERROR") || log.includes("UNCAUGHT") || log.includes("REJECTION")
                    ? "text-accent-red"
                    : log.includes("WARN")
                      ? "text-accent-amber"
                      : "text-base-muted"
                }`}
              >
                {log}
              </div>
            ))
          )}
        </div>
        <p className="text-xs text-base-muted/60">
          Last 200 of {logCount}. Max 5000 entries (~200 min).{" "}
          {debugLevel === "off"
            ? "Logging off — only uncaught errors captured."
            : debugLevel === "normal"
              ? "SSH lifecycle, connections, and errors."
              : "Full tracing — invoke calls, state mutations, console output."}
        </p>
      </div>
    </section>
  );
});

// ── ProfileEditor ─────────────────────────────────────────────────────────

function ProfileEditor({
  profile,
  onSave,
  onCancel,
}: {
  profile?: SSHProfile;
  onSave: (p: SSHProfile) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [host, setHost] = useState(profile?.host ?? "");
  const [user, setUser] = useState(profile?.user ?? "admin");
  const [coderUser, setCoderUser] = useState(profile?.coderUser ?? "");
  const id = profile?.id ?? crypto.randomUUID();

  return (
    <div className="bg-base-bg border border-accent-orange/40 rounded p-4 space-y-3">
      <div className="text-xs font-semibold text-base-text mb-1">
        {profile ? "Edit Profile" : "New SSH Profile"}
      </div>
      <Field label="Profile Name" value={name} onChange={setName} placeholder="e.g. My Coder" />
      <Field label="Host (EC2 IP or domain)" value={host} onChange={setHost} placeholder="e.g. 3.91.xxx.xxx" />
      <Field label="SSH User" value={user} onChange={setUser} placeholder="admin" />
      <Field label="Coder Username" value={coderUser} onChange={setCoderUser} placeholder="e.g. cansitki" />
      <p className="text-xs text-base-muted/60">
        SSH alias format: main.&lt;workspace&gt;.{coderUser || "<coder_user>"}.coder
      </p>
      <div className="flex gap-2">
        <button
          onClick={() =>
            onSave({
              id,
              name: name || coderUser || "Default",
              host,
              user,
              coderUser,
              hasKey: profile?.hasKey ?? false,
            })
          }
          disabled={!coderUser.trim()}
          className="text-xs px-3 py-1.5 rounded border border-accent-green/30 text-accent-green hover:bg-accent-green/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {profile ? "Save" : "Add Profile"}
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── WorkspaceCard ─────────────────────────────────────────────────────────

function WorkspaceCard({
  ws,
  coderUser,
  connected,
  onRemove,
}: {
  ws: WorkspaceConfig;
  coderUser?: string;
  connected: boolean;
  onRemove: () => void;
}) {
  const [testLog, setTestLog] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const addProject = useAppStore((s) => s.addProject);

  const handleTest = async () => {
    setTesting(true);
    const log: string[] = [];
    const addLog = (msg: string) => { log.push(msg); setTestLog([...log]); };

    const alias = `main.${ws.coderName}.${coderUser || "?"}.coder`;
    addLog(`SSH alias: ${alias}`);
    addLog(`Testing connection...`);

    try {
      const result = await invoke<string>("exec_in_workspace", {
        workspace: ws.coderName,
        command: "echo ok",
      });
      if (result.trim() === "ok") {
        addLog(`✓ Connection OK`);
      } else {
        addLog(`⚠ Unexpected response: ${result.trim()}`);
      }
    } catch (e) {
      addLog(`✗ Connection failed: ${e}`);
      setTesting(false);
      return;
    }

    // Check tmux
    addLog(`Checking tmux sessions...`);
    try {
      const tmux = await invoke<string>("exec_in_workspace", {
        workspace: ws.coderName,
        command: "tmux list-sessions -F '#{session_name} (#{session_windows}w, #{?session_attached,attached,detached})' 2>/dev/null || echo 'no sessions'",
      });
      const lines = tmux.trim().split("\n").filter((l) => l.trim());
      if (lines.length === 1 && lines[0] === "no sessions") {
        addLog(`  No tmux sessions`);
      } else {
        for (const line of lines) {
          addLog(`  ${line.trim()}`);
        }
      }
    } catch {
      addLog(`  Could not list tmux sessions`);
    }

    // Check GSD projects
    addLog(`Scanning for GSD projects...`);
    try {
      const projects = await invoke<string>("exec_in_workspace", {
        workspace: ws.coderName,
        command: "for d in ~/*/; do [ -d \"$d/.gsd\" ] && basename \"$d\"; done 2>/dev/null",
      });
      const found = projects.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("."));
      if (found.length > 0) {
        addLog(`  Found ${found.length}: ${found.join(", ")}`);
        // Auto-add any missing projects
        const missing = found.filter((p) => !ws.projects.some((ep) => ep.path === p));
        if (missing.length > 0) {
          for (const p of missing) {
            addProject(ws.coderName, { path: p, displayName: p });
          }
          addLog(`  ✓ Added ${missing.length} new project${missing.length !== 1 ? "s" : ""}`);
        }
      } else {
        addLog(`  No GSD projects found`);
      }
    } catch {
      addLog(`  Could not scan projects`);
    }

    addLog(`Done.`);
    setTesting(false);
  };

  return (
    <div className="bg-base-bg border border-base-border rounded p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-base-text">{ws.displayName}</div>
        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={testing || !connected}
            className="text-xs px-2 py-0.5 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? "Testing..." : "Test"}
          </button>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="text-xs px-2 py-0.5 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors"
            >
              Remove
            </button>
          ) : (
            <div className="flex gap-1">
              <button
                onClick={() => { onRemove(); setConfirming(false); }}
                className="text-xs px-2 py-0.5 rounded bg-accent-red/20 text-accent-red hover:bg-accent-red/30 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-xs px-2 py-0.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="text-xs text-base-muted mt-1.5 space-y-0.5">
        <div>Coder name: <span className="text-base-text font-mono">{ws.coderName}</span></div>
        <div>SSH alias: <span className="text-base-text font-mono">main.{ws.coderName}.{coderUser || "?"}.coder</span></div>
        <div>Projects: <span className="text-base-text">{ws.projects.length > 0 ? ws.projects.map((p) => p.displayName).join(", ") : "none"}</span></div>
      </div>
      {testLog.length > 0 && (
        <div className="mt-2 bg-base-surface border border-base-border rounded p-2 max-h-[150px] overflow-y-auto font-mono">
          {testLog.map((line, i) => (
            <div key={i} className={`text-xs py-0.5 ${
              line.startsWith("✓") ? "text-accent-green"
                : line.startsWith("✗") ? "text-accent-red"
                  : line.startsWith("⚠") ? "text-accent-amber"
                    : "text-base-muted"
            }`}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AddWorkspaceInline ────────────────────────────────────────────────────

function AddWorkspaceInline({
  workspaces,
  onClose,
}: {
  workspaces: WorkspaceConfig[];
  onClose: () => void;
}) {
  const [sshCommand, setSshCommand] = useState("");
  const [wsName, setWsName] = useState("");
  const [wsDisplay, setWsDisplay] = useState("");
  const [status, setStatus] = useState("");
  const [parsed, setParsed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testLog, setTestLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const handleParse = () => {
    const cmd = sshCommand.trim();
    let match = cmd.match(/ssh\s+coder\.(\S+)/i);
    if (match) { setWsName(match[1]); setParsed(true); setStatus(""); return; }
    match = cmd.match(/ssh\s+main\.(\S+?)\.(\S+?)\.coder/i);
    if (match) { setWsName(match[1]); setParsed(true); setStatus(""); return; }
    if (cmd && !cmd.includes(" ")) { setWsName(cmd); setParsed(true); setStatus(""); return; }
    setStatus("Could not parse. Paste the SSH command from Coder, or type the workspace name.");
  };

  const handleAdd = async () => {
    const name = wsName.trim();
    if (!name) { setStatus("Workspace name required"); return; }
    if (workspaces.some((w) => w.coderName === name)) { setStatus("Workspace already exists"); return; }

    setTesting(true);
    const log: string[] = [];
    const addLog = (msg: string) => { log.push(msg); setTestLog([...log]); };

    addLog(`Connecting to ${name}...`);
    let reachable = false;
    try {
      await invoke("exec_in_workspace", { workspace: name, command: "echo ok" });
      reachable = true;
      addLog(`✓ Connection OK`);
    } catch (e) {
      addLog(`✗ Connection failed: ${e}`);
    }

    // Add workspace
    const displayName = wsDisplay.trim() || name;
    useAppStore.getState().addWorkspace({ coderName: name, displayName, projects: [] });
    addLog(`✓ Workspace "${displayName}" added`);

    if (reachable) {
      addLog(`Scanning for GSD projects...`);
      try {
        const output = await invoke<string>("exec_in_workspace", {
          workspace: name,
          command: "for d in ~/*/; do [ -d \"$d/.gsd\" ] && basename \"$d\"; done 2>/dev/null",
        });
        const projects = output.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("."));
        if (projects.length > 0) {
          useAppStore.getState().updateWorkspace(name, {
            projects: projects.map((p) => ({ path: p, displayName: p })),
          });
          addLog(`✓ Found ${projects.length} project${projects.length !== 1 ? "s" : ""}: ${projects.join(", ")}`);
        } else {
          addLog(`  No GSD projects found — add from sidebar`);
        }
      } catch {
        addLog(`  Could not scan for projects`);
      }
    }

    addLog(`Done.`);
    setTesting(false);
    setDone(true);
  };

  return (
    <div className="bg-base-bg border border-accent-green/40 rounded p-4 space-y-3">
      <div className="text-xs font-semibold text-base-text mb-1">Add Workspace</div>
      {done ? (
        <>
          <div className="bg-base-surface border border-base-border rounded p-2 max-h-[150px] overflow-y-auto font-mono">
            {testLog.map((line, i) => (
              <div key={i} className={`text-xs py-0.5 ${
                line.startsWith("✓") ? "text-accent-green"
                  : line.startsWith("✗") ? "text-accent-red"
                    : "text-base-muted"
              }`}>{line}</div>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={onClose}
              className="text-xs px-3 py-1.5 rounded bg-accent-orange text-white hover:opacity-90 transition-opacity">
              Done
            </button>
          </div>
        </>
      ) : !parsed ? (
        <>
          <p className="text-xs text-base-muted">
            Paste the SSH command from Coder, or type the workspace name.
          </p>
          <Field
            label="SSH Command or Workspace Name"
            value={sshCommand}
            onChange={setSshCommand}
            placeholder='ssh coder.my-workspace  or  my-workspace'
          />
          {status && <p className="text-xs text-accent-red">{status}</p>}
          <div className="flex gap-2">
            <button onClick={handleParse} disabled={!sshCommand.trim()}
              className="text-xs px-3 py-1.5 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors disabled:opacity-50">
              Next
            </button>
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors">Cancel</button>
          </div>
        </>
      ) : (
        <>
          <Field label="Workspace Name" value={wsName} onChange={setWsName} placeholder="workspace-name" />
          <Field label="Display Name (optional)" value={wsDisplay} onChange={setWsDisplay} placeholder={wsName || "Display name"} />
          {testLog.length > 0 && (
            <div className="bg-base-surface border border-base-border rounded p-2 max-h-[100px] overflow-y-auto font-mono">
              {testLog.map((line, i) => (
                <div key={i} className={`text-xs py-0.5 ${
                  line.startsWith("✓") ? "text-accent-green"
                    : line.startsWith("✗") ? "text-accent-red"
                      : "text-base-muted"
                }`}>{line}</div>
              ))}
            </div>
          )}
          {status && <p className="text-xs text-accent-amber">{status}</p>}
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={testing || !wsName.trim()}
              className="text-xs px-3 py-1.5 rounded border border-accent-green/30 text-accent-green hover:bg-accent-green/10 transition-colors disabled:opacity-50">
              {testing ? "Adding..." : "Add & Discover"}
            </button>
            <button onClick={() => { setParsed(false); setSshCommand(""); }} disabled={testing}
              className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors disabled:opacity-50">Back</button>
            <button onClick={onClose} disabled={testing}
              className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text transition-colors disabled:opacity-50">Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Shared Components ─────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-base-muted mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between py-1 cursor-pointer">
      <span className="text-xs text-base-text">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${
          checked ? "bg-accent-green" : "bg-base-border"
        }`}
      >
        <span
          className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

export default Settings;
