/**
 * Debug log ring buffer — lives outside React/Zustand to avoid re-renders.
 *
 * addDebugLog() is O(1) amortized. No state updates, no subscribers, no copies.
 * The Settings log viewer reads getDebugLogs() on an interval when visible.
 */

const MAX_ENTRIES = 5000;
let buffer: string[] = [];
let version = 0; // bumped on every write — lets viewers detect changes cheaply

export function addDebugLog(entry: string): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer = buffer.slice(-MAX_ENTRIES);
  }
  version++;
}

export function getDebugLogs(): string[] {
  return buffer;
}

export function getDebugLogVersion(): number {
  return version;
}

export function clearDebugLogs(): void {
  buffer = [];
  version++;
}

export function getDebugLogCount(): number {
  return buffer.length;
}
