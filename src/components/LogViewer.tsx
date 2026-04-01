import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { sanitizeShellArg } from "../lib/shell";

interface LogEntry {
  cmd: string;
  params: Record<string, string>;
  ts: string;
  actor?: string;
  session_id?: string;
}

function formatEvent(entry: LogEntry): string {
  const time = new Date(entry.ts).toLocaleTimeString();
  const params = Object.entries(entry.params || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `[${time}] ${entry.cmd}  ${params}`;
}

function eventColor(cmd: string): string {
  if (cmd.includes("complete-milestone")) return "text-accent-green font-medium";
  if (cmd.includes("complete-slice")) return "text-accent-green";
  if (cmd.includes("complete-task")) return "text-accent-green/80";
  if (cmd.includes("plan")) return "text-accent-blue";
  if (cmd.includes("error") || cmd.includes("fail")) return "text-accent-red";
  return "text-base-text/80";
}

function LogViewer() {
  const workspaces = useAppStore((s) => s.workspaces);
  const connection = useAppStore((s) => s.connection);

  const [logs, setLogs] = useState<{ project: string; entry: LogEntry }[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterProject, setFilterProject] = useState<string>("all");
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    if (connection.status !== "connected") return;
    setLoading(true);

    const allLogs: { project: string; entry: LogEntry }[] = [];

    for (const ws of workspaces) {
      for (const proj of ws.projects) {
        try {
          const raw = await invoke<string>("exec_in_workspace", {
            workspace: ws.coderName,
            command: `tail -50 ~/${sanitizeShellArg(proj.path)}/.gsd/event-log.jsonl 2>/dev/null`,
          });
          if (!raw || !raw.trim()) continue;

          for (const line of raw.trim().split("\n")) {
            try {
              const entry: LogEntry = JSON.parse(line);
              allLogs.push({ project: `${ws.displayName} / ${proj.displayName}`, entry });
            } catch { /* skip invalid lines */ }
          }
        } catch { /* project might not have event log */ }
      }
    }

    // Sort by timestamp
    allLogs.sort(
      (a, b) => new Date(a.entry.ts).getTime() - new Date(b.entry.ts).getTime()
    );
    setLogs(allLogs);
    setLoading(false);
  }, [workspaces, connection.status]);

  // Fetch on mount and every 30 seconds
  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30_000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length, autoScroll]);

  // Unique projects for filter dropdown
  const projectNames = [...new Set(logs.map((l) => l.project))];

  const filteredLogs = logs.filter((l) => {
    if (filterProject !== "all" && l.project !== filterProject) return false;
    if (search) {
      const text = formatEvent(l.entry) + " " + l.project;
      return text.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-base-border bg-base-surface">
        <select
          value={filterProject}
          onChange={(e) => setFilterProject(e.target.value)}
          className="bg-base-bg border border-base-border rounded px-2 py-1 text-xs text-base-text"
        >
          <option value="all">All Projects</option>
          {projectNames.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search events..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-base-bg border border-base-border rounded px-3 py-1 text-xs text-base-text placeholder-base-muted focus:border-accent-orange/50 outline-none"
        />
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="text-xs px-2 py-1 rounded border border-base-border text-base-muted hover:text-base-text"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`text-xs px-2 py-1 rounded border ${
            autoScroll
              ? "border-accent-green/30 text-accent-green"
              : "border-base-border text-base-muted"
          }`}
        >
          {autoScroll ? "Auto ↓" : "Paused"}
        </button>
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-base-muted">
            {loading
              ? "Loading events..."
              : logs.length === 0
                ? "No events found. GSD event logs will appear here."
                : "No matches for filter."}
          </div>
        ) : (
          filteredLogs.map((l, i) => (
            <div key={i} className="flex gap-3 py-0.5 group hover:bg-base-surface/50 rounded px-1">
              <span className="text-base-muted/50 flex-shrink-0 text-xs w-16 text-right">
                {new Date(l.entry.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
              <span className="text-base-muted flex-shrink-0 w-16">
                {new Date(l.entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className={`flex-shrink-0 w-36 ${eventColor(l.entry.cmd)}`}>
                {l.entry.cmd}
              </span>
              <span className="text-base-text/60 flex-shrink-0">
                {Object.values(l.entry.params || {}).join(" / ")}
              </span>
              <span className="ml-auto text-base-muted/40 text-xs opacity-0 group-hover:opacity-100">
                {l.project}
              </span>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Footer */}
      <div className="px-4 py-1.5 border-t border-base-border bg-base-surface text-xs text-base-muted flex items-center justify-between">
        <span>{filteredLogs.length} events</span>
        <span>Last 50 events per project · Updates every 30s</span>
      </div>
    </div>
  );
}

export default LogViewer;
