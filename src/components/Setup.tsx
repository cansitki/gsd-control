import { useState, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { setSecret, SECRET_KEYS } from "../lib/secrets";
import type { SSHProfile } from "../lib/types";

function Setup() {
  const updateConfig = useAppStore((s) => s.updateConfig);
  const config = useAppStore((s) => s.config);
  const addProject = useAppStore((s) => s.addProject);

  const [step, setStep] = useState(0);

  // Profile fields
  const [profileName, setProfileName] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("admin");
  const [coderUser, setCoderUser] = useState("");
  const [keyFileName, setKeyFileName] = useState("");
  const keyContentRef = useRef("");

  // Workspace fields
  const [wsName, setWsName] = useState("");
  const [wsDisplay, setWsDisplay] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [projectDisplay, setProjectDisplay] = useState("");

  const [saving, setSaving] = useState(false);

  const handleKeyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setKeyFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      keyContentRef.current = ev.target?.result as string;
    };
    reader.readAsText(file);
  };

  const saveProfile = async (): Promise<SSHProfile> => {
    const id = `profile-${Date.now()}`;
    const hasKey = !!keyContentRef.current;

    // Store SSH key in encrypted vault
    if (hasKey) {
      await setSecret(SECRET_KEYS.sshKey(id), keyContentRef.current);
    }

    const profile: SSHProfile = {
      id,
      name: profileName || sshHost,
      host: sshHost,
      user: sshUser,
      coderUser,
      hasKey,
    };

    return profile;
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      const profile = await saveProfile();

      updateConfig({
        sshProfiles: [...config.sshProfiles, profile],
        activeProfileId: profile.id,
      });

      // Add workspace + project if provided
      if (wsName && projectPath) {
        addProject(wsName, {
          path: projectPath,
          displayName: projectDisplay || projectPath,
        });

        // Set workspace display name if provided
        if (wsDisplay && wsDisplay !== wsName) {
          const store = useAppStore.getState();
          const updated = store.workspaces.map((ws) =>
            ws.coderName === wsName ? { ...ws, displayName: wsDisplay } : ws
          );
          useAppStore.setState({ workspaces: updated });
        }
      }
    } catch (e) {
      console.error("Setup save failed:", e);
    }
    setSaving(false);
  };

  const handleSkipWorkspace = async () => {
    setSaving(true);
    try {
      const profile = await saveProfile();
      updateConfig({
        sshProfiles: [...config.sshProfiles, profile],
        activeProfileId: profile.id,
      });
    } catch (e) {
      console.error("Setup save failed:", e);
    }
    setSaving(false);
  };

  const steps = [
    // Step 0: Welcome
    <div key="welcome" className="text-center">
      <h2 className="text-xl font-bold text-accent-orange mb-2">GSD Control</h2>
      <p className="text-sm text-base-muted mb-8">
        Monitor and manage your GSD projects across Coder workspaces.
      </p>
      <button
        onClick={() => setStep(1)}
        className="px-6 py-2 rounded bg-accent-orange text-white text-sm hover:opacity-90 transition-opacity"
      >
        Get Started
      </button>
    </div>,

    // Step 1: SSH Profile
    <div key="ssh">
      <h3 className="text-sm font-bold text-base-text mb-1">SSH Profile</h3>
      <p className="text-[11px] text-base-muted mb-4">
        Configure your connection to the Coder instance.
      </p>
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] text-base-muted mb-1">Profile Name</label>
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="e.g. Production Server"
            className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[10px] text-base-muted mb-1">SSH Host</label>
          <input
            type="text"
            value={sshHost}
            onChange={(e) => setSshHost(e.target.value)}
            placeholder="e.g. ec2-xx-xx-xx-xx.compute.amazonaws.com"
            className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-base-muted mb-1">SSH User</label>
            <input
              type="text"
              value={sshUser}
              onChange={(e) => setSshUser(e.target.value)}
              placeholder="admin"
              className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-base-muted mb-1">Coder Username</label>
            <input
              type="text"
              value={coderUser}
              onChange={(e) => setCoderUser(e.target.value)}
              placeholder="e.g. johndoe"
              className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-base-muted mb-1">SSH Key (.pem or private key)</label>
          <label
            className={`flex items-center gap-2 border border-dashed rounded px-3 py-2 cursor-pointer transition-colors ${
              keyFileName
                ? "border-accent-green/50 bg-accent-green/5"
                : "border-base-border hover:border-accent-orange/50 bg-base-bg"
            }`}
          >
            <svg className="w-4 h-4 text-base-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
            <span className="text-xs text-base-muted truncate">
              {keyFileName || "Click to upload key file"}
            </span>
            <input
              type="file"
              accept=".pem,.key,.pub,*"
              onChange={handleKeyUpload}
              className="hidden"
            />
          </label>
          {keyFileName && (
            <p className="text-[9px] text-accent-green mt-1">✓ {keyFileName} loaded — will be stored encrypted</p>
          )}
        </div>
        <p className="text-[9px] text-base-muted/60">
          SSH alias format: main.&lt;workspace&gt;.&lt;coder-username&gt;.coder
        </p>
      </div>
      <div className="flex justify-between mt-6">
        <button onClick={() => setStep(0)} className="text-[11px] text-base-muted hover:text-base-text">
          Back
        </button>
        <button
          onClick={() => setStep(2)}
          disabled={!sshHost || !coderUser}
          className="px-4 py-1.5 rounded bg-accent-orange text-white text-xs hover:opacity-90 transition-opacity disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>,

    // Step 2: First workspace
    <div key="workspace">
      <h3 className="text-sm font-bold text-base-text mb-1">Add a Workspace</h3>
      <p className="text-[11px] text-base-muted mb-4">
        Add your first Coder workspace and project. You can add more later from the sidebar.
      </p>
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] text-base-muted mb-1">Workspace Name (Coder)</label>
          <input
            type="text"
            value={wsName}
            onChange={(e) => setWsName(e.target.value)}
            placeholder="e.g. dev-server"
            className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[10px] text-base-muted mb-1">Display Name (optional)</label>
          <input
            type="text"
            value={wsDisplay}
            onChange={(e) => setWsDisplay(e.target.value)}
            placeholder={wsName || "e.g. My Dev Server"}
            className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] text-base-muted mb-1">Project Folder</label>
          <input
            type="text"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="e.g. my-app"
            className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] text-base-muted mb-1">Project Display Name (optional)</label>
          <input
            type="text"
            value={projectDisplay}
            onChange={(e) => setProjectDisplay(e.target.value)}
            placeholder={projectPath || "e.g. My App"}
            className="w-full bg-base-bg border border-base-border rounded px-3 py-1.5 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
          />
        </div>
      </div>
      <div className="flex justify-between mt-6">
        <button onClick={() => setStep(1)} className="text-[11px] text-base-muted hover:text-base-text">
          Back
        </button>
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
            disabled={!wsName || !projectPath || saving}
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
      <div className="bg-base-surface border border-base-border rounded-lg p-8 w-[460px] shadow-xl">
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
