import { useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { addDebugLog } from "../lib/debugLogBuffer";

const origConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

/**
 * Global debug logger — gated by debugLevel.
 *
 * Off:     uncaught error + unhandled rejection handlers only.
 * Normal:  app state snapshot on mount, connection status subscription,
 *          uncaught error + unhandled rejection handlers. No console hijacking.
 * Extreme: everything in normal, PLUS console.log/warn/error hijacking,
 *          PLUS Zustand state mutation tracking (diffed keys).
 *
 * Runs from AppShell.
 */
export function useDebugLogger() {
  const debugLevel = useAppStore((s) => s.debugLevel);

  useEffect(() => {
    const ts = () => new Date().toISOString().slice(11, 23);
    const cleanups: (() => void)[] = [];

    // --- Always: uncaught error + rejection handlers ---
    const onError = (e: ErrorEvent) => {
      addDebugLog(`[${ts()}] UNCAUGHT: ${e.message} at ${e.filename}:${e.lineno}`);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      addDebugLog(`[${ts()}] REJECTION: ${e.reason}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    cleanups.push(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    });

    if (debugLevel === "off") {
      return () => cleanups.forEach((fn) => fn());
    }

    // --- Normal + Extreme: app state snapshot ---
    const state = useAppStore.getState();
    addDebugLog(`[${ts()}] DEBUG ENABLED (${debugLevel})`);
    addDebugLog(`[${ts()}] Connection: ${state.connection.status}`);
    addDebugLog(`[${ts()}] Profiles: ${state.config.sshProfiles?.length ?? 0}`);
    addDebugLog(
      `[${ts()}] Workspaces: ${state.workspaces.map((w) => w.coderName).join(", ") || "none"}`
    );
    addDebugLog(`[${ts()}] Sessions: ${Object.keys(state.sessions).length}`);
    addDebugLog(`[${ts()}] Tabs: ${state.terminalTabs.length}`);

    // --- Normal + Extreme: connection status subscription ---
    let prevStatus = state.connection.status;
    let prevError = state.connection.error;
    const unsubConn = useAppStore.subscribe((s) => {
      const { status, error } = s.connection;
      if (status !== prevStatus) {
        const errStr = error ? ` (${error})` : "";
        addDebugLog(`[${ts()}] CONNECTION: ${prevStatus} → ${status}${errStr}`);
        prevStatus = status;
        prevError = error;
      } else if (error !== prevError) {
        addDebugLog(`[${ts()}] CONNECTION ERROR: ${error}`);
        prevError = error;
      }
    });
    cleanups.push(unsubConn);

    if (debugLevel === "extreme") {
      // --- Extreme: console hijacking ---
      // Reentrant guard: addLog → set() → persist middleware may console.log internally.
      // Without this guard, hijacked console.log calls addLog which calls set() which
      // triggers a console.log → infinite recursion → stack overflow.
      let insideHijack = false;
      console.log = (...args: unknown[]) => {
        if (insideHijack) { origConsole.log(...args); return; }
        insideHijack = true;
        try { addDebugLog(`[${ts()}] ${args.map(String).join(" ")}`); } finally { insideHijack = false; }
        origConsole.log(...args);
      };
      console.warn = (...args: unknown[]) => {
        if (insideHijack) { origConsole.warn(...args); return; }
        insideHijack = true;
        try { addDebugLog(`[${ts()}] WARN: ${args.map(String).join(" ")}`); } finally { insideHijack = false; }
        origConsole.warn(...args);
      };
      console.error = (...args: unknown[]) => {
        if (insideHijack) { origConsole.error(...args); return; }
        insideHijack = true;
        try { addDebugLog(`[${ts()}] ERROR: ${args.map(String).join(" ")}`); } finally { insideHijack = false; }
        origConsole.error(...args);
      };
      cleanups.push(() => {
        console.log = origConsole.log;
        console.warn = origConsole.warn;
        console.error = origConsole.error;
      });

      // --- Extreme: Zustand state mutation tracking ---
      let prevState = useAppStore.getState();
      const unsubState = useAppStore.subscribe((next) => {
        const changedKeys: string[] = [];
        for (const key of Object.keys(next) as (keyof typeof next)[]) {
          if (next[key] !== prevState[key]) {
            changedKeys.push(key);
          }
        }
        if (changedKeys.length > 0) {
          insideHijack = true;
          try { addDebugLog(`[${ts()}] [STATE] changed: ${changedKeys.join(", ")}`); } finally { insideHijack = false; }
        }
        prevState = next;
      });
      cleanups.push(unsubState);
    }

    return () => cleanups.forEach((fn) => fn());
  }, [debugLevel]);
}
