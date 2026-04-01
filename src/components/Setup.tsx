import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import type { SSHProfile } from "../lib/types";

function Setup() {
  const updateConfig = useAppStore((s) => s.updateConfig);
  const config = useAppStore((s) => s.config);
  const addProject = useAppStore((s) => s.addProject);

  const [step, setStep] = useState(0);

  // Profile fields
  const [profileName, setProfileName] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [coderUser, setCoderUser] = useState("");
  const [keyFileName, setKeyFileName] = useState("");
  const [keyContent, setKeyContent] = useState("");
  const [useCoder, setUseCoder] = useState(true);

  // Workspace fields
  const [wsName, setWsName] = useState("");
  const [wsDisplay, setWsDisplay] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [projectDisplay, setProjectDisplay] = useState("");

  // Discovery
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<{ workspace: string; projects: string[] }[]>([]);

  const [testing, setTesting] = useState(false);
  const [connectionOk, setConnectionOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleKeyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setKeyFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setKeyContent(ev.target?.result as string);
    };
    reader.readAsText(file);
    setConnectionOk(false);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setError("");
    try {
      // Write SSH key to temp if provided
      let keyPath = "";
      if (keyContent) {
        keyPath = await invoke<string>("write_ssh_key", {
          profileId: "setup-temp",
          keyContent,
        });
      }

      // Test connection
      const result = await invoke<{ connected: boolean; error: string | null }>(
        "ssh_connect",
        {
          host: sshHost,
          user: sshUser || "admin",
          keyPath,
          coderUser: useCoder ? coderUser : "",
        }
      );

      if (result.connected) {
        setConnectionOk(true);
        setError("");
        setStep(2);
        // Auto-discover if using Coder
        if (useCoder && coderUser) {
          setTimeout(() => handleDiscover(), 300);
        }
      } else {
        setConnectionOk(false);
        setError(result.error || "Connection failed");
      }
    } catch (e) {
      setConnectionOk(false);
      setError(String(e));
    }
    setTesting(false);
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setError("");
    try {
      const testNames = useCoder
        ? [coderUser, wsName].filter(Boolean)
        : [wsName || "default"].filter(Boolean);

      const results: { workspace: string; projects: string[] }[] = [];
      for (const name of testNames) {
        try {
          const output = await invoke<string>("exec_in_workspace", {
            workspace: useCoder ? name : sshHost,
            command: "ls -d ~/*/ 2>/dev/null | while read d; do basename \"$d\"; done",
          });
          const projects = output
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("."));
          if (projects.length > 0 || testNames.length === 1) {
            results.push({ workspace: name, projects });
          }
        } catch {
          // workspace unreachable
        }
      }

      setDiscovered(results);
      if (results.length > 0 && !wsName) {
        setWsName(results[0].workspace);
        if (results[0].projects.length > 0) {
          setProjectPath(results[0].projects[0]);
        }
      }
    } catch (e) {
      setError(String(e));
    }
    setDiscovering(false);
  };

  const handleFinish = async () => {
    setSaving(true);
    setError("");
    try {
      const id = `profile-${Date.now()}`;
      const profile: SSHProfile = {
        id,
        name: profileName || sshHost || coderUser,
        host: sshHost,
        user: sshUser || "admin",
        coderUser: useCoder ? coderUser : "",
        hasKey: !!keyContent,
      };

      if (keyContent) {
        try {
          const { setSecret, SECRET_KEYS } = await import("../lib/secrets");
          await setSecret(SECRET_KEYS.sshKey(id), keyContent);
        } catch {
          // Stronghold not ready yet
        }
      }

      updateConfig({
        sshProfiles: [...(config.sshProfiles || []), profile],
        activeProfileId: id,
      });

      if (wsName && projectPath) {
        addProject(wsName, {
          path: projectPath,
          displayName: projectDisplay || projectPath,
        });
        if (wsDisplay && wsDisplay !== wsName) {
          const store = useAppStore.getState();
          const updated = store.workspaces.map((ws) =>
            ws.coderName === wsName ? { ...ws, displayName: wsDisplay } : ws
          );
          useAppStore.setState({ workspaces: updated });
        }
      }
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const handleSkipWorkspace = async () => {
    setSaving(true);
    setError("");
    try {
      const id = `profile-${Date.now()}`;
      const profile: SSHProfile = {
        id,
        name: profileName || sshHost || coderUser,
        host: sshHost,
        user: sshUser || "admin",
        coderUser: useCoder ? coderUser : "",
        hasKey: !!keyContent,
      };

      if (keyContent) {
        try {
          const { setSecret, SECRET_KEYS } = await import("../lib/secrets");
          await setSecret(SECRET_KEYS.sshKey(id), keyContent);
        } catch { /* */ }
      }

      updateConfig({
        sshProfiles: [...(config.sshProfiles || []), profile],
        activeProfileId: id,
      });
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const steps = [
    // Step 0: Welcome
    <div key="welcome" className="text-center">
      <h2 className="text-xl font-bold text-accent-orange mb-2">GSD Control</h2>
      <p className="text-sm text-base-muted mb-8">
        Monitor and manage your projects on remote servers.
      </p>
      <button
        onClick={() => setStep(1)}
        className="px-6 py-2 rounded bg-accent-orange text-white text-sm hover:opacity-90 transition-opacity"
      >
        Get Started
      </button>
    </div>,

    // Step 1: SSH Connection
    <div key="ssh">
      <h3 className="text-sm font-bold text-base-text mb-1">SSH Connection</h3>
      <p className="text-[11px] text-base-muted mb-4">
        Connect to your remote server via SSH.
      </p>
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] text-base-muted mb-1">Profile Name (optional)</label>
          <input
            type="text" value={profileName}
            onChange={(e) => { setProfileName(e.target.value); }}
            placeholder="e.g. My Server"
            className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[10px] text-base-muted mb-1">Host (IP or hostname)</label>
          <input
            type="text" value={sshHost}
            onChange={(e) => { setSshHost(e.target.value); setConnectionOk(false); }}
            placeholder="e.g. 192.168.1.100 or ec2-xx-xx.compute.amazonaws.com"
            className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] text-base-muted mb-1">SSH User</label>
          <input
            type="text" value={sshUser}
            onChange={(e) => { setSshUser(e.target.value); setConnectionOk(false); }}
            placeholder="e.g. admin, ubuntu, root"
            className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] text-base-muted mb-1">SSH Key (.pem or private key file)</label>
          <label className={`flex items-center gap-2 border border-dashed rounded px-3 py-2 cursor-pointer transition-colors ${
            keyFileName ? "border-accent-green/50 bg-accent-green/5" : "border-base-border hover:border-accent-orange/50 bg-base-bg"
          }`}>
            <svg className="w-4 h-4 text-base-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
            <span className="text-xs text-base-muted truncate">
              {keyFileName || "Click to upload key file"}
            </span>
            <input type="file" accept=".pem,.key,.pub,*" onChange={handleKeyUpload} className="hidden" />
          </label>
          {keyFileName && (
            <p className="text-[9px] text-accent-green mt-1">✓ {keyFileName} loaded</p>
          )}
        </div>

        {/* Coder toggle */}
        <div className="pt-2 border-t border-base-border">
          <label className="flex items-center gap-2 cursor-pointer">
            <button
              onClick={() => { setUseCoder(!useCoder); setConnectionOk(false); }}
              className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${
                useCoder ? "bg-accent-green" : "bg-base-border"
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                useCoder ? "translate-x-4" : "translate-x-0"
              }`} />
            </button>
            <span className="text-[11px] text-base-text">Using Coder workspaces</span>
          </label>
          {useCoder && (
            <div className="mt-2">
              <label className="block text-[10px] text-base-muted mb-1">Coder Username</label>
              <input
                type="text" value={coderUser}
                onChange={(e) => { setCoderUser(e.target.value); setConnectionOk(false); }}
                placeholder="Your Coder username"
                className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
              />
              <p className="text-[9px] text-base-muted/60 mt-1">
                SSH aliases: main.&lt;workspace&gt;.&lt;username&gt;.coder
              </p>
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-[10px] text-accent-red mt-3">{error}</p>}

      <div className="flex justify-between mt-6">
        <button onClick={() => setStep(0)} className="text-[11px] text-base-muted hover:text-base-text">Back</button>
        <button
          onClick={handleTestConnection}
          disabled={!sshHost || testing || (useCoder && !coderUser)}
          className="px-4 py-1.5 rounded bg-accent-orange text-white text-xs hover:opacity-90 transition-opacity disabled:opacity-30"
        >
          {testing ? "Testing..." : connectionOk ? "✓ Connected" : "Test & Continue"}
        </button>
      </div>
    </div>,

    // Step 2: Workspace + Discovery
    <div key="workspace">
      <h3 className="text-sm font-bold text-base-text mb-1">Add a Project</h3>
      <p className="text-[11px] text-base-muted mb-4">
        {useCoder
          ? "Select a workspace and project, or auto-discover them."
          : "Add a project folder from your remote server."}
      </p>

      {/* Auto-discover */}
      <button
        onClick={handleDiscover}
        disabled={discovering}
        className="w-full mb-4 text-[11px] px-3 py-2 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors disabled:opacity-50"
      >
        {discovering ? "Discovering..." : "🔍 Auto-discover Projects"}
      </button>

      {/* Discovery results */}
      {discovered.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-[10px] text-accent-green">
            Found {discovered.reduce((s, d) => s + d.projects.length, 0)} project{discovered.reduce((s, d) => s + d.projects.length, 0) !== 1 ? "s" : ""}:
          </p>
          {discovered.map((d) => (
            <div key={d.workspace} className="bg-base-bg border border-base-border rounded p-2">
              <div className="text-[11px] font-semibold text-base-text mb-1">{d.workspace}</div>
              {d.projects.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {d.projects.map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setWsName(d.workspace);
                        setProjectPath(p);
                        setProjectDisplay(p);
                      }}
                      className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                        projectPath === p && wsName === d.workspace
                          ? "border-accent-orange/50 text-accent-orange bg-accent-orange/10"
                          : "border-base-border text-base-muted hover:text-base-text"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[9px] text-base-muted">No project folders found</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Manual entry */}
      <div className="space-y-3">
        {useCoder && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-base-muted mb-1">Workspace Name</label>
              <input
                type="text" value={wsName} onChange={(e) => setWsName(e.target.value)}
                placeholder="e.g. dev-server"
                className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-base-muted mb-1">Display Name</label>
              <input
                type="text" value={wsDisplay} onChange={(e) => setWsDisplay(e.target.value)}
                placeholder={wsName || "optional"}
                className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
              />
            </div>
          </div>
        )}
        {!useCoder && (
          <div>
            <label className="block text-[10px] text-base-muted mb-1">Server Name</label>
            <input
              type="text" value={wsName} onChange={(e) => setWsName(e.target.value)}
              placeholder={sshHost || "e.g. my-server"}
              className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-base-muted mb-1">Project Folder</label>
            <input
              type="text" value={projectPath} onChange={(e) => setProjectPath(e.target.value)}
              placeholder="e.g. my-app"
              className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-base-muted mb-1">Display Name</label>
            <input
              type="text" value={projectDisplay} onChange={(e) => setProjectDisplay(e.target.value)}
              placeholder={projectPath || "optional"}
              className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-[10px] text-accent-red mt-3">{error}</p>}

      <div className="flex justify-between mt-6">
        <button onClick={() => setStep(1)} className="text-[11px] text-base-muted hover:text-base-text">Back</button>
        <div className="flex gap-2">
          <button
            onClick={handleSkipWorkspace}
            disabled={saving}
            className="px-4 py-1.5 rounded border border-base-border text-xs text-base-muted hover:text-base-text transition-colors disabled:opacity-50"
          >
            Skip
          </button>
          <button
            onClick={handleFinish}
            disabled={!(useCoder ? wsName : sshHost) || !projectPath || saving}
            className="px-4 py-1.5 rounded bg-accent-orange text-white text-xs hover:opacity-90 transition-opacity disabled:opacity-30"
          >
            {saving ? "Saving..." : "Finish"}
          </button>
        </div>
      </div>
    </div>,
  ];

  return (
    <div className="flex items-center justify-center h-screen bg-base-bg">
      <div className="bg-base-surface border border-base-border rounded-lg p-8 w-[480px] shadow-xl">
        <div className="flex justify-center gap-2 mb-6">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === step ? "bg-accent-orange" : i < step ? "bg-accent-green" : "bg-base-border"
              }`}
            />
          ))}
        </div>
        {steps[step]}
      </div>
    </div>
  );
}

export default Setup;
