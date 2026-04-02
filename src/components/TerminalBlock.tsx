import { useEffect, useRef, useCallback, useState } from "react";
import { TermWrap } from "../lib/termwrap";
import { debugInvoke as invoke } from "../lib/debugInvoke";
import { useAppStore } from "../stores/appStore";
import { sanitizeShellArg } from "../lib/shell";
import { saveTerminalState, getTerminalState } from "../lib/terminalStateCache";

interface Props {
  tabId: string;
  workspace: string;
  project: string;
  visible: boolean;
  tmuxSession?: string;
}

function tmuxSessionName(_tabId: string, project: string): string {
  return `gsd-term-${sanitizeShellArg(project)}`;
}

interface ContextMenuState {
  x: number;
  y: number;
}

function TerminalBlock({ tabId, workspace, project, visible, tmuxSession: tmuxSessionProp }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termWrapRef = useRef<TermWrap | null>(null);
  const connectedRef = useRef(false);
  const connectingRef = useRef(false);
  const mountedRef = useRef(true);
  const updateBlockRef = useRef(useAppStore.getState().updateBlock);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastPasteDataRef = useRef<string>("");
  const lastPasteTimeRef = useRef<number>(0);

  useEffect(() => {
    updateBlockRef.current = useAppStore.getState().updateBlock;
  });

  // Re-fit when tab becomes visible
  useEffect(() => {
    if (!visible || !termWrapRef.current) return;
    const raf = requestAnimationFrame(() => termWrapRef.current?.fit(true));
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  // Copy — xterm selection first, then tmux paste buffer
  const handleCopy = useCallback(async () => {
    const tw = termWrapRef.current;
    if (!tw) { setContextMenu(null); return; }
    const sel = tw.terminal.getSelection();
    if (sel) {
      navigator.clipboard.writeText(sel).catch(() => {});
      setContextMenu(null);
      return;
    }
    try {
      const buf = await invoke<string>("exec_in_workspace", {
        workspace,
        command: `tmux show-buffer 2>/dev/null || true`,
      });
      if (buf?.trim()) navigator.clipboard.writeText(buf.trim()).catch(() => {});
    } catch { /* ignore */ }
    setContextMenu(null);
  }, [workspace]);

  // Paste dedup helper — prevents double-sends from xterm + keyboard handler
  const sendPaste = useCallback((text: string) => {
    if (!text || !connectedRef.current) return;
    if (text === lastPasteDataRef.current && Date.now() - lastPasteTimeRef.current < 500) return;
    lastPasteDataRef.current = text;
    lastPasteTimeRef.current = Date.now();
    const encoded = new TextEncoder().encode(text);
    invoke("terminal_write", { id: tabId, data: Array.from(encoded) }).catch(() => {});
  }, [tabId]);

  // Paste
  const handlePaste = useCallback(() => {
    navigator.clipboard.readText().then((text) => {
      sendPaste(text);
    }).catch(() => {});
    setContextMenu(null);
  }, [sendPaste]);

  const handleSelectAll = useCallback(() => {
    termWrapRef.current?.terminal.selectAll();
    setContextMenu(null);
  }, []);

  const handleClear = useCallback(() => {
    termWrapRef.current?.terminal.clear();
    setContextMenu(null);
  }, []);

  // --- Search handlers ---
  const handleSearchNext = useCallback(() => {
    if (searchQuery && termWrapRef.current) {
      termWrapRef.current.findNext(searchQuery, { caseSensitive });
    }
  }, [searchQuery, caseSensitive]);

  const handleSearchPrevious = useCallback(() => {
    if (searchQuery && termWrapRef.current) {
      termWrapRef.current.findPrevious(searchQuery, { caseSensitive });
    }
  }, [searchQuery, caseSensitive]);

  const handleSearchClose = useCallback(() => {
    termWrapRef.current?.clearSearch();
    setSearchOpen(false);
    setSearchQuery("");
  }, []);

  // Main terminal lifecycle effect
  useEffect(() => {
    if (!containerRef.current) return;

    mountedRef.current = true;
    connectedRef.current = false;
    connectingRef.current = false;
    // Track intentional close to suppress stale close events from our own terminal_close call
    let intentionalClose = false;

    let tw: TermWrap;
    try {
      tw = new TermWrap(containerRef.current, {
        fontSize: 13,
        onResize: (cols, rows) => {
          tw._debug(`onResize → ${cols}x${rows} connected=${connectedRef.current}`);
          if (connectedRef.current) {
            invoke("terminal_resize", { id: tabId, cols, rows }).catch(() => {});
          }
        },
        onClose: () => {
          // Ignore close events triggered by our own pre-connect terminal_close call
          if (intentionalClose) return;
          if (mountedRef.current) {
            tw.write("\r\n\x1b[38;5;242m[Connection closed — press any key to reconnect]\x1b[0m");
            connectedRef.current = false;
            connectingRef.current = false;
          }
        },
      });
    } catch (err) {
      console.error("[TerminalBlock] Failed to create terminal:", err);
      return;
    }

    termWrapRef.current = tw;

    // Restore cached terminal state (from previous mount) before Tauri connection
    const cachedState = getTerminalState(tabId);
    if (cachedState) {
      tw.restoreState(cachedState);
    }

    // Wire Tauri data/close listeners
    tw.connectToTauri(tabId);

    // --- Context menu ---
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    };
    const containerEl = containerRef.current;
    containerEl.addEventListener("contextmenu", handleContextMenu);

    // --- Keyboard: Cmd+C copy, Cmd+V paste, Cmd+F search ---
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+F / Ctrl+F → open search
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        // Focus will happen via the searchOpen useEffect
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        const sel = tw.terminal.getSelection();
        if (sel) {
          e.preventDefault();
          navigator.clipboard.writeText(sel).catch(() => {});
          return;
        }
        if (e.metaKey) {
          e.preventDefault();
          invoke<string>("exec_in_workspace", {
            workspace,
            command: `tmux show-buffer 2>/dev/null || true`,
          }).then((buf) => {
            if (buf?.trim()) navigator.clipboard.writeText(buf.trim()).catch(() => {});
          }).catch(() => {});
          return;
        }
      }
      if ((e.metaKey && e.key === "v") || (e.ctrlKey && e.shiftKey && e.key === "V")) {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          sendPaste(text);
        }).catch(() => {});
      }
    };
    containerEl.addEventListener("keydown", handleKeyDown, true);

    // --- Connect ---
    const tmuxName = sanitizeShellArg(tmuxSessionProp || tmuxSessionName(tabId, project));
    const safeProject = sanitizeShellArg(project);

    const connect = async () => {
      if (!mountedRef.current || connectingRef.current) return;
      connectingRef.current = true;

      tw.write(`\x1b[38;5;208mGSD Control Terminal\x1b[0m\r\n`);
      tw.write(`\x1b[38;5;242mWorkspace: ${workspace} · Project: ${project}\x1b[0m\r\n`);
      tw.write(`\x1b[38;5;242mConnecting...\x1b[0m\r\n`);

      try {
        // Flag to suppress the close event from our own pre-connect cleanup
        intentionalClose = true;
        await invoke("terminal_close", { id: tabId }).catch(() => {});
        // Small delay to let any stale close event drain before we clear the flag
        await new Promise((r) => setTimeout(r, 50));
        intentionalClose = false;

        const checkResult = await invoke<string>("exec_in_workspace", {
          workspace,
          command: `tmux has-session -t ${tmuxName} 2>/dev/null && echo exists || echo missing`,
        });

        if (checkResult.trim() === "exists") {
          tw.write(`\x1b[38;5;242mReattaching to session: ${tmuxName}\x1b[0m\r\n`);
        } else {
          tw.write(`\x1b[38;5;242mCreating session: ${tmuxName}\x1b[0m\r\n`);
          await invoke("exec_in_workspace", {
            workspace,
            command: `tmux new-session -d -s ${tmuxName} -c ~/${safeProject}`,
          });
        }

        updateBlockRef.current(tabId, { tmuxSession: tmuxName });

        await invoke("exec_in_workspace", {
          workspace,
          command: `tmux set-option -t ${tmuxName} mouse on 2>/dev/null; true`,
        });

        tw.write("\r\n");
        if (!mountedRef.current) { connectingRef.current = false; return; }

        await invoke("terminal_open_tmux", {
          id: tabId,
          workspace,
          tmuxSession: tmuxName,
        });

        if (!mountedRef.current) { connectingRef.current = false; return; }
        connectedRef.current = true;
        connectingRef.current = false;
        tw._debug("connected=true");

        // Clear screen content but don't fully reset terminal state —
        // terminal.reset() can leave WebGL renderer in a bad state
        tw.terminal.clear();
        tw.write("\x1b[H\x1b[2J");  // CSI clear screen + home cursor
        tw.terminal.scrollToBottom();

        // Fit after connect — force=true ensures resize is sent to tmux
        // even if dims haven't changed since the initial fit
        requestAnimationFrame(() => {
          tw._debug("post-connect fit(true) RAF");
          tw.fit(true);
          setTimeout(() => {
            tw._debug("post-connect fit(true) +100ms");
            tw.fit(true);
            tw.terminal.scrollToBottom();
          }, 100);
          setTimeout(() => {
            tw._debug("post-connect fit(true) +300ms");
            tw.fit(true);
            tw.terminal.scrollToBottom();
          }, 300);
          setTimeout(() => {
            tw._debug("post-connect fit(true) +1000ms");
            tw.fit(true);
            tw.terminal.scrollToBottom();
            // Write diagnostic info directly into terminal for visibility
            const el = containerRef.current;
            if (el) {
              const rect = el.getBoundingClientRect();
              const xtermEl = tw.terminal.element;
              const viewport = xtermEl?.querySelector(".xterm-viewport") as HTMLElement | null;
              const screen = xtermEl?.querySelector(".xterm-screen") as HTMLElement | null;
              const xtermH = xtermEl ? Math.round(xtermEl.getBoundingClientRect().height) : "?";
              const vpH = viewport ? Math.round(viewport.getBoundingClientRect().height) : "?";
              const scH = screen ? Math.round(screen.getBoundingClientRect().height) : "?";
              const core = (tw.terminal as any)._core;
              let cellH = "?";
              try { cellH = core._renderService.dimensions.css.cell.height.toFixed(1); } catch {}
              tw.write(`\r\n\x1b[38;5;242m[diag] container=${Math.round(rect.width)}x${Math.round(rect.height)} .xterm=${xtermH} .viewport=${vpH} .screen=${scH} cell.h=${cellH} cols=${tw.terminal.cols} rows=${tw.terminal.rows}\x1b[0m\r\n`);
            }
          }, 1000);
        });
      } catch (e) {
        connectingRef.current = false;
        if (!mountedRef.current) return;
        console.error(`Terminal ${tabId}: connection failed —`, e);
        tw.write(`\x1b[38;5;196mConnection failed: ${e}\x1b[0m\r\n`);
        tw.write(`\x1b[38;5;242mPress any key to retry...\x1b[0m\r\n`);
      }
    };

    connect();

    // --- Input ---
    tw.handleInput((data) => {
      if (!connectedRef.current) {
        if (!connectingRef.current) connect();
        return;
      }
      const filtered = data.replace(/\x1b\[\??[\d;]*c/g, "").replace(/\x1b\[>[\d;]*c/g, "");
      if (!filtered) return;
      const encoded = new TextEncoder().encode(filtered);
      invoke("terminal_write", { id: tabId, data: Array.from(encoded) }).catch(() => {});
    });

    // --- Window events ---
    const handleWindowResize = () => { tw._debug("window resize"); tw.fit(); };
    window.addEventListener("resize", handleWindowResize);

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && termWrapRef.current) {
        tw._debug("visibilitychange → visible");
        tw.terminal.refresh(0, tw.terminal.rows - 1);
        tw.fit();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const handleFocus = () => {
      if (termWrapRef.current) {
        tw._debug("window focus");
        tw.terminal.refresh(0, tw.terminal.rows - 1);
        tw.fit();
      }
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      containerEl.removeEventListener("contextmenu", handleContextMenu);
      containerEl.removeEventListener("keydown", handleKeyDown, true);
      invoke("terminal_close", { id: tabId }).catch(() => {});
      // Save terminal buffer before disposal so it can be restored on remount
      saveTerminalState(tabId, tw.serialize());
      tw.dispose();
      termWrapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, workspace, project, tmuxSessionProp]);

  // Focus search input when search bar opens
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  // Live search as query changes
  useEffect(() => {
    if (searchOpen && searchQuery && termWrapRef.current) {
      termWrapRef.current.findNext(searchQuery, { caseSensitive });
    } else if (!searchQuery && termWrapRef.current) {
      termWrapRef.current.clearSearch();
    }
  }, [searchQuery, caseSensitive, searchOpen]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
      className="bg-[#141a14] overflow-hidden"
      onClick={() => setContextMenu(null)}
    >
      {/* Search bar */}
      {searchOpen && (
        <div
          className="absolute top-0 right-0 z-20 flex items-center gap-1 px-2 py-1 bg-[#1a2020] border border-base-border/50 rounded-bl-lg shadow-lg"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              handleSearchClose();
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) {
                handleSearchPrevious();
              } else {
                handleSearchNext();
              }
            }
          }}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search…"
            className="bg-[#141a14] text-xs text-base-text border border-base-border/40 rounded px-2 py-0.5 w-[160px] outline-none focus:border-accent-orange/50 placeholder:text-base-muted/50"
          />
          <button
            onClick={() => setCaseSensitive(!caseSensitive)}
            className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
              caseSensitive
                ? "border-accent-orange/50 text-accent-orange bg-accent-orange/10"
                : "border-base-border/40 text-base-muted hover:text-base-text"
            }`}
            title="Case sensitive"
          >
            Aa
          </button>
          <button
            onClick={handleSearchPrevious}
            className="text-xs px-1.5 py-0.5 rounded border border-base-border/40 text-base-muted hover:text-base-text transition-colors"
            title="Previous match (Shift+Enter)"
          >
            ▲
          </button>
          <button
            onClick={handleSearchNext}
            className="text-xs px-1.5 py-0.5 rounded border border-base-border/40 text-base-muted hover:text-base-text transition-colors"
            title="Next match (Enter)"
          >
            ▼
          </button>
          <button
            onClick={handleSearchClose}
            className="text-xs px-1.5 py-0.5 rounded text-base-muted hover:text-accent-red transition-colors"
            title="Close (Escape)"
          >
            ✕
          </button>
        </div>
      )}

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
              className="w-full text-left px-3 py-1.5 text-xs text-base-text hover:bg-base-bg transition-colors flex items-center justify-between"
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
    </div>
  );
}

export default TerminalBlock;
