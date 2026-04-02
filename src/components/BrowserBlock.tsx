import { useEffect, useRef, useState, useCallback } from "react";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { addDebugLog } from "../lib/debugLogBuffer";

interface BrowserBlockProps {
  blockId: string;
  visible: boolean;
  url?: string;
}

/** Minimum dimension to consider a rect valid for webview positioning. */
const MIN_DIMENSION = 2;

/** Height in px for the placeholder nav area (real controls come in T02). */
const NAV_BAR_HEIGHT = 40;

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

  // --- Create webview on mount ---
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function create() {
      try {
        addDebugLog(
          `[BrowserBlock:${blockId}] creating webview url=${url ?? "https://google.com"}`
        );

        const wv = new Webview(getCurrentWindow(), `browser-${blockId}`, {
          url: url ?? "https://google.com",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        });

        // Wait for creation event
        await new Promise<void>((resolve, reject) => {
          wv.once("tauri://created", () => resolve());
          wv.once("tauri://error", (e) =>
            reject(new Error(typeof e.payload === "string" ? e.payload : "Webview creation failed"))
          );
        });

        if (cancelled) {
          // Component unmounted during creation
          try {
            await wv.close();
          } catch {
            // best-effort cleanup
          }
          return;
        }

        webviewRef.current = wv;
        setLoading(false);
        addDebugLog(`[BrowserBlock:${blockId}] webview created`);

        // Initial visibility
        if (!visible) {
          await wv.hide();
          addDebugLog(`[BrowserBlock:${blockId}] hide (initial)`);
        } else {
          await wv.show();
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
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : "Unknown webview error";
        setError(msg);
        setLoading(false);
        addDebugLog(`[BrowserBlock:${blockId}] creation error: ${msg}`);
      }
    }

    create();

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
        addDebugLog(`[BrowserBlock:${blockId}] closing webview`);
        wv.close().catch((e) => {
          addDebugLog(
            `[BrowserBlock:${blockId}] close error: ${e instanceof Error ? e.message : String(e)}`
          );
        });
        webviewRef.current = null;
      }
    };
    // Only create once per mount — blockId and url are stable for a given block
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

  // --- Render ---
  if (error) {
    return (
      <div className="flex flex-col h-full bg-[#141a14]">
        {/* Nav placeholder */}
        <div
          className="flex items-center px-3 border-b border-base-border bg-[#1a201a] shrink-0"
          style={{ height: NAV_BAR_HEIGHT }}
        >
          <span className="text-xs text-base-muted">Browser</span>
        </div>
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
      {/* Nav placeholder — real controls come in T02 */}
      <div
        className="flex items-center px-3 border-b border-base-border bg-[#1a201a] shrink-0"
        style={{ height: NAV_BAR_HEIGHT }}
      >
        <span className="text-xs text-base-muted">
          {loading ? "Loading…" : url ?? "https://google.com"}
        </span>
      </div>
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
