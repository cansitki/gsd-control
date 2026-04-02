import { useEffect, useRef, useState, useCallback } from "react";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { addDebugLog } from "../lib/debugLogBuffer";
import { useAppStore } from "../stores/appStore";

interface BrowserBlockProps {
  blockId: string;
  visible: boolean;
  url?: string;
}

/** Minimum dimension to consider a rect valid for webview positioning. */
const MIN_DIMENSION = 2;

/** Height in px for the navigation bar. */
const NAV_BAR_HEIGHT = 40;

const DEFAULT_URL = "https://google.com";

/**
 * Normalize a user-typed URL string:
 * - Auto-prepend https:// if no protocol present
 * - Validate via URL constructor
 * - Returns normalized URL string or null if invalid
 */
function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  // Auto-prepend https:// if no protocol
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    // Only allow http/https protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export default function BrowserBlock({
  blockId,
  visible,
  url,
}: BrowserBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<Webview | null>(null);
  const rafIdRef = useRef<number>(0);
  const lastRectRef = useRef<{ x: number; y: number; w: number; h: number }>({
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  });
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const mountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Navigation state
  const currentUrlRef = useRef(url ?? DEFAULT_URL);
  const [addressBarValue, setAddressBarValue] = useState(url ?? DEFAULT_URL);
  const [navigating, setNavigating] = useState(false);
  const updateBlock = useAppStore((s) => s.updateBlock);

  // Track a generation counter to force webview recreation
  const generationRef = useRef(0);

  // --- Position sync ---
  const syncPosition = useCallback(async () => {
    const wv = webviewRef.current;
    const el = containerRef.current;
    if (!wv || !el) return;

    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left);
    const y = Math.round(rect.top);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    // Skip if container is too small (e.g. hidden tab)
    if (w < MIN_DIMENSION || h < MIN_DIMENSION) return;

    const last = lastRectRef.current;
    if (last.x === x && last.y === y && last.w === w && last.h === h) return;

    lastRectRef.current = { x, y, w, h };

    try {
      await wv.setPosition(new LogicalPosition(x, y));
      await wv.setSize(new LogicalSize(w, h));
    } catch (e) {
      addDebugLog(
        `[BrowserBlock:${blockId}] position sync error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }, [blockId]);

  // --- RAF loop ---
  const startRafLoop = useCallback(() => {
    const tick = () => {
      if (!mountedRef.current) return;
      syncPosition();
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, [syncPosition]);

  // --- Internal: close current webview and clean up tracking ---
  const destroyWebview = useCallback(async () => {
    // Cancel RAF
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    // Disconnect observer
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    // Close webview
    const wv = webviewRef.current;
    if (wv) {
      addDebugLog(`[BrowserBlock:${blockId}] closing webview for navigation`);
      try {
        await wv.close();
      } catch (e) {
        addDebugLog(
          `[BrowserBlock:${blockId}] close error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      webviewRef.current = null;
    }
  }, [blockId]);

  // --- Internal: create a webview for a given URL ---
  const createWebview = useCallback(
    async (targetUrl: string, gen: number): Promise<boolean> => {
      try {
        addDebugLog(
          `[BrowserBlock:${blockId}] creating webview url=${targetUrl} gen=${gen}`
        );

        // Use generation in label to avoid Tauri label collision on recreate
        const wv = new Webview(
          getCurrentWindow(),
          `browser-${blockId}-${gen}`,
          {
            url: targetUrl,
            x: 0,
            y: 0,
            width: 100,
            height: 100,
          }
        );

        // Wait for creation event
        await new Promise<void>((resolve, reject) => {
          wv.once("tauri://created", () => resolve());
          wv.once("tauri://error", (e) =>
            reject(
              new Error(
                typeof e.payload === "string"
                  ? e.payload
                  : "Webview creation failed"
              )
            )
          );
        });

        if (!mountedRef.current) {
          try {
            await wv.close();
          } catch {
            // best-effort
          }
          return false;
        }

        webviewRef.current = wv;
        addDebugLog(`[BrowserBlock:${blockId}] webview created gen=${gen}`);

        // Visibility
        if (!visible) {
          await wv.hide();
        } else {
          await wv.show();
          lastRectRef.current = { x: 0, y: 0, w: 0, h: 0 };
          syncPosition();
        }

        // Start position tracking
        if (containerRef.current) {
          const observer = new ResizeObserver(() => {
            syncPosition();
          });
          observer.observe(containerRef.current);
          resizeObserverRef.current = observer;
        }
        startRafLoop();
        return true;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown webview error";
        addDebugLog(`[BrowserBlock:${blockId}] creation error: ${msg}`);
        throw err;
      }
    },
    [blockId, visible, syncPosition, startRafLoop]
  );

  // --- Navigate to a new URL (close + recreate) ---
  /**
   * V1 limitation: Tauri v2 child webviews don't expose a navigate() or
   * evaluateJavascript() API from the parent context. Navigation is achieved
   * by closing the current webview and creating a new one with the target URL.
   *
   * This means:
   * - Back/Forward buttons cannot access the child's browsing history.
   * - The address bar shows what we navigated to, but won't auto-update
   *   when the user clicks links within the embedded page.
   */
  const navigateTo = useCallback(
    async (targetUrl: string) => {
      if (navigating) return;
      setNavigating(true);
      setLoading(true);
      setError(null);

      try {
        await destroyWebview();
        generationRef.current += 1;
        const gen = generationRef.current;
        currentUrlRef.current = targetUrl;
        setAddressBarValue(targetUrl);

        const ok = await createWebview(targetUrl, gen);
        if (ok) {
          setLoading(false);
          // Persist to store
          updateBlock(blockId, { url: targetUrl });
          addDebugLog(
            `[BrowserBlock:${blockId}] navigated to ${targetUrl}`
          );
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown navigation error";
        setError(msg);
        setLoading(false);
        addDebugLog(`[BrowserBlock:${blockId}] navigation error: ${msg}`);
      } finally {
        setNavigating(false);
      }
    },
    [blockId, navigating, destroyWebview, createWebview, updateBlock]
  );

  // --- Refresh: reload same URL ---
  const handleRefresh = useCallback(() => {
    addDebugLog(`[BrowserBlock:${blockId}] refresh`);
    navigateTo(currentUrlRef.current);
  }, [blockId, navigateTo]);

  // --- Address bar handlers ---
  const handleAddressBarKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      const normalized = normalizeUrl(addressBarValue);
      if (!normalized) {
        addDebugLog(
          `[BrowserBlock:${blockId}] invalid URL: ${addressBarValue}`
        );
        return; // No-op for empty/invalid input
      }
      navigateTo(normalized);
    },
    [blockId, addressBarValue, navigateTo]
  );

  // --- Create webview on mount ---
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function init() {
      const initUrl = currentUrlRef.current;
      const gen = generationRef.current;
      try {
        const ok = await createWebview(initUrl, gen);
        if (ok && !cancelled) {
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : "Unknown webview error";
        setError(msg);
        setLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
      mountedRef.current = false;

      // Cancel RAF
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      // Disconnect observer
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      // Close webview
      const wv = webviewRef.current;
      if (wv) {
        addDebugLog(`[BrowserBlock:${blockId}] closing webview (unmount)`);
        wv.close().catch((e) => {
          addDebugLog(
            `[BrowserBlock:${blockId}] close error: ${e instanceof Error ? e.message : String(e)}`
          );
        });
        webviewRef.current = null;
      }
    };
    // Only create once per mount — blockId is stable for a given block
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId]);

  // --- Show/hide lifecycle ---
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    if (visible) {
      wv.show().catch((e) =>
        addDebugLog(
          `[BrowserBlock:${blockId}] show error: ${e instanceof Error ? e.message : String(e)}`
        )
      );
      // Force position sync on show — rect may have changed while hidden
      lastRectRef.current = { x: 0, y: 0, w: 0, h: 0 };
      syncPosition();
      addDebugLog(`[BrowserBlock:${blockId}] show`);
    } else {
      wv.hide().catch((e) =>
        addDebugLog(
          `[BrowserBlock:${blockId}] hide error: ${e instanceof Error ? e.message : String(e)}`
        )
      );
      addDebugLog(`[BrowserBlock:${blockId}] hide`);
    }
  }, [visible, blockId, syncPosition]);

  // --- Navigation bar component ---
  const navBar = (
    <div
      className="flex items-center gap-1.5 px-2 border-b border-base-border bg-[#1a201a] shrink-0"
      style={{ height: NAV_BAR_HEIGHT }}
    >
      {/*
        V1 limitation: Tauri v2 child webviews don't expose evaluateJavascript()
        from the parent context, so we can't call history.back(), history.forward(),
        or location.reload() in the child. Back/Forward are disabled; Refresh
        uses the close-and-recreate pattern instead.
      */}
      {/* Back — disabled, would need history.back() in child */}
      <button
        type="button"
        className="px-1.5 py-0.5 text-sm text-base-muted rounded hover:bg-[#2a302a] disabled:opacity-30 disabled:cursor-not-allowed"
        disabled
        title="Back (not available — V1 limitation: no child webview history access)"
      >
        ←
      </button>
      {/* Forward — disabled, would need history.forward() in child */}
      <button
        type="button"
        className="px-1.5 py-0.5 text-sm text-base-muted rounded hover:bg-[#2a302a] disabled:opacity-30 disabled:cursor-not-allowed"
        disabled
        title="Forward (not available — V1 limitation: no child webview history access)"
      >
        →
      </button>
      {/* Refresh — recreates webview (would use location.reload() if eval were available) */}
      <button
        type="button"
        className="px-1.5 py-0.5 text-sm text-base-muted rounded hover:bg-[#2a302a] hover:text-base-fg disabled:opacity-30"
        onClick={handleRefresh}
        disabled={loading || navigating}
        title="Refresh"
      >
        ↻
      </button>
      {/* Address bar */}
      <input
        type="text"
        className="flex-1 h-6 px-2 text-xs bg-[#0e120e] text-base-fg border border-base-border rounded outline-none focus:border-green-600 placeholder:text-base-muted"
        value={addressBarValue}
        onChange={(e) => setAddressBarValue(e.target.value)}
        onKeyDown={handleAddressBarKeyDown}
        placeholder="Enter URL…"
        spellCheck={false}
        disabled={navigating}
      />
      {navigating && (
        <div className="w-3.5 h-3.5 border-2 border-base-muted border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  );

  // --- Render ---
  if (error) {
    return (
      <div className="flex flex-col h-full bg-[#141a14]">
        {navBar}
        <div className="flex-1 flex items-center justify-center text-red-400">
          <div className="text-center px-4">
            <span className="text-2xl">⚠️</span>
            <p className="text-sm mt-2">Failed to load browser</p>
            <p className="text-xs mt-1 text-base-muted max-w-xs break-words">
              {error}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#141a14]">
      {navBar}
      {/* Webview container — native webview is positioned to match this div */}
      <div ref={containerRef} className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-base-muted border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
