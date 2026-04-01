import { useState } from "react";
import { useAppStore } from "../stores/appStore";
import { useSSH } from "../hooks/useSSH";
import SessionCard from "./SessionCard";
import CostChart from "./CostChart";
import { useCostHistory } from "../hooks/useCostHistory";

function Dashboard() {
  const sessions = useAppStore((s) => s.sessions);
  const events = useAppStore((s) => s.events);
  const connection = useAppStore((s) => s.connection);
  const costHistory = useCostHistory();
  const { fetchGSDData } = useSSH();
  const [refreshing, setRefreshing] = useState(false);

  const sessionList = Object.values(sessions);
  const activeSessions = sessionList.filter((s) => s.isRunning);
  const totalCost = sessionList.reduce(
    (sum, s) => sum + (s.status.cost ?? 0),
    0
  );

  // Parse token strings back to numbers for summing
  const parseTokenStr = (s: string | null): number => {
    if (!s) return 0;
    const m = s.match(/([\d.]+)([MK])/);
    if (!m) return 0;
    return parseFloat(m[1]) * (m[2] === "M" ? 1e6 : 1e3);
  };

  const totalTokensRead = sessionList.reduce(
    (sum, s) => sum + parseTokenStr(s.status.tokensRead),
    0
  );
  const totalTokensWrite = sessionList.reduce(
    (sum, s) => sum + parseTokenStr(s.status.tokensWrite),
    0
  );

  const formatTokens = (n: number): string => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return n.toString();
  };

  const recentEvents = events.slice(0, 10);

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header with refresh */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-base-text">Dashboard</h2>
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
                : "text-accent-red"
            }`}
          >
            {connection.status === "connected" ? "Online" : "Offline"}
          </p>
        </div>
      </div>

      {/* Cost chart */}
      <div className="mb-6">
        <CostChart
          data={costHistory.data}
          totalCost={costHistory.totalCost}
          loading={costHistory.loading}
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
