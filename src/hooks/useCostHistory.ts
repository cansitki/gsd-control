import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";

export interface CostDataPoint {
  date: string; // YYYY-MM-DD
  cost: number;
  project: string;
}

interface MetricsUnit {
  type: string;
  id: string;
  model: string;
  startedAt: number;
  finishedAt: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  cacheHitRate: number;
}

interface MetricsJson {
  units: MetricsUnit[];
}

interface UseCostHistoryResult {
  data: CostDataPoint[];
  totalCost: number;
  loading: boolean;
}

function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLast14Days(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(formatDate(d.getTime()));
  }
  return days;
}

export function useCostHistory(): UseCostHistoryResult {
  const workspaces = useAppStore((s) => s.workspaces);
  const [data, setData] = useState<CostDataPoint[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    const allPoints: CostDataPoint[] = [];
    const last14 = getLast14Days();
    const cutoffDate = last14[0];

    for (const ws of workspaces) {
      for (const proj of ws.projects) {
        try {
          const raw = await invoke<string>("exec_in_workspace", {
            workspace: ws.coderName,
            command: `cat /home/coder/${proj.path}/.gsd/metrics.json 2>/dev/null || echo '{\"units\":[]}'`,
          });

          let metrics: MetricsJson;
          try {
            metrics = JSON.parse(raw);
          } catch {
            continue;
          }

          if (!metrics.units || !Array.isArray(metrics.units)) continue;

          const dailyBuckets: Record<string, number> = {};

          for (const unit of metrics.units) {
            if (typeof unit.cost !== "number" || typeof unit.startedAt !== "number") continue;
            const date = formatDate(unit.startedAt);
            if (date < cutoffDate) continue;
            dailyBuckets[date] = (dailyBuckets[date] ?? 0) + unit.cost;
          }

          for (const date of last14) {
            const cost = dailyBuckets[date] ?? 0;
            if (cost > 0) {
              allPoints.push({
                date,
                cost,
                project: proj.displayName,
              });
            }
          }
        } catch {
          // Workspace unreachable or command failed — skip
        }
      }
    }

    // Ensure every date/project combo exists for consistent stacking
    const projects = [...new Set(allPoints.map((p) => p.project))];
    const filledPoints: CostDataPoint[] = [];
    for (const date of last14) {
      for (const project of projects) {
        const existing = allPoints.find(
          (p) => p.date === date && p.project === project
        );
        filledPoints.push(existing ?? { date, cost: 0, project });
      }
    }

    const total = filledPoints.reduce((sum, p) => sum + p.cost, 0);
    setData(filledPoints);
    setTotalCost(total);
    setLoading(false);
  }, [workspaces]);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60_000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  return { data, totalCost, loading };
}
