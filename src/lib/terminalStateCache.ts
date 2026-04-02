/**
 * Module-level Map that caches serialized terminal output by tab ID.
 * Lives outside React/Zustand so it survives component remounts without
 * polluting persisted state (serialized terminal buffers can be large).
 */
const terminalStateCache = new Map<string, string>();

/** Save serialized terminal output for a tab. */
export function saveTerminalState(tabId: string, data: string): void {
  if (data) {
    terminalStateCache.set(tabId, data);
  }
}

/** Retrieve cached terminal state. Returns undefined if none saved. */
export function getTerminalState(tabId: string): string | undefined {
  return terminalStateCache.get(tabId);
}

/** Clear cached state for a tab (e.g. when tab is permanently closed). */
export function clearTerminalState(tabId: string): void {
  terminalStateCache.delete(tabId);
}
