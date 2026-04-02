import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { debugInvoke as invoke } from "../lib/debugInvoke";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../stores/appStore";
import { sanitizeShellArg } from "../lib/shell";
import "@xterm/xterm/css/xterm.css";

interface Props {
  tabId: string;
  workspace: string;
  project: string;
  visible: boolean;
  tmuxSession?: string; // attach to this specific session instead of default
}

function tmuxSessionName(_tabId: string, project: string): string {
  const clean = sanitizeShellArg(project);
  return `gsd-term-${clean}`;
}

interface ContextMenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

function Terminal({ tabId, workspace, project, visible, tmuxSession: tmuxSessionProp }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const connectedRef = useRef(false);
  const connectingRef = useRef(false);
  const mountedRef = useRef(true);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastColsRef = useRef(0);
  const lastRowsRef = useRef(0);
  const updateTerminalTabRef = useRef(useAppStore.getState().updateTerminalTab);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    updateTerminalTabRef.current = useAppStore.getState().updateTerminalTab;
  });

  const debouncedFit = useCallback(() => {
    if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    fitTimerRef.current = setTimeout(() => {
      const container = containerRef.current;
      const fitAddon = fitAddonRef.current;
      const term = terminalRef.current;
      if (!container || !fitAddon || !term) return;
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return;

      fitAddon.fit();

      if (term.cols !== lastColsRef.current || term.rows !== lastRowsRef.current) {
        lastColsRef.current = term.cols;
        lastRowsRef.current = term.rows;
        if (connectedRef.current) {
          invoke("terminal_resize", {
            id: tabId,
            cols: term.cols,
            rows: term.rows,
          }).catch(() => {});
        }
      }
    }, 80);
  }, [tabId]);

  useEffect(() => {
    if (!visible || !fitAddonRef.current || !terminalRef.current) return;
    const raf = requestAnimationFrame(() => {
      debouncedFit();
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, debouncedFit]);

  // Copy selection to clipboard — tries xterm selection first, then tmux buffer
  const handleCopy = useCallback(async () => {
    const term = terminalRef.current;
    if (!term) { setContextMenu(null); return; }
    
    // Try xterm's local selection first (from Shift+drag)
    const sel = term.getSelection();
    if (sel) {
      navigator.clipboard.writeText(sel).catch(() => {});
      setContextMenu(null);
      return;
    }
    
    // Fall back to tmux's paste buffer (from normal drag with mouse mode on)
    try {
      const buf = await invoke<string>("exec_in_workspace", {
        workspace,
        command: `tmux show-buffer 2>/dev/null || true`,
      });
      if (buf?.trim()) {
        navigator.clipboard.writeText(buf.trim()).catch(() => {});
      }
    } catch {
      // ignore
    }
    setContextMenu(null);
  }, [workspace, tabId, project, tmuxSessionProp]);

  // Paste from clipboard into terminal
  const handlePaste = useCallback(() => {
    navigator.clipboard.readText().then((text) => {
      if (!text || !connectedRef.current) return;
      const encoded = new TextEncoder().encode(text);
      invoke("terminal_write", {
        id: tabId,
        data: Array.from(encoded),
      }).catch(() => {});
    }).catch(() => {});
    setContextMenu(null);
  }, [tabId]);

  // Select all text in terminal
  const handleSelectAll = useCallback(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.selectAll();
    setContextMenu(null);
  }, []);

  // Clear terminal
  const handleClear = useCallback(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.clear();
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    mountedRef.current = true;
    connectedRef.current = false;
    connectingRef.current = false;

    const term = new XTerm({
      fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      allowTransparency: false,
      scrollOnUserInput: true,
      fastScrollModifier: "alt",
      convertEol: false,
      rightClickSelectsWord: true,
      theme: {
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
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fit helper — retries if cell dimensions aren't ready yet
    const doInitialFit = () => {
      const el = containerRef.current;
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return false;
      const dims = fitAddon.proposeDimensions();
      if (!dims) return false; // cell size not measured yet
      fitAddon.fit();
      lastColsRef.current = term.cols;
      lastRowsRef.current = term.rows;
      return true;
    };

    // Retry fit until it succeeds — cell dimensions may not be ready immediately
    const retryFit = (attempts: number, delay: number) => {
      if (!mountedRef.current || attempts <= 0) return;
      if (doInitialFit()) return; // success
      setTimeout(() => retryFit(attempts - 1, delay * 1.5), delay);
    };

    // Initial fit — wait for fonts then fit with retries
    const fontReady = document.fonts?.ready ?? Promise.resolve();
    fontReady.then(() => {
      requestAnimationFrame(() => {
        retryFit(10, 50); // up to 10 attempts, starting at 50ms intervals
      });
    });

    // Re-fit when fonts load/swap (JetBrains Mono from Google Fonts uses display=swap)
    const onFontChange = () => debouncedFit();
    document.fonts?.addEventListener?.("loadingdone", onFontChange);

    // Block native context menu on terminal — we show our own
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, hasSelection: true });
    };
    containerRef.current.addEventListener("contextmenu", handleContextMenu);
    const containerEl = containerRef.current;

    // Cmd+C / Ctrl+C: copy if there's a selection, otherwise try tmux buffer, otherwise send interrupt
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        const sel = term.getSelection();
        if (sel) {
          e.preventDefault();
          navigator.clipboard.writeText(sel).catch(() => {});
          return;
        }
        // Try tmux paste buffer before falling through to Ctrl+C interrupt
        if (e.metaKey) {
          e.preventDefault();
          invoke<string>("exec_in_workspace", {
            workspace,
            command: `tmux show-buffer 2>/dev/null || true`,
          }).then((buf) => {
            if (buf?.trim()) {
              navigator.clipboard.writeText(buf.trim()).catch(() => {});
            }
          }).catch(() => {});
          return;
        }
        // Ctrl+C with no selection — pass through as interrupt
      }
      // Cmd+V / Ctrl+Shift+V: paste
      if ((e.metaKey && e.key === "v") || (e.ctrlKey && e.shiftKey && e.key === "V")) {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (!text || !connectedRef.current) return;
          const encoded = new TextEncoder().encode(text);
          invoke("terminal_write", {
            id: tabId,
            data: Array.from(encoded),
          }).catch(() => {});
        }).catch(() => {});
      }
    };
    containerRef.current.addEventListener("keydown", handleKeyDown, true);

    const unlistenData = listen<number[]>(
      `terminal_data_${tabId}`,
      (event) => {
        if (mountedRef.current) {
          term.write(new Uint8Array(event.payload));
        }
      }
    );

    const unlistenClose = listen(
      `terminal_closed_${tabId}`,
      () => {
        if (mountedRef.current) {
          term.writeln("\r\n\x1b[38;5;242m[Connection closed — press any key to reconnect]\x1b[0m");
          connectedRef.current = false;
          connectingRef.current = false;
        }
      }
    );

    // Use explicit session name if provided, otherwise default
    const tmuxName = sanitizeShellArg(tmuxSessionProp || tmuxSessionName(tabId, project));
    const safeProject = sanitizeShellArg(project);

    const connect = async () => {
      if (!mountedRef.current || connectingRef.current) return;
      connectingRef.current = true;

      term.writeln(`\x1b[38;5;208mGSD Control Terminal\x1b[0m`);
      term.writeln(`\x1b[38;5;242mWorkspace: ${workspace} · Project: ${project}\x1b[0m`);
      term.writeln(`\x1b[38;5;242mConnecting...\x1b[0m`);

      try {
        await invoke("terminal_close", { id: tabId }).catch(() => {});

        const checkResult = await invoke<string>("exec_in_workspace", {
          workspace,
          command: `tmux has-session -t ${tmuxName} 2>/dev/null && echo exists || echo missing`,
        });
        const sessionExists = checkResult.trim() === "exists";

        if (sessionExists) {
          term.writeln(`\x1b[38;5;242mReattaching to session: ${tmuxName}\x1b[0m`);
        } else {
          term.writeln(`\x1b[38;5;242mCreating session: ${tmuxName}\x1b[0m`);
          await invoke("exec_in_workspace", {
            workspace,
            command: `tmux new-session -d -s ${tmuxName} -c ~/${safeProject}`,
          });
        }

        updateTerminalTabRef.current(tabId, { tmuxSession: tmuxName });

        // Enable tmux mouse mode for scroll wheel support.
        // Selection: hold Shift while dragging to select in xterm (bypasses tmux).
        // Copy/paste: use Cmd+C/Cmd+V or right-click context menu.
        await invoke("exec_in_workspace", {
          workspace,
          command: `tmux set-option -t ${tmuxName} mouse on 2>/dev/null; true`,
        });

        term.writeln("");

        if (!mountedRef.current) { connectingRef.current = false; return; }

        await invoke("terminal_open_tmux", {
          id: tabId,
          workspace,
          tmuxSession: tmuxName,
        });

        if (!mountedRef.current) { connectingRef.current = false; return; }
        connectedRef.current = true;
        connectingRef.current = false;

        // Clear any garbage escape sequences from tmux attach
        term.reset();

        // Fit after DOM settles — multiple passes at increasing intervals
        // to catch flex layout resolution, font swap, and Tauri frame sizing.
        const doFit = () => {
          const el = containerRef.current;
          if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
            fitAddon.fit();
            lastColsRef.current = term.cols;
            lastRowsRef.current = term.rows;
            invoke("terminal_resize", {
              id: tabId,
              cols: term.cols,
              rows: term.rows,
            }).catch(() => {});
          }
        };

        requestAnimationFrame(() => {
          doFit();
          setTimeout(doFit, 100);
          setTimeout(doFit, 300);
          setTimeout(doFit, 800);
          setTimeout(doFit, 2000);
        });
      } catch (e) {
        connectingRef.current = false;
        if (!mountedRef.current) return;
        console.error(`Terminal ${tabId}: connection failed —`, e);
        term.writeln(`\x1b[38;5;196mConnection failed: ${e}\x1b[0m`);
        term.writeln(`\x1b[38;5;242mPress any key to retry...\x1b[0m`);
      }
    };

    connect();

    term.onData((data) => {
      if (!connectedRef.current) {
        if (!connectingRef.current) {
          connect();
        }
        return;
      }
      // Filter out terminal device attribute responses that shouldn't be sent to remote.
      // These match: ESC[?...c (DA1 response) and ESC[>...c (DA2 response)
      const filtered = data.replace(/\x1b\[\??[\d;]*c/g, "").replace(/\x1b\[>[\d;]*c/g, "");
      if (!filtered) return;

      const encoded = new TextEncoder().encode(filtered);
      invoke("terminal_write", {
        id: tabId,
        data: Array.from(encoded),
      }).catch(() => {});
    });

    const resizeObserver = new ResizeObserver(() => {
      debouncedFit();
    });
    resizeObserver.observe(containerRef.current);

    // Window resize listener as backup — Tauri window resizes may not
    // always trigger ResizeObserver synchronously on the container
    const handleWindowResize = () => debouncedFit();
    window.addEventListener("resize", handleWindowResize);

    // Re-render terminal when app comes back from minimize/background.
    // The xterm canvas goes stale when the window is hidden — force a
    // refresh + re-fit so the user sees current output without scrolling.
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && terminalRef.current) {
        terminalRef.current.refresh(0, terminalRef.current.rows - 1);
        debouncedFit();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const handleFocus = () => {
      if (terminalRef.current) {
        terminalRef.current.refresh(0, terminalRef.current.rows - 1);
        debouncedFit();
      }
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      mountedRef.current = false;
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      document.fonts?.removeEventListener?.("loadingdone", onFontChange);
      containerEl.removeEventListener("contextmenu", handleContextMenu);
      containerEl.removeEventListener("keydown", handleKeyDown, true);
      unlistenData.then((fn) => fn());
      unlistenClose.then((fn) => fn());
      invoke("terminal_close", { id: tabId }).catch(() => {});
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, workspace, project, tmuxSessionProp]);

  return (
    <>
      <div
        ref={containerRef}
        className="w-full h-full bg-[#141a14] overflow-hidden"
        onClick={() => setContextMenu(null)}
      />

      {/* Custom context menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
        >
          <div
            className="absolute bg-base-surface border border-base-border rounded-lg shadow-xl py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleCopy}
              disabled={!contextMenu.hasSelection}
              className="w-full text-left px-3 py-1.5 text-xs text-base-text hover:bg-base-bg transition-colors disabled:opacity-30 disabled:cursor-default flex items-center justify-between"
            >
              <span>Copy</span>
              <span className="text-base-muted ml-4">⌘C</span>
            </button>
            <button
              onClick={handlePaste}
              className="w-full text-left px-3 py-1.5 text-xs text-base-text hover:bg-base-bg transition-colors flex items-center justify-between"
            >
              <span>Paste</span>
              <span className="text-base-muted ml-4">⌘V</span>
            </button>
            <div className="border-t border-base-border my-1" />
            <button
              onClick={handleSelectAll}
              className="w-full text-left px-3 py-1.5 text-xs text-base-text hover:bg-base-bg transition-colors flex items-center justify-between"
            >
              <span>Select All</span>
              <span className="text-base-muted ml-4">⌘A</span>
            </button>
            <button
              onClick={handleClear}
              className="w-full text-left px-3 py-1.5 text-xs text-base-text hover:bg-base-bg transition-colors"
            >
              Clear Terminal
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default Terminal;
