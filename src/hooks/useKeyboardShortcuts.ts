import { useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import type { ViewMode } from "../lib/types";

/**
 * Global refresh function — set by useKeyboardShortcuts so external
 * code (or the shortcut handler) can trigger a data refresh.
 */
let _globalRefresh: (() => void) | null = null;

export function setGlobalRefresh(fn: () => void) {
  _globalRefresh = fn;
}

export function triggerGlobalRefresh() {
  _globalRefresh?.();
}

/**
 * Signal that the current view should clear its search/filter.
 * Views can subscribe to this via a listener pattern.
 */
type ClearSearchListener = () => void;
const clearSearchListeners = new Set<ClearSearchListener>();

export function onClearSearch(listener: ClearSearchListener): () => void {
  clearSearchListeners.add(listener);
  return () => clearSearchListeners.delete(listener);
}

function emitClearSearch() {
  clearSearchListeners.forEach((fn) => fn());
}

/**
 * Signal to toggle the keyboard shortcuts help overlay.
 */
type ShortcutsHelpListener = (visible: boolean) => void;
const shortcutsHelpListeners = new Set<ShortcutsHelpListener>();
let shortcutsHelpVisible = false;

export function onShortcutsHelpToggle(
  listener: ShortcutsHelpListener
): () => void {
  shortcutsHelpListeners.add(listener);
  return () => shortcutsHelpListeners.delete(listener);
}

export function toggleShortcutsHelp() {
  shortcutsHelpVisible = !shortcutsHelpVisible;
  shortcutsHelpListeners.forEach((fn) => fn(shortcutsHelpVisible));
}

export function hideShortcutsHelp() {
  shortcutsHelpVisible = false;
  shortcutsHelpListeners.forEach((fn) => fn(false));
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only handle Cmd (meta) shortcuts
      if (!e.metaKey) return;

      const store = useAppStore.getState();

      // --- Navigation: Cmd+1..4 ---
      const viewMap: Record<string, ViewMode> = {
        "1": "dashboard",
        "2": "terminal",
        "3": "logs",
        "4": "settings",
      };

      if (viewMap[e.key]) {
        e.preventDefault();
        store.setCurrentView(viewMap[e.key]);
        return;
      }

      // --- Terminal: Cmd+T — new tab ---
      if (e.key === "t" && !e.shiftKey) {
        e.preventDefault();
        const ws = store.workspaces[0];
        if (!ws || !ws.projects[0]) return;
        const project = ws.projects[0];
        const id = `${ws.coderName}:${project.path}:${Date.now()}`;
        store.addBlock({
          id,
          type: 'terminal',
          workspace: ws.coderName,
          project: project.path,
          title: project.displayName,
          isActive: true,
        });
        store.setCurrentView("terminal");
        return;
      }

      // --- Terminal: Cmd+W — close current tab ---
      if (e.key === "w" && !e.shiftKey) {
        e.preventDefault();
        const { activeBlockId, blocks } = store;
        if (activeBlockId && blocks.length > 0) {
          store.removeBlock(activeBlockId);
        }
        return;
      }

      // --- Terminal: Cmd+[ / Cmd+] — switch tabs ---
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const { blocks, activeBlockId } = store;
        if (blocks.length < 2 || !activeBlockId) return;

        const currentIdx = blocks.findIndex(
          (t) => t.id === activeBlockId
        );
        if (currentIdx === -1) return;

        let nextIdx: number;
        if (e.key === "[") {
          nextIdx =
            currentIdx === 0 ? blocks.length - 1 : currentIdx - 1;
        } else {
          nextIdx =
            currentIdx === blocks.length - 1 ? 0 : currentIdx + 1;
        }
        store.setActiveBlock(blocks[nextIdx].id);
        return;
      }

      // --- General: Cmd+R — refresh data ---
      if (e.key === "r" && !e.shiftKey) {
        e.preventDefault();
        triggerGlobalRefresh();
        return;
      }

      // --- General: Cmd+K — clear search/filter ---
      if (e.key === "k" && !e.shiftKey) {
        e.preventDefault();
        emitClearSearch();
        return;
      }

      // --- Help: Cmd+? or Cmd+/ — toggle shortcuts help ---
      if (e.key === "/" || e.key === "?") {
        e.preventDefault();
        toggleShortcutsHelp();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
