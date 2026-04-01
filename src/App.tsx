import { useState, useEffect } from "react";
import { useAppStore } from "./stores/appStore";
import { useSSH } from "./hooks/useSSH";
import { useSecrets } from "./hooks/useSecrets";
import { useKeyboardShortcuts, setGlobalRefresh, onShortcutsHelpToggle } from "./hooks/useKeyboardShortcuts";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import TerminalTabs from "./components/TerminalTabs";
import LogViewer from "./components/LogViewer";
import Settings from "./components/Settings";
import StatusBar from "./components/StatusBar";
import KeyboardShortcutsHelp from "./components/KeyboardShortcutsHelp";
import Setup from "./components/Setup";

function App() {
  const currentView = useAppStore((s) => s.currentView);
  const config = useAppStore((s) => s.config);
  const { fetchGSDData } = useSSH();
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Load/sync secrets from encrypted vault
  useSecrets();

  useKeyboardShortcuts();

  // Wire up the global refresh for Cmd+R
  useEffect(() => {
    setGlobalRefresh(() => {
      fetchGSDData();
    });
  }, [fetchGSDData]);

  // Listen for shortcuts help toggle
  useEffect(() => {
    return onShortcutsHelpToggle((visible) => setShowShortcuts(visible));
  }, []);

  // Show setup wizard when no SSH profiles configured
  if (config.sshProfiles.length === 0) {
    return <Setup />;
  }

  return (
    <div className="flex flex-col h-screen bg-base-bg">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {currentView === "dashboard" && <Dashboard />}
          {currentView === "terminal" && <TerminalTabs />}
          {currentView === "logs" && <LogViewer />}
          {currentView === "settings" && <Settings />}
        </main>
      </div>
      <StatusBar />
      {showShortcuts && <KeyboardShortcutsHelp />}
    </div>
  );
}

export default App;
