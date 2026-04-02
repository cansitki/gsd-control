import { Terminal, IDisposable } from "@xterm/xterm";
import { FitAddon, ITerminalDimensions } from "@xterm/addon-fit";
import { SearchAddon, ISearchOptions } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { addDebugLog } from "./debugLogBuffer";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

/** Default dark theme — matches the GSD Control Terminal palette. */
const DEFAULT_THEME = {
  background: "#141a14",
  foreground: "#c8cdd8",
  cursor: "#f97316",
  selectionBackground: "rgba(249, 115, 22, 0.3)",
  black: "#141a14",
  red: "#ef4444",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#c8cdd8",
  brightBlack: "#5a6478",
  brightRed: "#f87171",
  brightGreen: "#6ee7b7",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f1f5f9",
} as const;

export interface TermWrapOptions {
  fontSize?: number;
  fontFamily?: string;
  scrollback?: number;
  theme?: Record<string, string>;
  onResize?: (cols: number, rows: number) => void;
  onClose?: () => void;
}

const DEFAULTS = {
  fontSize: 13,
  fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
  scrollback: 10000,
} as const;

/**
 * TermWrap — owns an xterm.js Terminal, all addons, resize logic, and Tauri
 * event wiring.  Pure TypeScript, no React dependency.
 */
export class TermWrap {
  public readonly terminal: Terminal;
  public readonly fitAddon: FitAddon;
  public readonly searchAddon: SearchAddon;

  private readonly serializeAddon: SerializeAddon;
  private readonly opts: TermWrapOptions;
  private readonly resizeObserver: ResizeObserver;
  private readonly elem: HTMLElement;

  private fitTimer: ReturnType<typeof setTimeout> | null = null;
  private fitSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCols = 0;
  private lastRows = 0;
  private unlisteners: Array<Promise<() => void>> = [];
  private disposed = false;
  private _fontLoadHandler: (() => void) | null = null;

  public _debug(msg: string): void {
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    addDebugLog(`[${ts}] [TERM] ${msg}`);
  }

  constructor(elem: HTMLElement, opts: TermWrapOptions = {}) {
    this.opts = opts;
    this.elem = elem;

    const theme = opts.theme ?? DEFAULT_THEME;
    this.terminal = new Terminal({
      fontFamily: opts.fontFamily ?? DEFAULTS.fontFamily,
      fontSize: opts.fontSize ?? DEFAULTS.fontSize,
      lineHeight: 1.1,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: opts.scrollback ?? DEFAULTS.scrollback,
      allowTransparency: false,
      scrollOnUserInput: true,
      fastScrollModifier: "alt",
      convertEol: false,
      rightClickSelectsWord: true,
      theme,
    });

    // --- Addons ---
    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.serializeAddon = new SerializeAddon();
    const webLinksAddon = new WebLinksAddon();

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.loadAddon(this.serializeAddon);
    this.terminal.loadAddon(webLinksAddon);

    // Open into DOM — must happen before WebGL addon
    this.terminal.open(elem);
    const rect = elem.getBoundingClientRect();
    this._debug(`open: container=${Math.round(rect.width)}x${Math.round(rect.height)}`);

    // --- WebGL with fallback ---
    // NOTE: WebGL disabled — Tauri's WKWebView on macOS can have WebGL
    // context issues that cause the terminal to render blank (canvas overlays
    // DOM renderer but paints nothing). The DOM/canvas renderer is fast enough.
    // To re-enable, uncomment the block below.
    /*
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        console.warn("[TermWrap] WebGL context lost — falling back to DOM renderer");
        webglAddon.dispose();
        // Force a full refresh so the DOM renderer repaints all content
        this.terminal.refresh(0, this.terminal.rows - 1);
      });
      this.terminal.loadAddon(webglAddon);
    } catch (err) {
      console.warn("[TermWrap] WebGL renderer unavailable, using DOM renderer:", err);
    }
    */

    // --- Resize via FitAddon only ---
    this.resizeObserver = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) {
        const cr = e.contentRect;
        this._debug(`ResizeObserver: ${Math.round(cr.width)}x${Math.round(cr.height)}`);
      }
      this.fit();
    });
    this.resizeObserver.observe(elem);

    // Initial sizing after fonts are loaded — fit twice to catch font metric changes
    document.fonts.ready.then(() => {
      this._debug("fonts.ready");
      this.fit(true);
      // Second fit after a frame to pick up any reflow from font swap
      requestAnimationFrame(() => this.fit(true));
    });

    // Also listen for individual font loads (catches late-loading webfonts)
    const onFontLoad = () => {
      this._debug("font loadingdone");
      this.fit(true);
    };
    document.fonts.addEventListener("loadingdone", onFontLoad);
    this._fontLoadHandler = onFontLoad;
  }

  // ── Tauri event wiring ──────────────────────────────────────────────

  /**
   * Wire up Tauri `listen()` for incoming terminal data and close events.
   * Stores unlisten handles for disposal.
   */
  connectToTauri(tabId: string): void {
    const unData = listen<number[]>(`terminal_data_${tabId}`, (event) => {
      if (!this.disposed) {
        this.terminal.write(new Uint8Array(event.payload));
      }
    });

    const unClose = listen(`terminal_closed_${tabId}`, () => {
      if (!this.disposed) {
        this.opts.onClose?.();
      }
    });

    this.unlisteners.push(unData, unClose);
  }

  // ── Input ───────────────────────────────────────────────────────────

  /** Subscribe to terminal input. Returns a disposable. */
  handleInput(callback: (data: string) => void): IDisposable {
    return this.terminal.onData(callback);
  }

  // ── Write ───────────────────────────────────────────────────────────

  write(data: string): void {
    this.terminal.write(data);
  }

  writeBytes(data: Uint8Array): void {
    this.terminal.write(data);
  }

  // ── Fit (debounced) ─────────────────────────────────────────────────

  /**
   * Debounced fit — calls FitAddon.fit() then fires onResize if dims changed.
   * Pass force=true to send resize even if dims appear unchanged (e.g. after
   * font swap where character metrics changed but container size didn't).
   */
  fit(force = false): void {
    if (this.disposed) return;
    if (this.fitTimer) clearTimeout(this.fitTimer);
    // Cancel any pending settle timer — a new fit request means we're still moving
    if (this.fitSettleTimer) clearTimeout(this.fitSettleTimer);
    this.fitTimer = setTimeout(() => {
      if (this.disposed) return;
      try {
        this.fitAddon.fit();
      } catch {
        this._debug("fit: FitAddon threw (not attached?)");
        return;
      }
      const rect = this.elem.getBoundingClientRect();
      // Read xterm's internal cell size and parent computed height for diagnostics
      let cellInfo = "";
      let computedH = 0;
      try {
        const core = (this.terminal as any)._core;
        const cssDims = core._renderService.dimensions.css.cell;
        cellInfo = `cell=${cssDims.width.toFixed(1)}x${cssDims.height.toFixed(1)}`;
        // This is exactly what FitAddon reads:
        const parentStyle = window.getComputedStyle(this.terminal.element!.parentElement!);
        computedH = parseInt(parentStyle.getPropertyValue("height"));
      } catch { /* older xterm or private API change */ }
      const dims: ITerminalDimensions | undefined =
        this.fitAddon.proposeDimensions();
      if (!dims) {
        this._debug(`fit: proposeDimensions=undefined container=${Math.round(rect.width)}x${Math.round(rect.height)} ${cellInfo}`);
        return;
      }
      const changed = dims.cols !== this.lastCols || dims.rows !== this.lastRows;
      const actual = `actual=${this.terminal.cols}x${this.terminal.rows}`;
      // Measure real DOM element heights for diagnosis
      let domInfo = "";
      try {
        const xtermEl = this.terminal.element!;
        const viewport = xtermEl.querySelector(".xterm-viewport") as HTMLElement;
        const screen = xtermEl.querySelector(".xterm-screen") as HTMLElement;
        const xtermRect = xtermEl.getBoundingClientRect();
        const vpRect = viewport?.getBoundingClientRect();
        const scRect = screen?.getBoundingClientRect();
        domInfo = `dom: .xterm=${Math.round(xtermRect.height)} .viewport=${vpRect ? Math.round(vpRect.height) : '?'} .screen=${scRect ? Math.round(scRect.height) : '?'}`;
      } catch { /* ignore */ }
      this._debug(`fit: ${dims.cols}x${dims.rows} was=${this.lastCols}x${this.lastRows} ${actual} rect=${Math.round(rect.width)}x${Math.round(rect.height)} computedH=${computedH} ${cellInfo} ${domInfo} force=${force} changed=${changed}`);
      if (force || changed) {
        this.lastCols = dims.cols;
        this.lastRows = dims.rows;
        this.opts.onResize?.(dims.cols, dims.rows);
        // Scroll to bottom when terminal grows — prevents empty scrollback
        // from showing above content
        this.terminal.scrollToBottom();
      }
      // Schedule a settle fit — if no more resize events arrive within 250ms,
      // do one final force-fit to catch any animation that ended between the
      // last debounce and now
      this.fitSettleTimer = setTimeout(() => {
        if (this.disposed) return;
        this._debug("fit-settle: final force-fit");
        try { this.fitAddon.fit(); } catch { return; }
        const d = this.fitAddon.proposeDimensions();
        if (!d) return;
        if (d.cols !== this.lastCols || d.rows !== this.lastRows) {
          this._debug(`fit-settle: ${d.cols}x${d.rows} (was ${this.lastCols}x${this.lastRows})`);
          this.lastCols = d.cols;
          this.lastRows = d.rows;
          this.opts.onResize?.(d.cols, d.rows);
        }
        // Always scroll to bottom after resize settles — prevents empty
        // scrollback from showing above content when terminal grows
        this.terminal.scrollToBottom();
      }, 250);
    }, 50);
  }

  // ── Search ──────────────────────────────────────────────────────────

  findNext(query: string, opts?: ISearchOptions): boolean {
    return this.searchAddon.findNext(query, opts);
  }

  findPrevious(query: string, opts?: ISearchOptions): boolean {
    return this.searchAddon.findPrevious(query, opts);
  }

  clearSearch(): void {
    this.searchAddon.clearDecorations();
  }

  // ── Serialize / Restore ───────────────────────────────────────────

  /** Serialize the terminal buffer via SerializeAddon. Returns empty string if disposed. */
  serialize(): string {
    if (this.disposed) return "";
    return this.serializeAddon.serialize();
  }

  /** Write previously serialized data back into the terminal (before Tauri connection). */
  restoreState(data: string): void {
    if (this.disposed) return;
    this.terminal.write(data);
  }

  // ── Disposal ────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.resizeObserver.disconnect();
    if (this._fontLoadHandler) {
      document.fonts.removeEventListener("loadingdone", this._fontLoadHandler);
      this._fontLoadHandler = null;
    }
    if (this.fitTimer) {
      clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    if (this.fitSettleTimer) {
      clearTimeout(this.fitSettleTimer);
      this.fitSettleTimer = null;
    }

    // Unlisten Tauri events
    for (const p of this.unlisteners) {
      p.then((fn) => fn()).catch(() => {});
    }
    this.unlisteners.length = 0;

    this.terminal.dispose();
  }
}
