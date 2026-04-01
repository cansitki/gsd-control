import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";

const origConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

/**
 * Global debug logger — always-on. Intercepts console.log/warn/error and
 * captures uncaught errors. Subscribes to connection status changes.
 * Runs from AppShell.
 */
export function useDebugLogger() {
  const addDebugLog = useAppStore((s) => s.addDebugLog);
  const addRef = useRef(addDebugLog);
  addRef.current = addDebugLog;

  useEffect(() => {
    const ts = () => new Date().toISOString().slice(11, 23);

    // Log app state snapshot on mount
    const state = useAppStore.getState();
    addRef.current(`[${ts()}] DEBUG ENABLED`);
    addRef.current(`[${ts()}] Version: ${state.config ? "ok" : "missing"}`);
    addRef.current(`[${ts()}] Connection: ${state.connection.status}`);
    addRef.current(`[${ts()}] Profiles: ${state.config.sshProfiles?.length ?? 0}`);
    addRef.current(`[${ts()}] Workspaces: ${state.workspaces.map((w) => w.coderName).join(", ") || "none"}`);
    addRef.current(`[${ts()}] Sessions: ${Object.keys(state.sessions).length}`);
    addRef.current(`[${ts()}] Tabs: ${state.terminalTabs.length}`);
    addRef.current(`[${ts()}] Hydrated: ${state._hasHydrated}`);

    // Subscribe to connection status changes
    let prevStatus = state.connection.status;
    let prevError = state.connection.error;
    const unsubscribe = useAppStore.subscribe((s) => {
      const { status, error } = s.connection;
      if (status !== prevStatus) {
        const errStr = error ? ` (${error})` : "";
        addRef.current(`[${ts()}] CONNECTION: ${prevStatus} → ${status}${errStr}`);
        prevStatus = status;
        prevError = error;
      } else if (error !== prevError) {
        addRef.current(`[${ts()}] CONNECTION ERROR: ${error}`);
        prevError = error;
      }
    });

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
      unsubscribe();
      console.log = origConsole.log;
      console.warn = origConsole.warn;
      console.error = origConsole.error;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
}
