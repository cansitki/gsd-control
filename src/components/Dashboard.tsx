import { useState, useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { useSSH } from "../hooks/useSSH";
import SessionCard, { getCardUrgency } from "./SessionCard";
import CostChart from "./CostChart";
import { useCostHistory } from "../hooks/useCostHistory";
import type { DateRange } from "../lib/types";

type DatePreset = DateRange["preset"];

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 Days" },
  { key: "month", label: "30 Days" },
  { key: "all", label: "All Time" },
  { key: "custom", label: "Custom" },
];

function formatRangeLabel(range: DateRange): string {
  switch (range.preset) {
    case "today": return "Today";
    case "week": return "Last 7 Days";
    case "month": return "Last 30 Days";
    case "all": return "All Time";
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
    default: return "Cost History";
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

  const sessionList = useMemo(() => Object.values(sessions), [sessions]);

  // Split into active (running / needs attention) and inactive
  const { activeSessions, inactiveSessions } = useMemo(() => {
    const active: typeof sessionList = [];
    const inactive: typeof sessionList = [];
    for (const s of sessionList) {
      const urgency = getCardUrgency(s);
      if (urgency === "error" || urgency === "warning" || urgency === "active") {
        active.push(s);
      } else {
        inactive.push(s);
      }
    }
    // Sort active: errors first, then warnings, then active
    const urgencyOrder = { error: 0, warning: 1, active: 2, complete: 3, idle: 4 };
    active.sort((a, b) => urgencyOrder[getCardUrgency(a)] - urgencyOrder[getCardUrgency(b)]);
    return { activeSessions: active, inactiveSessions: inactive };
  }, [sessionList]);

  const formatTokens = (n: number): string => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return n.toString();
  };

  const healthSummary = useMemo(() => {
    const total = workspaces.length;
    const healthyCount = Object.values(workspaceHealth).filter((s) => s === "ok").length;
    return { healthy: healthyCount, total };
  }, [workspaceHealth, workspaces]);

  const rangeLabel = formatRangeLabel(dateRange);

  const errorsOrWarnings = activeSessions.filter(
    (s) => getCardUrgency(s) === "error" || getCardUrgency(s) === "warning"
  ).length;

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-base-text">Dashboard</h2>
          {errorsOrWarnings > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-red/15 text-accent-red border border-accent-red/30 font-medium animate-pulse">
              {errorsOrWarnings} need{errorsOrWarnings === 1 ? "s" : ""} attention
            </span>
          )}
        </div>
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

      {/* Summary cards — Row 1: Cost metrics + Sessions */}
      <div className="grid grid-cols-4 gap-4 mb-3">
        <div className="bg-base-surface border border-base-border rounded-lg p-4">
          <p className="text-xs text-base-muted uppercase tracking-wider">Total Cost</p>
          <p className="text-2xl font-bold text-accent-amber mt-1">${costHistory.stats.allTimeCost.toFixed(2)}</p>
        </div>
        <div className="bg-base-surface border border-base-border rounded-lg p-4">
          <p className="text-xs text-base-muted uppercase tracking-wider">Today's Cost</p>
          <p className="text-2xl font-bold text-accent-orange mt-1">${costHistory.stats.todayCost.toFixed(2)}</p>
        </div>
        <div className="bg-base-surface border border-base-border rounded-lg p-4">
          <p className="text-xs text-base-muted uppercase tracking-wider">Cost / Hour</p>
          <p className="text-2xl font-bold text-accent-blue mt-1">${costHistory.stats.costPerHour.toFixed(2)}</p>
        </div>
        <div className="bg-base-surface border border-base-border rounded-lg p-4">
          <p className="text-xs text-base-muted uppercase tracking-wider">Sessions</p>
          <p className="text-2xl font-bold text-accent-purple mt-1">{costHistory.stats.sessionCount}</p>
          <div className="flex gap-3 mt-1 text-xs text-base-muted">
            <span>⚡ {costHistory.stats.autoModeCount} auto</span>
            <span>💬 {costHistory.stats.interactiveCount} interactive</span>
          </div>
        </div>
      </div>

      {/* Summary cards — Row 2: Active count + Connection */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-base-surface border border-base-border rounded-lg p-4">
          <p className="text-xs text-base-muted uppercase tracking-wider">Active</p>
          <p className="text-2xl font-bold text-accent-green mt-1">{activeSessions.length}</p>
        </div>
        <div className="bg-base-surface border border-base-border rounded-lg p-4">
          <p className="text-xs text-base-muted uppercase tracking-wider">Connection</p>
          <p className={`text-2xl font-bold mt-1 ${
            connection.status === "connected" ? "text-accent-green" :
            connection.status === "reconnecting" ? "text-accent-amber animate-pulse" :
            "text-accent-red"
          }`}>
            {connection.status === "connected" ? "Online" :
             connection.status === "reconnecting" ? "Reconnecting..." : "Offline"}
          </p>
          {healthSummary.total > 0 && (
            <p className="text-xs text-base-muted mt-1">{healthSummary.healthy}/{healthSummary.total} ws healthy</p>
          )}
        </div>
        <div className="bg-base-surface border border-base-border rounded-lg p-4">
          <p className="text-xs text-base-muted uppercase tracking-wider">Tokens</p>
          <p className="text-2xl font-bold text-accent-blue mt-1">{formatTokens(costHistory.stats.totalInput + costHistory.stats.totalOutput)}</p>
          <div className="flex gap-3 mt-1 text-xs text-base-muted">
            <span>↓ {formatTokens(costHistory.stats.totalInput)}</span>
            <span>↑ {formatTokens(costHistory.stats.totalOutput)}</span>
          </div>
        </div>
        <div className="bg-base-surface border border-base-border rounded-lg p-4 opacity-0 pointer-events-none" aria-hidden="true" />
      </div>

      {/* Active projects — always visible */}
      {activeSessions.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-semibold text-accent-green uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
            Active Projects
          </h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {activeSessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        </div>
      )}

      {/* Cost chart */}
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
        {dateRange.preset === "custom" && (
          <div className="flex items-center gap-2 mb-3">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              className="text-xs px-2 py-1.5 rounded border border-base-border bg-base-bg text-base-text" />
            <span className="text-xs text-base-muted">–</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              className="text-xs px-2 py-1.5 rounded border border-base-border bg-base-bg text-base-text" />
            <button onClick={handleCustomApply} disabled={!customStart || !customEnd}
              className="text-xs px-3 py-1.5 rounded border border-accent-orange/30 text-accent-orange hover:bg-accent-orange/10 transition-colors disabled:opacity-50">
              Apply
            </button>
          </div>
        )}
        <CostChart data={costHistory.data} stats={costHistory.stats} loading={costHistory.loading} rangeLabel={rangeLabel} />
      </div>

      {/* Inactive / completed projects */}
      {inactiveSessions.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-semibold text-base-muted uppercase tracking-wider mb-3">
            Other Projects
          </h2>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            {inactiveSessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        </div>
      )}

      {/* No sessions */}
      {sessionList.length === 0 && (
        <div className="text-center py-12">
          <p className="text-base-muted text-sm">No sessions discovered yet</p>
          <p className="text-base-muted/60 text-xs mt-1">
            {connection.status === "connected"
              ? "Scanning workspaces..."
              : "Connect to your Coder instance to get started"}
          </p>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
