import { useState, useMemo } from "react";
import type { CostDataPoint } from "../hooks/useCostHistory";
import type { CostStats } from "../hooks/useCostHistory";

interface CostChartProps {
  data: CostDataPoint[];
  stats: CostStats;
  loading: boolean;
  rangeLabel?: string;
}

const PROJECT_COLORS = [
  "#fbbf24", // accent-amber
  "#f97316", // accent-orange
  "#34d399", // accent-green
  "#60a5fa", // blue
  "#a78bfa", // purple
  "#f472b6", // pink
];

function getColor(index: number): string {
  return PROJECT_COLORS[index % PROJECT_COLORS.length];
}

function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

interface TooltipData {
  x: number;
  y: number;
  date: string;
  entries: { project: string; cost: number; color: string }[];
  total: number;
}

function CostChart({ data, stats, loading, rangeLabel = "Cost History" }: CostChartProps) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const { dates, projects, dailyStacks, maxDayTotal } = useMemo(() => {
    const dateSet = [...new Set(data.map((d) => d.date))].sort();
    const projectSet = [...new Set(data.map((d) => d.project))];

    const stacks: Record<string, { project: string; cost: number }[]> = {};
    let maxTotal = 0;

    for (const date of dateSet) {
      const entries = projectSet.map((project) => {
        const point = data.find(
          (d) => d.date === date && d.project === project
        );
        return { project, cost: point?.cost ?? 0 };
      });
      stacks[date] = entries;
      const dayTotal = entries.reduce((s, e) => s + e.cost, 0);
      if (dayTotal > maxTotal) maxTotal = dayTotal;
    }

    return {
      dates: dateSet,
      projects: projectSet,
      dailyStacks: stacks,
      maxDayTotal: maxTotal,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="bg-base-surface border border-base-border rounded-lg p-4">
        <p className="text-xs text-base-muted uppercase tracking-wider mb-3">
          {rangeLabel}
        </p>
        <div className="flex items-center justify-center h-40">
          <p className="text-base-muted text-xs animate-pulse">
            Loading cost data...
          </p>
        </div>
      </div>
    );
  }

  if (dates.length === 0 && stats.totalCost === 0) {
    return (
      <div className="bg-base-surface border border-base-border rounded-lg p-4">
        <p className="text-xs text-base-muted uppercase tracking-wider mb-3">
          {rangeLabel}
        </p>
        <div className="flex items-center justify-center h-40">
          <p className="text-base-muted text-xs">No cost data available</p>
        </div>
      </div>
    );
  }

  // Chart dimensions
  const chartWidth = 560;
  const chartHeight = 160;
  const paddingLeft = 40;
  const paddingRight = 12;
  const paddingTop = 8;
  const paddingBottom = 24;
  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingTop - paddingBottom;

  const barCount = dates.length;
  const barGap = Math.max(1, Math.min(4, Math.floor(plotWidth / barCount / 4)));
  const barWidth = Math.max(
    2,
    (plotWidth - barGap * (barCount - 1)) / barCount
  );

  const yMax = maxDayTotal > 0 ? maxDayTotal * 1.15 : 1;
  const yTicks = 4;

  function yToPixel(val: number): number {
    return paddingTop + plotHeight - (val / yMax) * plotHeight;
  }

  function formatShortDate(dateStr: string): string {
    const parts = dateStr.split("-");
    return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
  }

  // Determine how often to show x-axis labels based on bar count
  const labelInterval = barCount <= 14 ? 1 : barCount <= 30 ? 2 : Math.ceil(barCount / 15);

  function handleBarHover(
    e: React.MouseEvent<SVGRectElement>,
    date: string,
    entries: { project: string; cost: number }[]
  ) {
    const svgEl = e.currentTarget.closest("svg");
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const total = entries.reduce((s, en) => s + en.cost, 0);
    setTooltip({
      x,
      y,
      date,
      entries: entries
        .filter((en) => en.cost > 0)
        .map((en) => ({
          ...en,
          color: getColor(projects.indexOf(en.project)),
        })),
      total,
    });
  }

  return (
    <div className="bg-base-surface border border-base-border rounded-lg p-4">
      {/* Header with total */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-base-muted uppercase tracking-wider">
          {rangeLabel}
        </p>
        <p className="text-sm font-bold text-accent-amber">
          ${stats.totalCost.toFixed(2)}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatBox label="Daily Avg" value={`$${stats.dailyAverage.toFixed(2)}`} />
        <StatBox label="Messages" value={formatTokens(stats.totalMessages)} />
        <StatBox label="Output Tokens" value={formatTokens(stats.totalOutput)} />
        <StatBox label="Cache Read" value={formatTokens(stats.totalCacheRead)} />
      </div>

      {/* Project breakdown — compact */}
      {stats.projectBreakdown.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3">
          {stats.projectBreakdown.map((pb, i) => (
            <div key={pb.project} className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-sm flex-shrink-0"
                style={{ backgroundColor: getColor(projects.indexOf(pb.project) >= 0 ? projects.indexOf(pb.project) : i) }}
              />
              <span className="text-xs text-base-muted">
                {pb.project}{" "}
                <span className="text-base-text font-medium">${pb.cost.toFixed(2)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {dates.length > 0 && (
        <div
          className="relative"
          onMouseLeave={() => setTooltip(null)}
        >
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            className="w-full"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          >
            {/* Y-axis grid lines and labels */}
            {Array.from({ length: yTicks + 1 }).map((_, i) => {
              const val = (yMax / yTicks) * i;
              const y = yToPixel(val);
              return (
                <g key={i}>
                  <line
                    x1={paddingLeft}
                    y1={y}
                    x2={chartWidth - paddingRight}
                    y2={y}
                    stroke="#1e2433"
                    strokeWidth={1}
                  />
                  <text
                    x={paddingLeft - 6}
                    y={y + 3}
                    textAnchor="end"
                    fill="#6b7280"
                    fontSize={8}
                  >
                    ${val.toFixed(val >= 10 ? 0 : 1)}
                  </text>
                </g>
              );
            })}

            {/* Daily average line */}
            {stats.dailyAverage > 0 && stats.dailyAverage < yMax && (
              <line
                x1={paddingLeft}
                y1={yToPixel(stats.dailyAverage)}
                x2={chartWidth - paddingRight}
                y2={yToPixel(stats.dailyAverage)}
                stroke="#f97316"
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.5}
              />
            )}

            {/* Bars */}
            {dates.map((date, di) => {
              const x = paddingLeft + di * (barWidth + barGap);
              const entries = dailyStacks[date] ?? [];
              let yOffset = 0;

              return (
                <g key={date}>
                  {entries.map((entry, ei) => {
                    if (entry.cost <= 0) return null;
                    const barH = (entry.cost / yMax) * plotHeight;
                    const barY =
                      paddingTop + plotHeight - yOffset - barH;
                    yOffset += barH;
                    return (
                      <rect
                        key={ei}
                        x={x}
                        y={barY}
                        width={barWidth}
                        height={barH}
                        fill={getColor(projects.indexOf(entry.project))}
                        rx={barWidth > 4 ? 2 : 1}
                        opacity={0.85}
                      />
                    );
                  })}

                  <rect
                    x={x}
                    y={paddingTop}
                    width={barWidth}
                    height={plotHeight}
                    fill="transparent"
                    onMouseEnter={(e) => handleBarHover(e, date, entries)}
                    onMouseMove={(e) => handleBarHover(e, date, entries)}
                    style={{ cursor: "pointer" }}
                  />

                  {di % labelInterval === 0 && (
                    <text
                      x={x + barWidth / 2}
                      y={chartHeight - 4}
                      textAnchor="middle"
                      fill="#6b7280"
                      fontSize={7}
                    >
                      {formatShortDate(date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Tooltip */}
          {tooltip && tooltip.total > 0 && (
            <div
              className="absolute z-50 pointer-events-none bg-[#1a1f2e] border border-base-border rounded-md px-3 py-2 shadow-lg"
              style={{
                left: Math.min(tooltip.x + 12, chartWidth - 160),
                top: Math.max(tooltip.y - 60, 0),
              }}
            >
              <p className="text-xs text-base-muted mb-1">{tooltip.date}</p>
              {tooltip.entries.map((en, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-1.5 h-1.5 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: en.color }}
                  />
                  <span className="text-base-muted">{en.project}</span>
                  <span className="text-base-text ml-auto font-medium">
                    ${en.cost.toFixed(2)}
                  </span>
                </div>
              ))}
              <div className="border-t border-base-border mt-1 pt-1 text-xs text-accent-amber font-medium">
                Total: ${tooltip.total.toFixed(2)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-base-bg border border-base-border rounded px-2.5 py-1.5">
      <p className="text-[10px] text-base-muted uppercase tracking-wider">{label}</p>
      <p className="text-xs font-semibold text-base-text">{value}</p>
    </div>
  );
}

export default CostChart;
