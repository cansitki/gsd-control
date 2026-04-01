import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import type { SSHProfile } from "../lib/types";

function Setup() {
  const updateConfig = useAppStore((s) => s.updateConfig);
  const config = useAppStore((s) => s.config);
  const addProject = useAppStore((s) => s.addProject);

  const [step, setStep] = useState(0);

  // SSH fields
  const [profileName, setProfileName] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [coderUser, setCoderUser] = useState("");
  const [keyFileName, setKeyFileName] = useState("");
  const [keyContent, setKeyContent] = useState("");
  const [useCoder, setUseCoder] = useState(true);

  // Workspaces (for Coder)
  const [workspaceInput, setWorkspaceInput] = useState("");
  const [workspaceList, setWorkspaceList] = useState<{ name: string; display: string; tested: boolean }[]>([]);

  // Projects
  const [discovered, setDiscovered] = useState<{ workspace: string; projects: string[] }[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<{ workspace: string; project: string }[]>([]);

  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [_connectionOk, setConnectionOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleKeyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setKeyFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setKeyContent(ev.target?.result as string);
    reader.readAsText(file);
    setConnectionOk(false);
  };

  const addWorkspace = () => {
    const name = workspaceInput.trim();
    if (!name || workspaceList.some((w) => w.name === name)) return;
    setWorkspaceList([...workspaceList, { name, display: name, tested: false }]);
    setWorkspaceInput("");
  };

  const removeWorkspace = (name: string) => {
    setWorkspaceList(workspaceList.filter((w) => w.name !== name));
    setSelectedProjects(selectedProjects.filter((p) => p.workspace !== name));
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

      // Set up the SSH config on the backend
      await invoke<{ connected: boolean; error: string | null }>(
        "ssh_connect",
        {
          host: sshHost,
          user: sshUser || "admin",
          keyPath,
          coderUser: useCoder ? coderUser : "",
        }
      );

      if (useCoder) {
        // Test each workspace via Coder alias
        if (workspaceList.length === 0) {
          setError("Add at least one workspace name to test");
          setTesting(false);
          return;
        }

        let anyOk = false;
        const updated = [...workspaceList];
        for (let i = 0; i < updated.length; i++) {
          try {
            const result = await invoke<{ connected: boolean; error: string | null }>(
              "test_workspace",
              { workspace: updated[i].name }
            );
            updated[i] = { ...updated[i], tested: result.connected };
            if (result.connected) anyOk = true;
          } catch {
            updated[i] = { ...updated[i], tested: false };
          }
        }
        setWorkspaceList(updated);

        if (anyOk) {
          setConnectionOk(true);
          setStep(2);
          // Auto-discover projects
          setTimeout(() => handleDiscover(updated.filter((w) => w.tested)), 300);
        } else {
          setError("No workspaces reachable — check workspace names and Coder username");
        }
      } else {
        // Direct SSH — test the host
        const result = await invoke<{ connected: boolean; error: string | null }>(
          "ssh_connect",
          {
            host: sshHost,
            user: sshUser || "admin",
            keyPath,
            coderUser: "",
          }
        );
        if (result.connected) {
          setConnectionOk(true);
          setStep(2);
        } else {
          setError(result.error || "Connection failed");
        }
      }
    } catch (e) {
      setError(String(e));
    }
    setTesting(false);
  };

  const handleDiscover = async (testedWorkspaces?: { name: string }[]) => {
    setDiscovering(true);
    setError("");
    try {
      const wsList = testedWorkspaces || workspaceList.filter((w) => w.tested);
      const results: { workspace: string; projects: string[] }[] = [];

      for (const ws of wsList) {
        try {
          const output = await invoke<string>("exec_in_workspace", {
            workspace: ws.name,
            command: "for d in ~/*/; do [ -d \"$d/.gsd\" ] && basename \"$d\"; done 2>/dev/null",
          });
          const projects = output.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("."));
          results.push({ workspace: ws.name, projects });
        } catch {
          results.push({ workspace: ws.name, projects: [] });
        }
      }

      setDiscovered(results);
    } catch (e) {
      setError(String(e));
    }
    setDiscovering(false);
  };

  const toggleProject = (workspace: string, project: string) => {
    const exists = selectedProjects.some((p) => p.workspace === workspace && p.project === project);
    if (exists) {
      setSelectedProjects(selectedProjects.filter((p) => !(p.workspace === workspace && p.project === project)));
    } else {
      setSelectedProjects([...selectedProjects, { workspace, project }]);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    setError("");
    try {
      const id = `profile-${Date.now()}`;
      const profile: SSHProfile = {
        id,
        name: profileName || sshHost || coderUser || "Default",
        host: sshHost,
        user: sshUser || "admin",
        coderUser: useCoder ? coderUser : "",
        hasKey: !!keyContent,
      };

      if (keyContent) {
        try {
          const { setSecret, SECRET_KEYS } = await import("../lib/secrets");
          await setSecret(SECRET_KEYS.sshKey(id), keyContent);
        } catch { /* secrets not ready */ }
      }

      updateConfig({
        sshProfiles: [...(config.sshProfiles || []), profile],
        activeProfileId: id,
      });

      // Add selected projects
      for (const { workspace, project } of selectedProjects) {
        const ws = workspaceList.find((w) => w.name === workspace);
        addProject(workspace, { path: project, displayName: project });
        // Set display name if different
        if (ws && ws.display !== ws.name) {
          const store = useAppStore.getState();
          const updated = store.workspaces.map((w) =>
            w.coderName === workspace ? { ...w, displayName: ws.display } : w
          );
          useAppStore.setState({ workspaces: updated });
        }
      }

      // If no projects selected but we have workspace info, add the workspaces at least
      if (selectedProjects.length === 0 && !useCoder && sshHost) {
        // For direct SSH, create a default workspace entry
        addProject(sshHost, { path: "~", displayName: "Home" });
      }
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      const id = `profile-${Date.now()}`;
      const profile: SSHProfile = {
        id,
        name: profileName || sshHost || coderUser || "Default",
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
      <p className="text-sm text-base-muted mb-8">Monitor and manage your projects on remote servers.</p>
      <button onClick={() => setStep(1)} className="px-6 py-2 rounded bg-accent-orange text-white text-sm hover:opacity-90 transition-opacity">
        Get Started
      </button>
    </div>,

    // Step 1: SSH + Workspaces
    <div key="ssh">
      <h3 className="text-sm font-bold text-base-text mb-1">Connection</h3>
      <p className="text-xs text-base-muted mb-4">Enter your SSH details and workspace names.</p>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-base-muted mb-1">Profile Name (optional)</label>
          <input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)}
            placeholder="e.g. My Server" className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none" autoFocus />
        </div>
        <div>
          <label className="block text-xs text-base-muted mb-1">Host (IP or hostname)</label>
          <input type="text" value={sshHost} onChange={(e) => { setSshHost(e.target.value); setConnectionOk(false); }}
            placeholder="e.g. 192.168.1.100 or ec2-xx-xx.amazonaws.com" className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none" />
        </div>
        <div>
          <label className="block text-xs text-base-muted mb-1">SSH User</label>
          <input type="text" value={sshUser} onChange={(e) => { setSshUser(e.target.value); setConnectionOk(false); }}
            placeholder="e.g. admin, ubuntu, root" className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none" />
        </div>
        <div>
          <label className="block text-xs text-base-muted mb-1">SSH Key (.pem or private key)</label>
          <label className={`flex items-center gap-2 border border-dashed rounded px-3 py-2 cursor-pointer transition-colors ${
            keyFileName ? "border-accent-green/50 bg-accent-green/5" : "border-base-border hover:border-accent-orange/50 bg-base-bg"
          }`}>
            <svg className="w-4 h-4 text-base-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
            <span className="text-xs text-base-muted truncate">{keyFileName || "Click to upload key file"}</span>
            <input type="file" accept=".pem,.key,.pub,*" onChange={handleKeyUpload} className="hidden" />
          </label>
          {keyFileName && <p className="text-xs text-accent-green mt-1">✓ {keyFileName} loaded</p>}
        </div>

        {/* Coder toggle */}
        <div className="pt-2 border-t border-base-border">
          <label className="flex items-center gap-2 cursor-pointer">
            <button onClick={() => { setUseCoder(!useCoder); setConnectionOk(false); }}
              className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${useCoder ? "bg-accent-green" : "bg-base-border"}`}>
              <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${useCoder ? "translate-x-4" : "translate-x-0"}`} />
            </button>
            <span className="text-xs text-base-text">Using Coder workspaces</span>
          </label>

          {useCoder && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="block text-xs text-base-muted mb-1">Coder Username</label>
                <input type="text" value={coderUser} onChange={(e) => { setCoderUser(e.target.value); setConnectionOk(false); }}
                  placeholder="Your Coder username" className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none" />
                <p className="text-xs text-base-muted/60 mt-1">SSH alias: main.&lt;workspace&gt;.&lt;username&gt;.coder</p>
              </div>
              <div>
                <label className="block text-xs text-base-muted mb-1">Workspace Names</label>
                <div className="flex gap-2">
                  <input type="text" value={workspaceInput}
                    onChange={(e) => setWorkspaceInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addWorkspace()}
                    placeholder="e.g. Can, discordbot"
                    className="flex-1 bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none" />
                  <button onClick={addWorkspace} className="px-3 py-1.5 text-xs rounded border border-accent-orange/30 text-accent-orange hover:bg-accent-orange/10 transition-colors">Add</button>
                </div>
                {workspaceList.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {workspaceList.map((ws) => (
                      <span key={ws.name} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${
                        ws.tested ? "border-accent-green/50 text-accent-green" : "border-base-border text-base-muted"
                      }`}>
                        {ws.tested && "✓ "}{ws.name}
                        <button onClick={() => removeWorkspace(ws.name)} className="hover:text-accent-red ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-accent-red mt-3">{error}</p>}

      <div className="flex justify-between mt-6">
        <button onClick={() => setStep(0)} className="text-xs text-base-muted hover:text-base-text">Back</button>
        <button onClick={handleTestConnection}
          disabled={!sshHost || testing || (useCoder && (!coderUser || workspaceList.length === 0))}
          className="px-4 py-1.5 rounded bg-accent-orange text-white text-xs hover:opacity-90 transition-opacity disabled:opacity-30">
          {testing ? "Testing..." : "Test & Continue"}
        </button>
      </div>
    </div>,

    // Step 2: Projects
    <div key="projects">
      <h3 className="text-sm font-bold text-base-text mb-1">Select Projects</h3>
      <p className="text-xs text-base-muted mb-4">
        {discovering ? "Discovering projects..." : "Select the projects you want to monitor."}
      </p>

      {!discovering && discovered.length === 0 && (
        <button onClick={() => handleDiscover()} disabled={discovering}
          className="w-full mb-4 text-xs px-3 py-2 rounded border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-colors disabled:opacity-50">
          🔍 Discover Projects
        </button>
      )}

      {discovered.length > 0 && (
        <div className="space-y-3 mb-4 max-h-[40vh] overflow-y-auto">
          {discovered.map((d) => (
            <div key={d.workspace} className="bg-base-bg border border-base-border rounded p-3">
              <div className="text-xs font-semibold text-base-text mb-2">{d.workspace}</div>
              {d.projects.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {d.projects.map((p) => {
                    const selected = selectedProjects.some((sp) => sp.workspace === d.workspace && sp.project === p);
                    return (
                      <button key={p} onClick={() => toggleProject(d.workspace, p)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          selected
                            ? "border-accent-orange/50 text-accent-orange bg-accent-orange/10"
                            : "border-base-border text-base-muted hover:text-base-text hover:border-base-muted"
                        }`}>
                        {selected ? "✓ " : ""}{p}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-base-muted">No folders found</p>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedProjects.length > 0 && (
        <p className="text-xs text-accent-green mb-3">
          {selectedProjects.length} project{selectedProjects.length !== 1 ? "s" : ""} selected
        </p>
      )}

      {error && <p className="text-xs text-accent-red mt-3">{error}</p>}

      <div className="flex justify-between mt-6">
        <button onClick={() => setStep(1)} className="text-xs text-base-muted hover:text-base-text">Back</button>
        <div className="flex gap-2">
          <button onClick={handleSkip} disabled={saving}
            className="px-4 py-1.5 rounded border border-base-border text-xs text-base-muted hover:text-base-text transition-colors disabled:opacity-50">
            Skip
          </button>
          <button onClick={handleFinish} disabled={selectedProjects.length === 0 || saving}
            className="px-4 py-1.5 rounded bg-accent-orange text-white text-xs hover:opacity-90 transition-opacity disabled:opacity-30">
            {saving ? "Saving..." : `Finish (${selectedProjects.length})`}
          </button>
        </div>
      </div>
    </div>,
  ];

  return (
    <div className="flex items-center justify-center h-screen bg-base-bg">
      <div className="bg-base-surface border border-base-border rounded-lg p-8 w-[500px] shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-center gap-2 mb-6">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`w-2 h-2 rounded-full transition-colors ${
              i === step ? "bg-accent-orange" : i < step ? "bg-accent-green" : "bg-base-border"
            }`} />
          ))}
        </div>
        {steps[step]}
      </div>
    </div>
  );
}

export default Setup;
