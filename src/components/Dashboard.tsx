import { useState, useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { useSSH } from "../hooks/useSSH";
import SessionCard from "./SessionCard";
import CostChart from "./CostChart";
import { useCostHistory } from "../hooks/useCostHistory";
import type { DateRange } from "../lib/types";

type DatePreset = DateRange["preset"];

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "custom", label: "Custom" },
];

function formatRangeLabel(range: DateRange): string {
  switch (range.preset) {
    case "today":
      return "Today";
    case "week":
      return "This Week";
    case "month":
      return "This Month";
    case "custom": {
      if (range.start && range.end) {
        const fmtDate = (iso: string) => {
          const d = new Date(iso + "T00:00:00");
          return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        };
        return `${fmtDate(range.start)} – ${fmtDate(range.end)}`;
      }
      return "Custom Range";
    }
    default:
      return "Cost History";
  }
}

function formatTimeAgo(ts: number): string {
  if (ts === 0) return "never";
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function Dashboard() {
  const sessions = useAppStore((s) => s.sessions);
  const events = useAppStore((s) => s.events);
  const connection = useAppStore((s) => s.connection);
  const lastPollTime = useAppStore((s) => s.lastPollTime);
  const workspaceHealth = useAppStore((s) => s.workspaceHealth);
  const workspaces = useAppStore((s) => s.workspaces);

  const [dateRange, setDateRange] = useState<DateRange>({ preset: "week" });
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const costHistory = useCostHistory(dateRange);
  const { fetchGSDData } = useSSH();
  const [refreshing, setRefreshing] = useState(false);

  // Ticking "last poll" display
  const [, setTick] = useState(0);
  useEffect(() => {
    if (lastPollTime === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, [lastPollTime]);

  const handlePresetClick = useCallback((preset: DatePreset) => {
    if (preset === "custom") {
      // When switching to custom, set range with current custom dates (or empty)
      setDateRange((prev) => ({
        preset: "custom",
        start: prev.preset === "custom" ? prev.start : "",
        end: prev.preset === "custom" ? prev.end : "",
      }));
    } else {
      setDateRange({ preset });
    }
  }, []);

  const handleCustomApply = useCallback(() => {
    if (customStart && customEnd) {
      setDateRange({ preset: "custom", start: customStart, end: customEnd });
    }
  }, [customStart, customEnd]);

  const parseTokenStr = (s: string | null): number => {
    if (!s) return 0;
    const m = s.match(/([\d.]+)([MK])/);
    if (!m) return 0;
    return parseFloat(m[1]) * (m[2] === "M" ? 1e6 : 1e3);
  };

  const sessionList = useMemo(() => Object.values(sessions), [sessions]);
  const activeSessions = useMemo(() => sessionList.filter((s) => s.isRunning), [sessionList]);
  const totalCost = useMemo(
    () => sessionList.reduce((sum, s) => sum + (s.status.cost ?? 0), 0),
    [sessionList]
  );
  const totalTokensRead = useMemo(
    () => sessionList.reduce((sum, s) => sum + parseTokenStr(s.status.tokensRead), 0),
    [sessionList]
  );
  const totalTokensWrite = useMemo(
    () => sessionList.reduce((sum, s) => sum + parseTokenStr(s.status.tokensWrite), 0),
    [sessionList]
  );

  const formatTokens = (n: number): string => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return n.toString();
  };

  // Workspace connection health summary
  const healthSummary = useMemo(() => {
    const total = workspaces.length;
    const healthyCount = Object.values(workspaceHealth).filter(
      (s) => s === "ok"
    ).length;
    return { healthy: healthyCount, total };
  }, [workspaceHealth, workspaces]);

  const rangeLabel = formatRangeLabel(dateRange);
  const recentEvents = useMemo(() => events.slice(0, 10), [events]);

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header with last-poll and refresh */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-base-text">Dashboard</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-base-muted">
            Last poll: {formatTimeAgo(lastPollTime)}
          </span>
          <button
            onClick={async () => {
              setRefreshing(true);
              await fetchGSDData();
              setRefreshing(false);
            }}
            disabled={refreshing}
            className="text-xs px-3 py-1.5 rounded border border-base-border text-base-muted hover:text-base-text hover:border-accent-orange/30 transition-colors disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-base-surface border border-base-border rounded-lg p-4">
          <p className="text-xs text-base-muted uppercase tracking-wider">
            Active Sessions
          </p>
          <p className="text-2xl font-bold text-accent-green mt-1">
            {activeSessions.length}
          </p>
        </div>
        <div className="bg-base-surface border border-base-border rounded-lg p-4">
          <p className="text-xs text-base-muted uppercase tracking-wider">
            Total Cost
          </p>
          <p className="text-2xl font-bold text-accent-amber mt-1">
            ${totalCost.toFixed(2)}
          </p>
        </div>
        <div className="bg-base-surface border border-base-border rounded-lg p-4">
          <p className="text-xs text-base-muted uppercase tracking-wider">
            Tokens (all projects)
          </p>
          <p className="text-2xl font-bold text-accent-blue mt-1">
            {formatTokens(totalTokensRead + totalTokensWrite)}
          </p>
          <div className="flex gap-3 mt-1 text-xs text-base-muted">
            <span>↓ {formatTokens(totalTokensRead)}</span>
            <span>↑ {formatTokens(totalTokensWrite)}</span>
          </div>
        </div>
        <div className="bg-base-surface border border-base-border rounded-lg p-4">
          <p className="text-xs text-base-muted uppercase tracking-wider">
            Connection
          </p>
          <p
            className={`text-2xl font-bold mt-1 ${
              connection.status === "connected"
                ? "text-accent-green"
                : connection.status === "reconnecting"
                  ? "text-accent-amber animate-pulse"
                  : "text-accent-red"
            }`}
          >
            {connection.status === "connected"
              ? "Online"
              : connection.status === "reconnecting"
                ? "Reconnecting..."
                : "Offline"}
          </p>
          {healthSummary.total > 0 && (
            <p className="text-xs text-base-muted mt-1">
              {healthSummary.healthy}/{healthSummary.total} ws healthy
            </p>
          )}
        </div>
      </div>

      {/* Date range selector + Cost chart */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handlePresetClick(key)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                dateRange.preset === key
                  ? "bg-accent-orange/20 text-accent-orange border-accent-orange/30"
                  : "border-base-border text-base-muted hover:text-base-text hover:border-accent-orange/30"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom date inputs */}
        {dateRange.preset === "custom" && (
          <div className="flex items-center gap-2 mb-3">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="text-xs px-2 py-1.5 rounded border border-base-border bg-base-bg text-base-text"
            />
            <span className="text-xs text-base-muted">–</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="text-xs px-2 py-1.5 rounded border border-base-border bg-base-bg text-base-text"
            />
            <button
              onClick={handleCustomApply}
              disabled={!customStart || !customEnd}
              className="text-xs px-3 py-1.5 rounded border border-accent-orange/30 text-accent-orange hover:bg-accent-orange/10 transition-colors disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        )}

        <CostChart
          data={costHistory.data}
          totalCost={costHistory.totalCost}
          loading={costHistory.loading}
          rangeLabel={rangeLabel}
        />
      </div>

      {/* Session grid */}
      <h2 className="text-xs font-semibold text-base-muted uppercase tracking-wider mb-3">
        Projects
      </h2>
      {sessionList.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-base-muted text-sm">No sessions discovered yet</p>
          <p className="text-base-muted/60 text-xs mt-1">
            {connection.status === "connected"
              ? "Scanning workspaces..."
              : "Connect to your Coder instance to get started"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {sessionList.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}

      {/* Recent events */}
      {recentEvents.length > 0 && (
        <>
          <h2 className="text-xs font-semibold text-base-muted uppercase tracking-wider mb-3 mt-6">
            Recent Events
          </h2>
          <div className="space-y-1">
            {recentEvents.map((event, i) => (
              <div
                key={i}
                className="flex items-center gap-3 text-xs py-1.5 px-3 rounded bg-base-surface border border-base-border"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    event.type === "error"
                      ? "bg-accent-red"
                      : event.type === "milestone_complete"
                        ? "bg-accent-green"
                        : event.type === "rate_limit"
                          ? "bg-accent-amber"
                          : "bg-base-muted"
                  }`}
                />
                <span className="text-base-muted">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-base-text truncate">{event.message}</span>
                <span className="ml-auto text-base-muted flex-shrink-0">
                  {event.project}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default Dashboard;
