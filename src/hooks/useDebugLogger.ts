import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";

const origConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

/**
 * Global debug logger — intercepts console.log/warn/error and captures
 * uncaught errors when debug mode is enabled. Runs from AppShell.
 */
export function useDebugLogger() {
  const debugEnabled = useAppStore((s) => s.debugEnabled);
  const addDebugLog = useAppStore((s) => s.addDebugLog);
  const addRef = useRef(addDebugLog);
  addRef.current = addDebugLog;

  useEffect(() => {
    if (!debugEnabled) {
      // Restore original console
      console.log = origConsole.log;
      console.warn = origConsole.warn;
      console.error = origConsole.error;
      return;
    }

    const ts = () => new Date().toISOString().slice(11, 23);

    // Log app state snapshot on enable
    const state = useAppStore.getState();
    addRef.current(`[${ts()}] DEBUG ENABLED`);
    addRef.current(`[${ts()}] Version: ${state.config ? "ok" : "missing"}`);
    addRef.current(`[${ts()}] Connection: ${state.connection.status}`);
    addRef.current(`[${ts()}] Profiles: ${state.config.sshProfiles?.length ?? 0}`);
    addRef.current(`[${ts()}] Workspaces: ${state.workspaces.map((w) => w.coderName).join(", ") || "none"}`);
    addRef.current(`[${ts()}] Sessions: ${Object.keys(state.sessions).length}`);
    addRef.current(`[${ts()}] Tabs: ${state.terminalTabs.length}`);

    // Override console
    console.log = (...args: unknown[]) => {
      addRef.current(`[${ts()}] ${args.map(String).join(" ")}`);
      origConsole.log(...args);
    };
    console.warn = (...args: unknown[]) => {
      addRef.current(`[${ts()}] WARN: ${args.map(String).join(" ")}`);
      origConsole.warn(...args);
    };
    console.error = (...args: unknown[]) => {
      addRef.current(`[${ts()}] ERROR: ${args.map(String).join(" ")}`);
      origConsole.error(...args);
    };

    // Uncaught errors
    const onError = (e: ErrorEvent) => {
      addRef.current(`[${ts()}] UNCAUGHT: ${e.message} at ${e.filename}:${e.lineno}`);
    };
    window.addEventListener("error", onError);

    // Unhandled promise rejections
    const onRejection = (e: PromiseRejectionEvent) => {
      addRef.current(`[${ts()}] REJECTION: ${e.reason}`);
    };
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      console.log = origConsole.log;
      console.warn = origConsole.warn;
      console.error = origConsole.error;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [debugEnabled]);
}
