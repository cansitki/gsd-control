import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { useAppStore } from "../stores/appStore";
import { WATCHER_SCRIPT } from "../lib/watcherScript";
import { escapeShellSingleQuote } from "../lib/shell";

const APP_VERSION = "1.0.3";

function Settings() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const workspaces = useAppStore((s) => s.workspaces);
  const [deployStatus, setDeployStatus] = useState("");
  const [testStatus, setTestStatus] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

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
      } catch {
        // Auto-install failed — open release page
        setUpdateStatus(`v${info.version} available — opening download...`);
        const releaseUrl = `https://github.com/cansitki/gsd-control/releases/tag/v${info.version}`;
        invoke("open_url", { url: releaseUrl }).catch(() => {});
        setIsChecking(false);
        setTimeout(() => setUpdateStatus(""), 8000);
      }
    } catch (e) {
      setUpdateStatus(`Failed: ${e}`);
      setIsChecking(false);
      setTimeout(() => setUpdateStatus(""), 6000);
    }
  };


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
    setDeployStatus("Deploying to both workspaces...");
    try {
      // Base64 encode the watcher script to avoid shell escaping issues
      const scriptB64 = btoa(WATCHER_SCRIPT);

      for (const ws of workspaces) {
        const wsName = ws.displayName;

        // Upload the watcher script via base64
        await invoke("exec_in_workspace", {
          workspace: ws.coderName,
          command: `echo '${scriptB64}' | base64 -d > /home/coder/.gsd-watcher.js`,
        });

        // Kill existing session, then start fresh
        await invoke("exec_in_workspace", {
          workspace: ws.coderName,
          command: `tmux kill-session -t gsd-watcher 2>/dev/null; true`,
        });
        await invoke("exec_in_workspace", {
          workspace: ws.coderName,
          command: `TELEGRAM_BOT_TOKEN='${escapeShellSingleQuote(config.telegram.botToken)}' TELEGRAM_CHAT_ID='${escapeShellSingleQuote(config.telegram.chatId)}' WORKSPACE_NAME='${escapeShellSingleQuote(wsName)}' tmux new-session -d -s gsd-watcher "node /home/coder/.gsd-watcher.js 2>&1 | tee /home/coder/.gsd-watcher.log"`,
        });
      }
      setDeployStatus("✓ Watchers restarted on both workspaces");
    } catch (e) {
      setDeployStatus(`Failed: ${e}`);
    }
    setTimeout(() => setDeployStatus(""), 5000);
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl">
      <h2 className="text-sm font-bold text-base-text mb-6">Settings</h2>

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
              className="text-[10px] px-3 py-1.5 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              Test Message
            </button>
            <button
              onClick={handleDeployWatcher}
              className="text-[10px] px-3 py-1.5 rounded border border-accent-orange/30 text-accent-orange hover:bg-accent-orange/10 transition-colors"
            >
              Restart Watchers
            </button>
            {(testStatus || deployStatus) && (
              <span className="text-[10px] text-base-muted self-center">
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
              updateConfig({
                notifications: { ...config.notifications, milestoneComplete: v },
              })
            }
          />
          <Toggle
            label="Auto-mode Stopped"
            checked={config.notifications.autoStop}
            onChange={(v) =>
              updateConfig({
                notifications: { ...config.notifications, autoStop: v },
              })
            }
          />
          <Toggle
            label="Errors & Crashes"
            checked={config.notifications.errors}
            onChange={(v) =>
              updateConfig({
                notifications: { ...config.notifications, errors: v },
              })
            }
          />
          <Toggle
            label="Silent Stop (bar disappears)"
            checked={config.notifications.silentStop}
            onChange={(v) =>
              updateConfig({
                notifications: { ...config.notifications, silentStop: v },
              })
            }
          />
          <Toggle
            label="Rate Limit Hit"
            checked={config.notifications.rateLimitHit}
            onChange={(v) =>
              updateConfig({
                notifications: { ...config.notifications, rateLimitHit: v },
              })
            }
          />
        </div>
      </section>

      {/* SSH Profiles */}
      <section className="mb-8">
        <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider mb-3">
          SSH Profiles
        </h3>
        <div className="space-y-2">
          {config.sshProfiles.map((profile) => (
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
                  {profile.id !== config.activeProfileId && (
                    <button
                      onClick={() => updateConfig({ activeProfileId: profile.id })}
                      className="text-[9px] px-2 py-0.5 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const profiles = config.sshProfiles.filter((p) => p.id !== profile.id);
                      const activeId = config.activeProfileId === profile.id
                        ? profiles[0]?.id ?? ""
                        : config.activeProfileId;
                      updateConfig({ sshProfiles: profiles, activeProfileId: activeId });
                    }}
                    className="text-[9px] px-2 py-0.5 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-base-muted mt-1">{profile.host}</div>
              <div className="text-[10px] text-base-muted">
                {profile.user}@{profile.coderUser}.coder
                {profile.hasKey && " · 🔑 key stored"}
              </div>
            </div>
          ))}
          {config.sshProfiles.length === 0 && (
            <p className="text-[10px] text-base-muted">No profiles configured.</p>
          )}
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

      {/* Workspace Info */}
      <section className="mb-8">
        <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider mb-3">
          Monitored Workspaces
        </h3>
        <div className="space-y-2">
          {workspaces.map((ws) => (
            <div key={ws.coderName} className="bg-base-bg border border-base-border rounded p-3">
              <div className="text-xs font-semibold text-base-text">{ws.displayName}</div>
              <div className="text-[10px] text-base-muted mt-1">
                SSH: main.{ws.coderName}.{config.sshProfiles.find((p) => p.id === config.activeProfileId)?.coderUser || "?"}.coder
              </div>
              <div className="text-[10px] text-base-muted mt-0.5">
                Projects: {ws.projects.map((p) => p.displayName).join(", ")}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* App */}
      <section className="mb-8">
        <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider mb-3">
          App
        </h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-base-muted">
              Version: {APP_VERSION}
            </span>
            <button
              onClick={handleCheckForUpdates}
              disabled={isChecking}
              className="text-[10px] px-3 py-1.5 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isChecking ? "Checking..." : "Check for Updates"}
            </button>
            {updateStatus && (
              <span className="text-[10px] text-base-muted">{updateStatus}</span>
            )}
          </div>
          <Field
            label="GitHub Token (optional — for private repos)"
            value={config.githubToken}
            onChange={(v) => updateConfig({ githubToken: v })}
            placeholder="ghp_..."
            type="password"
          />
          <p className="text-[10px] text-base-muted/60">
            Requires a token with <span className="text-base-muted">repo</span> scope.{" "}
            Create one at GitHub → Settings → Developer settings → Personal access tokens.
          </p>
        </div>
      </section>

      {/* Debug */}
      <section className="mb-8">
        <h3 className="text-xs font-semibold text-accent-orange uppercase tracking-wider mb-3">
          Debug
        </h3>
        <div className="space-y-3">
          <Toggle
            label="Debug Mode"
            checked={debugMode}
            onChange={(v) => {
              setDebugMode(v);
              if (v) {
                // Capture console logs
                const logs: string[] = [];
                const ts = () => new Date().toLocaleTimeString();

                // Capture existing state
                const state = useAppStore.getState();
                logs.push(`[${ts()}] App version: ${APP_VERSION}`);
                logs.push(`[${ts()}] Connection: ${state.connection.status}`);
                logs.push(`[${ts()}] SSH Profiles: ${state.config.sshProfiles.length}`);
                logs.push(`[${ts()}] Active profile: ${state.config.activeProfileId}`);
                logs.push(`[${ts()}] Workspaces: ${state.workspaces.map(w => w.coderName).join(", ") || "none"}`);
                logs.push(`[${ts()}] Sessions: ${Object.keys(state.sessions).length}`);
                logs.push(`[${ts()}] Terminal tabs: ${state.terminalTabs.length}`);
                logs.push(`[${ts()}] Layout: ${state.terminalLayout}`);

                // Override console to capture
                const origLog = console.log;
                const origWarn = console.warn;
                const origError = console.error;
                console.log = (...args: unknown[]) => { logs.push(`[${ts()}] LOG: ${args.map(String).join(" ")}`); origLog(...args); };
                console.warn = (...args: unknown[]) => { logs.push(`[${ts()}] WARN: ${args.map(String).join(" ")}`); origWarn(...args); };
                console.error = (...args: unknown[]) => { logs.push(`[${ts()}] ERROR: ${args.map(String).join(" ")}`); origError(...args); };

                // Capture unhandled errors
                const errorHandler = (e: ErrorEvent) => {
                  logs.push(`[${ts()}] UNCAUGHT: ${e.message} at ${e.filename}:${e.lineno}`);
                };
                window.addEventListener("error", errorHandler);

                // Capture promise rejections
                const rejectionHandler = (e: PromiseRejectionEvent) => {
                  logs.push(`[${ts()}] REJECTION: ${e.reason}`);
                };
                window.addEventListener("unhandledrejection", rejectionHandler);

                setDebugLogs(logs);

                // Poll for new logs
                const interval = setInterval(() => {
                  setDebugLogs([...logs]);
                }, 1000);

                // Store cleanup refs on window
                (window as any).__debugCleanup = () => {
                  console.log = origLog;
                  console.warn = origWarn;
                  console.error = origError;
                  window.removeEventListener("error", errorHandler);
                  window.removeEventListener("unhandledrejection", rejectionHandler);
                  clearInterval(interval);
                };
              } else {
                // Restore console
                if ((window as any).__debugCleanup) {
                  (window as any).__debugCleanup();
                  delete (window as any).__debugCleanup;
                }
                setDebugLogs([]);
              }
            }}
          />
          {debugMode && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(debugLogs.join("\n")).catch(() => {});
                  }}
                  className="text-[10px] px-3 py-1.5 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors"
                >
                  📋 Copy Logs
                </button>
                <span className="text-[9px] text-base-muted">{debugLogs.length} entries</span>
              </div>
              <div className="bg-base-bg border border-base-border rounded p-2 max-h-[300px] overflow-y-auto font-mono">
                {debugLogs.length === 0 ? (
                  <p className="text-[9px] text-base-muted">No logs yet...</p>
                ) : (
                  debugLogs.map((log, i) => (
                    <div
                      key={i}
                      className={`text-[9px] py-0.5 ${
                        log.includes("ERROR") || log.includes("UNCAUGHT")
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
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

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
      <label className="block text-[10px] text-base-muted mb-1">{label}</label>
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
