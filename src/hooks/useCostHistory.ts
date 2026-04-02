import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { fetchProjectCosts } from "../lib/costAggregator";
import type { ProjectCostSummary } from "../lib/costAggregator";
import type { DateRange } from "../lib/types";

export type { DateRange } from "../lib/types";

export interface CostDataPoint {
  date: string; // YYYY-MM-DD
  cost: number;
  project: string;
}

export interface CostStats {
  totalCost: number;
  dailyAverage: number;
  totalMessages: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  models: Record<string, number>;
  activeDays: number;
  firstDate: string;
  lastDate: string;
  projectBreakdown: { project: string; cost: number; messages: number }[];
}

interface UseCostHistoryResult {
  data: CostDataPoint[];
  stats: CostStats;
  loading: boolean;
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateRange(range: DateRange): string[] {
  const days: string[] = [];
  const now = new Date();

  switch (range.preset) {
    case "today":
      return [formatDate(now)];
    case "week": {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push(formatDate(d));
      }
      return days;
    }
    case "month": {
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push(formatDate(d));
      }
      return days;
    }
    case "all":
      return []; // empty means "use all available dates from data"
    case "custom": {
      if (!range.start || !range.end) return [formatDate(now)];
      const startDate = new Date(range.start + "T00:00:00");
      const endDate = new Date(range.end + "T00:00:00");
      const cursor = new Date(startDate);
      while (cursor <= endDate) {
        days.push(formatDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      return days.length > 0 ? days : [formatDate(now)];
    }
    default:
      return [formatDate(now)];
  }
}

function filterSummaryByRange(
  summaries: ProjectCostSummary[],
  range: DateRange
): { points: CostDataPoint[]; stats: CostStats } {
  const dateRange = getDateRange(range);
  const isAllTime = range.preset === "all";

  // Collect all daily data per project, filtered by date range
  const allPoints: CostDataPoint[] = [];
  let totalCost = 0;
  let totalMessages = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  const models: Record<string, number> = {};
  let firstDate = "";
  let lastDate = "";
  const projectCosts: Record<string, { cost: number; messages: number }> = {};
  const activeDateSet = new Set<string>();

  for (const summary of summaries) {
    for (const day of summary.daily) {
      const inRange = isAllTime || dateRange.includes(day.date);
      if (!inRange) continue;

      allPoints.push({ date: day.date, cost: day.cost, project: summary.project });
      totalCost += day.cost;
      totalMessages += day.messages;
      totalInput += day.input;
      totalOutput += day.output;
      totalCacheRead += day.cacheRead;
      totalCacheWrite += day.cacheWrite;
      activeDateSet.add(day.date);

      if (!firstDate || day.date < firstDate) firstDate = day.date;
      if (!lastDate || day.date > lastDate) lastDate = day.date;

      const pc = projectCosts[summary.project] ?? { cost: 0, messages: 0 };
      pc.cost += day.cost;
      pc.messages += day.messages;
      projectCosts[summary.project] = pc;
    }

    // Accumulate model costs (these are already totals, so only count for matching range)
    // For all-time, use the full model data; for filtered ranges, we approximate
    if (isAllTime) {
      for (const [model, cost] of Object.entries(summary.models)) {
        models[model] = (models[model] ?? 0) + cost;
      }
    }
  }

  // For non-all-time, derive model costs from the totals (we don't have per-day model breakdown)
  if (!isAllTime) {
    // Just note the models used — costs are approximate from daily sums
    for (const summary of summaries) {
      for (const model of Object.keys(summary.models)) {
        if (!(model in models)) models[model] = 0;
      }
    }
  }

  const activeDays = activeDateSet.size;
  const dailyAverage = activeDays > 0 ? totalCost / activeDays : 0;

  // Fill chart data — ensure every date/project combo exists for consistent stacking
  const projects = [...new Set(allPoints.map((p) => p.project))];
  const chartDates = isAllTime
    ? [...activeDateSet].sort()
    : dateRange;

  const pointMap = new Map<string, CostDataPoint>();
  for (const p of allPoints) {
    pointMap.set(`${p.date}:${p.project}`, p);
  }

  const filledPoints: CostDataPoint[] = [];
  for (const date of chartDates) {
    for (const project of projects) {
      const existing = pointMap.get(`${date}:${project}`);
      filledPoints.push(existing ?? { date, cost: 0, project });
    }
  }

  const projectBreakdown = Object.entries(projectCosts)
    .map(([project, { cost, messages }]) => ({ project, cost, messages }))
    .sort((a, b) => b.cost - a.cost);

  return {
    points: filledPoints,
    stats: {
      totalCost,
      dailyAverage,
      totalMessages,
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheWrite,
      models,
      activeDays,
      firstDate,
      lastDate,
      projectBreakdown,
    },
  };
}

export function useCostHistory(range: DateRange): UseCostHistoryResult {
  const workspaces = useAppStore((s) => s.workspaces);
  const connection = useAppStore((s) => s.connection);
  const [summaries, setSummaries] = useState<ProjectCostSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);

    const pairs = workspaces.flatMap((ws) =>
      ws.projects.map((proj) => ({ ws, proj }))
    );

    const results = await Promise.allSettled(
      pairs.map(({ ws, proj }) =>
        fetchProjectCosts(ws.coderName, proj.path, proj.displayName)
      )
    );

    const fetched: ProjectCostSummary[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        fetched.push(result.value);
      }
    }

    setSummaries(fetched);
    setLoading(false);
  }, [workspaces]);

  useEffect(() => {
    if (connection.status !== "connected") return;

    fetchAll();
    const interval = setInterval(fetchAll, 120_000); // refresh every 2 min
    return () => clearInterval(interval);
  }, [fetchAll, connection]);

  const { points, stats } = filterSummaryByRange(summaries, range);

  return { data: points, stats, loading };
}
