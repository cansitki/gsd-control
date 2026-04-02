import { useEffect, useRef, useCallback } from "react";
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

    // Initial fit — two passes to catch layout settling
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        fitAddon.fit();
        lastColsRef.current = term.cols;
        lastRowsRef.current = term.rows;
      }
      // Second pass after CSS/layout fully settles
      setTimeout(() => {
        const el2 = containerRef.current;
        if (el2 && el2.offsetWidth > 0 && el2.offsetHeight > 0) {
          fitAddon.fit();
          lastColsRef.current = term.cols;
          lastRowsRef.current = term.rows;
        }
      }, 150);
    });

    // Let tmux handle scroll via mouse mode (set during connect).
    // No local wheel interception needed — tmux enters copy-mode on scroll up.

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

        // Enable tmux mouse mode so scroll wheel enters copy-mode for history
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

        // Fit after DOM settles — two passes to catch layout shifts
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
          // Second pass — catches late layout shifts from tab/view transitions
          setTimeout(doFit, 250);
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

    return () => {
      mountedRef.current = false;
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleWindowResize);
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
    <div
      ref={containerRef}
      className="w-full h-full bg-[#141a14] overflow-hidden"
    />
  );
}

export default Terminal;
