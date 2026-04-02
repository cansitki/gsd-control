import { Terminal, IDisposable } from "@xterm/xterm";
import { FitAddon, ITerminalDimensions } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon, ISearchOptions } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
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

  private fitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCols = 0;
  private lastRows = 0;
  private unlisteners: Array<Promise<() => void>> = [];
  private disposed = false;

  constructor(elem: HTMLElement, opts: TermWrapOptions = {}) {
    this.opts = opts;

    const theme = opts.theme ?? DEFAULT_THEME;
    this.terminal = new Terminal({
      fontFamily: opts.fontFamily ?? DEFAULTS.fontFamily,
      fontSize: opts.fontSize ?? DEFAULTS.fontSize,
      lineHeight: 1.4,
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

    // --- WebGL with fallback ---
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        console.warn("[TermWrap] WebGL context lost — falling back to DOM renderer");
        webglAddon.dispose();
      });
      this.terminal.loadAddon(webglAddon);
    } catch (err) {
      console.warn("[TermWrap] WebGL renderer unavailable, using DOM renderer:", err);
    }

    // --- Resize via FitAddon only ---
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(elem);

    // Initial sizing after fonts are loaded
    document.fonts.ready.then(() => this.fit());
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

  /** Debounced fit — calls FitAddon.fit() then fires onResize if dims changed. */
  fit(): void {
    if (this.disposed) return;
    if (this.fitTimer) clearTimeout(this.fitTimer);
    this.fitTimer = setTimeout(() => {
      if (this.disposed) return;
      try {
        this.fitAddon.fit();
      } catch {
        // FitAddon throws if terminal not attached — safe to ignore
        return;
      }
      const dims: ITerminalDimensions | undefined =
        this.fitAddon.proposeDimensions();
      if (!dims) return;
      if (dims.cols !== this.lastCols || dims.rows !== this.lastRows) {
        this.lastCols = dims.cols;
        this.lastRows = dims.rows;
        this.opts.onResize?.(dims.cols, dims.rows);
      }
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
    if (this.fitTimer) {
      clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }

    // Unlisten Tauri events
    for (const p of this.unlisteners) {
      p.then((fn) => fn()).catch(() => {});
    }
    this.unlisteners.length = 0;

    this.terminal.dispose();
  }
}
