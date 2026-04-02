import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { addDebugLog } from "./debugLogBuffer";

const REDACTED_KEYS = new Set(["keyContent", "keyPath", "botToken", "chatId"]);

function sanitizeArgs(
  args: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const key in args) {
    sanitized[key] = REDACTED_KEYS.has(key) ? "[REDACTED]" : args[key];
  }
  return sanitized;
}

/**
 * Drop-in replacement for Tauri's `invoke`. When debug level is "extreme",
 * logs the command name, sanitized args, response/error, and duration.
 * When level is anything else, calls invoke directly with zero overhead.
 */
export async function debugInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { debugLevel } = useAppStore.getState();

  if (debugLevel !== "extreme") {
    return invoke<T>(cmd, args);
  }

  const ts = new Date().toISOString().slice(11, 23);
  const sanitized = args ? JSON.stringify(sanitizeArgs(args)) : "{}";
  addDebugLog(`[${ts}] [INVOKE] ${cmd} ${sanitized}`);

  const start = Date.now();
  try {
    const result = await invoke<T>(cmd, args);
    const duration = Date.now() - start;
    addDebugLog(`[${ts}] [INVOKE] ${cmd} → OK (${duration}ms)`);
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    addDebugLog(
      `[${ts}] [INVOKE] ${cmd} → ERROR (${duration}ms): ${error}`
    );
    throw error;
  }
}
