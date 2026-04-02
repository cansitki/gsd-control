import { useState, useEffect, Component, type ReactNode } from "react";
import { useAppStore } from "./stores/appStore";
import { useSSH } from "./hooks/useSSH";
import { useSecrets } from "./hooks/useSecrets";
import { useKeyboardShortcuts, setGlobalRefresh, onShortcutsHelpToggle } from "./hooks/useKeyboardShortcuts";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import BlockLayout from "./components/BlockLayout";
import LogViewer from "./components/LogViewer";
import Settings from "./components/Settings";
import StatusBar from "./components/StatusBar";
import KeyboardShortcutsHelp from "./components/KeyboardShortcutsHelp";
import { useDebugLogger } from "./hooks/useDebugLogger";
import Setup from "./components/Setup";

/** Error boundary for the main content area — keeps sidebar usable when a view crashes */
class ViewErrorBoundary extends Component<
  { children: ReactNode; viewKey: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ViewErrorBoundary] caught:", error, info.componentStack);
  }

  componentDidUpdate(prevProps: { viewKey: string }) {
    // Clear error when the user switches views
    if (prevProps.viewKey !== this.props.viewKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center px-6 max-w-md">
            <p className="text-accent-red text-sm font-semibold mb-2">
              View crashed
            </p>
            <p className="text-xs text-base-muted mb-4 break-words">
              {this.state.error.message}
            </p>
            <button
              onClick={() => {
                this.setState({ error: null });
                useAppStore.getState().setCurrentView("dashboard");
              }}
              className="text-xs px-3 py-1.5 rounded border border-accent-orange/40 text-accent-orange hover:bg-accent-orange/10 transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
          <ViewErrorBoundary viewKey={currentView}>
            {currentView === "dashboard" && <Dashboard />}
            {currentView === "terminal" && <BlockLayout />}
            {currentView === "logs" && <LogViewer />}
            {currentView === "settings" && <Settings />}
          </ViewErrorBoundary>
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
