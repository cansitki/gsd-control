import { useAppStore } from "../stores/appStore";

function StatusBar() {
  const connection = useAppStore((s) => s.connection);
  const sessions = useAppStore((s) => s.sessions);

  const activeSessions = Object.values(sessions).filter((s) => s.isRunning);
  const totalCost = Object.values(sessions).reduce(
    (sum, s) => sum + (s.status.cost ?? 0),
    0
  );

  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-t border-base-border bg-base-surface text-xs">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connection.status === "connected"
                ? "bg-accent-green"
                : connection.status === "connecting" || connection.status === "reconnecting"
                  ? "bg-accent-amber animate-pulse"
                  : "bg-accent-red"
            }`}
          />
          <span className="text-base-muted">
            {connection.status === "connected"
              ? connection.host.split(".")[0]
              : connection.status === "reconnecting"
                ? "Reconnecting..."
                : connection.status}
          </span>
        </div>
        {connection.error && (
          <span className="text-accent-red">{connection.error}</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-base-muted">
          {activeSessions.length} active
        </span>
        {totalCost > 0 && (
          <span className="text-accent-amber">${totalCost.toFixed(2)}</span>
        )}
      </div>
    </div>
  );
}

export default StatusBar;
