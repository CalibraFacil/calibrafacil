import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { formatDate } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useDriftSeries } from "./queries";
import type { AssetDriftSeries, DriftPointSeries } from "./types";

/** Must match the API's regression time unit (portal-fleet-reliability.ts). */
const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4375;

/** How many matched-point series the chart shows at most. */
const MAX_SERIES = 3;

const SERIES_COLORS = [
  "var(--foreground)",
  "var(--primary)",
  "var(--muted-foreground)",
];
const DRIFTING_COLOR = "var(--critical)";

/**
 * Per-point as-found margin over time toward the tolerance limit (margin 0),
 * with the OLS drift regression drawn when available (ILAC-G24 Method 2).
 * Degrades honestly: fewer than 3 cycles with margins → note, no chart.
 */
export function DriftChartPanel({ assetId }: { assetId: number }) {
  const query = useDriftSeries(assetId);
  const data = query.data;
  if (!data) return null;

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Programa metrológico"
        title="Deriva do instrumento"
        description="Margem de conformidade 'como recebido' de cada ponto medido ao longo do tempo — margem 0 é o limite de tolerância."
      />
      <div className="mt-4 space-y-3">
        {data.coverage.cyclesWithMargins < 3 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            Sem histórico as-found suficiente para análise de deriva (
            {data.coverage.cyclesWithMargins} de {data.coverage.totalCycles}{" "}
            calibrações com sinal).
          </p>
        ) : (
          <DriftChart data={data} />
        )}
        <p className="text-muted-foreground text-xs text-pretty">
          {data.attribution}
        </p>
      </div>
    </Panel>
  );
}

type PlottedSeries = {
  entry: DriftPointSeries;
  color: string;
  dataKey: string;
  points: Array<{ timeMs: number; margin: number }>;
};

function DriftChart({ data }: { data: AssetDriftSeries }) {
  const firstCycleMs = data.cycles[0]
    ? new Date(data.cycles[0].approvedAt).getTime()
    : 0;

  const plotted: Array<PlottedSeries> = data.points
    .filter((entry) => entry.series.length >= 2)
    .slice(0, MAX_SERIES)
    .map((entry, colorIndex) => ({
      entry,
      color: entry.drifting
        ? DRIFTING_COLOR
        : (SERIES_COLORS[colorIndex % SERIES_COLORS.length] ??
          "var(--foreground)"),
      dataKey: `ponto${entry.pointIndex + 1}`,
      points: entry.series.map((point) => ({
        timeMs: new Date(point.approvedAt).getTime(),
        margin: point.margin,
      })),
    }));

  if (plotted.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        Pontos medidos sem repetição suficiente entre ciclos para traçar a
        deriva.
      </p>
    );
  }

  /** Regression y at a wall-clock time, in the API's months-since-first-cycle axis. */
  const fittedAt = (entry: DriftPointSeries, timeMs: number): number | null => {
    if (!entry.regression) return null;
    const t = (timeMs - firstCycleMs) / MS_PER_MONTH;
    return entry.regression.intercept + entry.regression.slope * t;
  };

  // Merge every series into one row set keyed by time, so recharts renders
  // shared axes/tooltips: { timeMs, ponto1?, ponto2?, ponto3? }.
  const rowByTime = new Map<number, Record<string, number>>();
  for (const series of plotted) {
    for (const point of series.points) {
      const rowValues = rowByTime.get(point.timeMs) ?? { timeMs: point.timeMs };
      rowValues[series.dataKey] = point.margin;
      rowByTime.set(point.timeMs, rowValues);
    }
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- the spread above is already a fresh array; the portal's TS lib target predates toSorted.
  const chartData = [...rowByTime.values()].sort(
    (a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0),
  );

  const chartConfig: ChartConfig = Object.fromEntries(
    plotted.map((series) => [
      series.dataKey,
      {
        label: `Ponto ${series.entry.pointIndex + 1}`,
        color: series.color,
      },
    ]),
  );

  const hasDrifting = plotted.some((series) => series.entry.drifting);

  return (
    <div className="space-y-2">
      <ChartContainer config={chartConfig} className="h-52 w-full">
        <LineChart
          data={chartData}
          margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            className="stroke-muted"
          />
          <XAxis
            dataKey="timeMs"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value: number) => formatDate(new Date(value))}
            className="font-mono text-[10px] tabular-nums text-muted-foreground"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={44}
            domain={[
              (dataMin: number) => Math.min(dataMin, 0),
              (dataMax: number) => Math.max(dataMax, 0),
            ]}
            tickFormatter={(value: number) =>
              value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
            }
            className="text-xs text-muted-foreground"
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_label, payload) => {
                  const timeMs = payload?.[0]?.payload?.timeMs;
                  return typeof timeMs === "number"
                    ? formatDate(new Date(timeMs))
                    : "";
                }}
              />
            }
          />

          {/* Tolerance limit — margin 0 */}
          <ReferenceLine
            y={0}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 3"
            label={{
              value: "Limite de tolerância",
              position: "insideTopLeft",
              className: "fill-muted-foreground",
              fontSize: 10,
            }}
          />

          {/* OLS regression segments (ILAC-G24 Method 2) */}
          {plotted.map((series) => {
            const first = series.points[0];
            const last = series.points[series.points.length - 1];
            const fittedFirst = first
              ? fittedAt(series.entry, first.timeMs)
              : null;
            const fittedLast = last
              ? fittedAt(series.entry, last.timeMs)
              : null;
            if (
              !first ||
              !last ||
              fittedFirst === null ||
              fittedLast === null
            ) {
              return null;
            }
            return (
              <ReferenceLine
                key={`reg-${series.entry.pointIndex}`}
                segment={[
                  { x: first.timeMs, y: fittedFirst },
                  { x: last.timeMs, y: fittedLast },
                ]}
                stroke={series.color}
                strokeDasharray="6 4"
                strokeOpacity={0.45}
              />
            );
          })}

          {plotted.map((series) => (
            <Line
              key={series.dataKey}
              dataKey={series.dataKey}
              type="linear"
              stroke={series.color}
              strokeWidth={1.5}
              dot={{ r: 2.5, fill: series.color, strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {plotted.map((series) => (
          <span
            key={series.entry.pointIndex}
            className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
          >
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: series.color }}
              aria-hidden
            />
            Ponto {series.entry.pointIndex + 1}
            {series.entry.drifting ? (
              <StatusPill tone="warning" size="sm" dot={false}>
                deriva
              </StatusPill>
            ) : null}
          </span>
        ))}
      </div>
      {hasDrifting ? (
        <p className="text-pretty text-xs text-amber-700 dark:text-amber-400">
          Tendência estatisticamente significativa em direção ao limite de
          tolerância — considere encurtar a periodicidade.
        </p>
      ) : null}
    </div>
  );
}
