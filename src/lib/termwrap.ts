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
 *
 * Key architectural notes:
 * - WebGL addon is disabled — Tauri's WKWebView on macOS has WebGL context
 *   issues that cause blank terminal rendering. DOM renderer works fine.
 * - lineHeight is 1.1, not the default 1.0 or the original 1.4. JetBrains
 *   Mono's natural metrics at 13px are ~16.4px; 1.4 gave 23px/row which
 *   wasted ~36% of vertical space.
 * - The SSH connection uses Stdio::piped() (no local PTY), so SIGWINCH
 *   doesn't propagate. Terminal resize is handled by:
 *   (a) Rust backend: tmux resize-window -x -y via SSH exec
 *   (b) Frontend: stty on /proc/<client_pid>/fd/0 to update remote PTY size
 *   (c) Frontend: tmux refresh-client to make tmux re-read client size
 */
export class TermWrap {
  public readonly terminal: Terminal;
  public readonly fitAddon: FitAddon;
  public readonly searchAddon: SearchAddon;

  private readonly serializeAddon: SerializeAddon;
  private readonly opts: TermWrapOptions;
  private readonly resizeObserver: ResizeObserver;

  private fitTimer: ReturnType<typeof setTimeout> | null = null;
  private fitSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCols = 0;
  private lastRows = 0;
  private unlisteners: Array<Promise<() => void>> = [];
  private disposed = false;
  private _fontLoadHandler: (() => void) | null = null;

  /** Debug log to settings debug viewer. Kept for future diagnostics. */
  public _debug(msg: string): void {
    const ts = new Date().toISOString().slice(11, 23);
    addDebugLog(`[${ts}] [TERM] ${msg}`);
  }

  constructor(elem: HTMLElement, opts: TermWrapOptions = {}) {
    this.opts = opts;

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
      macOptionClickForcesSelection: true,
      altClickMovesCursor: false,
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

    // Open into DOM
    this.terminal.open(elem);
    const rect = elem.getBoundingClientRect();
    this._debug(`open: container=${Math.round(rect.width)}x${Math.round(rect.height)}`);

    // WebGL disabled — Tauri's WKWebView on macOS has WebGL context issues
    // that cause blank terminal rendering. DOM/canvas renderer works fine.

    // --- Resize via FitAddon only ---
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(elem);

    // Initial sizing after fonts are loaded
    document.fonts.ready.then(() => {
      this.fit(true);
      requestAnimationFrame(() => this.fit(true));
    });

    // Listen for late-loading webfonts (e.g. JetBrains Mono from Google Fonts)
    const onFontLoad = () => this.fit(true);
    document.fonts.addEventListener("loadingdone", onFontLoad);
    this._fontLoadHandler = onFontLoad;
  }

  // ── Tauri event wiring ──────────────────────────────────────────────

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
    if (this.fitSettleTimer) clearTimeout(this.fitSettleTimer);
    this.fitTimer = setTimeout(() => {
      if (this.disposed) return;
      try {
        this.fitAddon.fit();
      } catch {
        return;
      }
      const dims: ITerminalDimensions | undefined =
        this.fitAddon.proposeDimensions();
      if (!dims) return;
      const changed = dims.cols !== this.lastCols || dims.rows !== this.lastRows;
      if (changed) {
        this._debug(`fit: ${dims.cols}x${dims.rows} (was ${this.lastCols}x${this.lastRows})`);
      }
      if (force || changed) {
        this.lastCols = dims.cols;
        this.lastRows = dims.rows;
        this.opts.onResize?.(dims.cols, dims.rows);
        this.terminal.scrollToBottom();
      }
      // Settle timer — one final fit after resize events stop
      this.fitSettleTimer = setTimeout(() => {
        if (this.disposed) return;
        try { this.fitAddon.fit(); } catch { return; }
        const d = this.fitAddon.proposeDimensions();
        if (!d) return;
        if (d.cols !== this.lastCols || d.rows !== this.lastRows) {
          this._debug(`fit-settle: ${d.cols}x${d.rows} (was ${this.lastCols}x${this.lastRows})`);
          this.lastCols = d.cols;
          this.lastRows = d.rows;
          this.opts.onResize?.(d.cols, d.rows);
        }
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

  serialize(): string {
    if (this.disposed) return "";
    return this.serializeAddon.serialize();
  }

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

    for (const p of this.unlisteners) {
      p.then((fn) => fn()).catch(() => {});
    }
    this.unlisteners.length = 0;

    this.terminal.dispose();
  }
}
