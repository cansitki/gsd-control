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
import { useDebugLogger } from "./hooks/useDebugLogger";
import Setup from "./components/Setup";

/** Main app shell — only rendered after setup is complete */
function AppShell() {
  const currentView = useAppStore((s) => s.currentView);
  const { fetchGSDData } = useSSH();
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Load/sync secrets from encrypted vault — safe here, setup is done
  useSecrets();
  useDebugLogger();
  useKeyboardShortcuts();

  useEffect(() => {
    setGlobalRefresh(() => {
      fetchGSDData();
    });
  }, [fetchGSDData]);

  useEffect(() => {
    return onShortcutsHelpToggle((visible) => setShowShortcuts(visible));
  }, []);

  return (
    <div className="flex flex-col h-screen bg-base-bg overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
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

function App() {
  const config = useAppStore((s) => s.config);

  // Show setup wizard when no SSH profiles configured
  if (!config.sshProfiles || config.sshProfiles.length === 0) {
    return <Setup />;
  }

  return <AppShell />;
}

export default App;
