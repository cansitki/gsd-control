import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { fetchProjectCosts } from "../lib/costAggregator";
import type { ProjectCostSummary, MilestoneBreakdown } from "../lib/costAggregator";
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
  totalTokens: number;
  models: Record<string, number>;
  activeDays: number;
  firstDate: string;
  lastDate: string;
  projectBreakdown: { project: string; cost: number; messages: number }[];
  // New fields from session scanner
  sessionCount: number;
  autoModeCount: number;
  interactiveCount: number;
  milestones: MilestoneBreakdown[];
  todayCost: number;
  costPerHour: number;
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
  range: DateRange,
): { points: CostDataPoint[]; stats: CostStats } {
  const dateRange = getDateRange(range);
  const isAllTime = range.preset === "all";
  const todayStr = formatDate(new Date());

  // Collect all daily data per project, filtered by date range
  const allPoints: CostDataPoint[] = [];
  let totalCost = 0;
  let totalMessages = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalTokens = 0;
  const models: Record<string, number> = {};
  let firstDate = "";
  let lastDate = "";
  const projectCosts: Record<string, { cost: number; messages: number }> = {};
  const activeDateSet = new Set<string>();

  // Aggregate session/auto/interactive counts and milestones
  let sessionCount = 0;
  let autoModeCount = 0;
  let interactiveCount = 0;
  const allMilestones: MilestoneBreakdown[] = [];
  let todayCost = 0;

  for (const summary of summaries) {
    sessionCount += summary.sessionCount;
    autoModeCount += summary.autoModeCount;
    interactiveCount += summary.interactiveCount;
    allMilestones.push(...summary.milestones);

    for (const day of summary.daily) {
      const inRange = isAllTime || dateRange.includes(day.date);

      // Always compute today's cost regardless of range
      if (day.date === todayStr) {
        todayCost += day.cost;
      }

      if (!inRange) continue;

      allPoints.push({
        date: day.date,
        cost: day.cost,
        project: summary.project,
      });
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

    // totalTokens from summary (all-time value)
    totalTokens += summary.totalTokens;

    // Accumulate model costs (all-time for all range, approximate for filtered)
    if (isAllTime) {
      for (const [model, cost] of Object.entries(summary.models)) {
        models[model] = (models[model] ?? 0) + cost;
      }
    }
  }

  // For non-all-time, derive model costs from the totals
  if (!isAllTime) {
    for (const summary of summaries) {
      for (const model of Object.keys(summary.models)) {
        if (!(model in models)) models[model] = 0;
      }
    }
  }

  const activeDays = activeDateSet.size;
  const dailyAverage = activeDays > 0 ? totalCost / activeDays : 0;

  // Cost per hour: today's cost / hours elapsed today
  const now = new Date();
  const hoursToday = now.getHours() + now.getMinutes() / 60;
  const costPerHour = hoursToday > 0 ? todayCost / hoursToday : 0;

  // Fill chart data — ensure every date/project combo exists
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

  // Deduplicate milestones across projects (shouldn't overlap, but be safe)
  const milestoneMap = new Map<string, MilestoneBreakdown>();
  for (const m of allMilestones) {
    const existing = milestoneMap.get(m.milestone);
    if (existing) {
      existing.cost += m.cost;
      existing.tokens += m.tokens;
      existing.output += m.output;
      existing.units += m.units;
      existing.durationMs += m.durationMs;
    } else {
      milestoneMap.set(m.milestone, { ...m });
    }
  }

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
      totalTokens,
      models,
      activeDays,
      firstDate,
      lastDate,
      projectBreakdown,
      sessionCount,
      autoModeCount,
      interactiveCount,
      milestones: [...milestoneMap.values()].sort((a, b) =>
        a.milestone.localeCompare(b.milestone),
      ),
      todayCost,
      costPerHour,
    },
  };
}

export function useCostHistory(range: DateRange): UseCostHistoryResult {
  const connection = useAppStore((s) => s.connection);
  const [summaries, setSummaries] = useState<ProjectCostSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);

    // Read fresh workspaces from store to avoid stale closure (K013)
    const workspaces = useAppStore.getState().workspaces;

    const pairs = workspaces.flatMap((ws) =>
      ws.projects.map((proj) => ({ ws, proj })),
    );

    const results = await Promise.allSettled(
      pairs.map(({ ws, proj }) =>
        fetchProjectCosts(ws.coderName, proj.path, proj.displayName),
      ),
    );

    const fetched: ProjectCostSummary[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        fetched.push(result.value);
      }
    }

    setSummaries(fetched);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (connection.status !== "connected") return;

    fetchAll();
    const interval = setInterval(fetchAll, 120_000); // refresh every 2 min
    return () => clearInterval(interval);
  }, [fetchAll, connection]);

  const { points, stats } = filterSummaryByRange(summaries, range);

  return { data: points, stats, loading };
}
