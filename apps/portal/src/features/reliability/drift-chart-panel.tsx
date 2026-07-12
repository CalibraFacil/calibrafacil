import type { Key } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from "@/components/instrument-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

/**
 * Categorical slots (fixed order, never cycled) — the portal chart tokens are
 * validated against both card surfaces (see styles.css). Status colors are
 * reserved: out-of-tolerance points wear --chart-critical, the drift trend
 * wears --chart-warning, and neither ever identifies a series.
 */
const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

function formatTick(timeMs: number): string {
  return new Date(timeMs)
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
    .replace(" de ", " ");
}

function formatFullDate(timeMs: number): string {
  return new Date(timeMs).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Per-point as-found margin over time toward the tolerance limit (margin 0),
 * with the OLS drift regression drawn when available (ILAC-G24 Method 2).
 * Degrades honestly: fewer than 3 cycles with margins → note, no chart.
 */
export function DriftChartPanel({ assetId }: { assetId: number }) {
  const query = useDriftSeries(assetId);
  const data = query.data;

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Programa metrológico"
        title="Deriva do instrumento"
        description="Margem de conformidade 'como recebido' de cada ponto medido ao longo do tempo — margem 0 é o limite de tolerância."
      />
      <div className="mt-4 space-y-3">
        {query.isPending ? (
          <Skeleton className="h-56 w-full rounded-xl" />
        ) : query.isError || !data ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm text-pretty">
              Não foi possível carregar a análise de deriva.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              className={ACTION_BUTTON_CLASS}
            >
              Tentar novamente
            </Button>
          </div>
        ) : data.coverage.cyclesWithMargins < 3 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            Sem histórico “como recebido” suficiente para análise de deriva (
            {data.coverage.cyclesWithMargins} de {data.coverage.totalCycles}{" "}
            calibrações com sinal).
          </p>
        ) : (
          <DriftChart data={data} />
        )}
        {data ? (
          <p className="text-muted-foreground text-xs text-pretty">
            {data.attribution}
          </p>
        ) : null}
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

/** Surface-ringed dot; out-of-tolerance points wear the reserved critical step. */
function seriesDot(seriesColor: string) {
  return function DriftDot(props: {
    key?: Key | null;
    cx?: number;
    cy?: number;
    value?: number;
  }) {
    const { key, cx, cy, value } = props;
    if (cx === undefined || cy === undefined || value === undefined) {
      return <g key={key} />;
    }
    const outOfTolerance = value < 0;
    return (
      <circle
        key={key}
        cx={cx}
        cy={cy}
        r={outOfTolerance ? 4.5 : 3.5}
        fill={outOfTolerance ? "var(--chart-critical)" : seriesColor}
        stroke="var(--card)"
        strokeWidth={2}
      />
    );
  };
}

function DriftChart({ data }: { data: AssetDriftSeries }) {
  const firstCycleMs = data.cycles[0]
    ? new Date(data.cycles[0].approvedAt).getTime()
    : 0;

  const plotted: Array<PlottedSeries> = data.points
    .filter((entry) => entry.series.length >= 2)
    .slice(0, MAX_SERIES)
    .map((entry, slot) => ({
      entry,
      color: SERIES_COLORS[slot % SERIES_COLORS.length] ?? "var(--chart-1)",
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

  // One tick per calibration cycle, thinned to at most 6 so labels never collide.
  const allTimes = chartData.flatMap((row) =>
    row.timeMs === undefined ? [] : [row.timeMs],
  );
  const tickStep = Math.max(1, Math.ceil(allTimes.length / 6));
  const ticks = allTimes.filter(
    (_, index) => index % tickStep === 0 || index === allTimes.length - 1,
  );

  const values = plotted.flatMap((series) =>
    series.points.map((point) => point.margin),
  );
  const hasBelowZero = values.some((value) => value < 0);

  const chartConfig: ChartConfig = Object.fromEntries(
    plotted.map((series) => [
      series.dataKey,
      {
        label: `Ponto ${series.entry.pointIndex + 1}`,
        color: series.color,
      },
    ]),
  );

  const singleSeries = plotted.length === 1 ? plotted[0] : undefined;
  const driftingSeries = plotted.filter((series) => series.entry.drifting);

  return (
    <div className="space-y-2">
      <ChartContainer config={chartConfig} className="h-56 w-full">
        <ComposedChart
          data={chartData}
          margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
        >
          {singleSeries ? (
            <defs>
              <linearGradient id="driftFill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={singleSeries.color}
                  stopOpacity={0.22}
                />
                <stop
                  offset="100%"
                  stopColor={singleSeries.color}
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
          ) : null}

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
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value: number) => formatTick(value)}
            className="font-mono text-[10px] tabular-nums text-muted-foreground"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={44}
            domain={[
              (dataMin: number) => Math.min(dataMin * 1.15, -0.02),
              (dataMax: number) => Math.max(dataMax * 1.1, 0.02),
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
                    ? formatFullDate(timeMs)
                    : "";
                }}
                formatter={(value, name, item) => {
                  const numeric = Number(value);
                  const label =
                    chartConfig[String(name)]?.label ?? String(name);
                  return (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block size-2 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: String(item?.color ?? "") }}
                      />
                      {label}:{" "}
                      <span className="font-mono tabular-nums">
                        {numeric.toLocaleString("pt-BR", {
                          maximumFractionDigits: 3,
                        })}
                      </span>
                      {numeric < 0 ? (
                        <span className="text-[var(--chart-critical)]">
                          fora de tolerância
                        </span>
                      ) : null}
                    </span>
                  );
                }}
              />
            }
          />

          {/* Out-of-tolerance zone (below margin 0) */}
          {hasBelowZero ? (
            <ReferenceArea
              y2={0}
              fill="var(--chart-critical)"
              fillOpacity={0.06}
              label={{
                value: "Fora de tolerância",
                position: "insideBottomRight",
                fill: "var(--chart-critical)",
                fontSize: 10,
                opacity: 0.9,
              }}
            />
          ) : null}

          {/* Tolerance limit — margin 0 */}
          <ReferenceLine
            y={0}
            stroke="var(--chart-critical)"
            strokeOpacity={0.55}
            strokeDasharray="5 4"
            label={{
              value: "Limite de tolerância",
              position: "insideTopLeft",
              className: "fill-muted-foreground",
              fontSize: 10,
            }}
          />

          {/* OLS drift trend (ILAC-G24 Method 2) — status color when significant */}
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
                stroke={
                  series.entry.drifting
                    ? "var(--chart-warning)"
                    : "var(--muted-foreground)"
                }
                strokeDasharray="6 4"
                strokeOpacity={series.entry.drifting ? 0.9 : 0.4}
                strokeWidth={1.5}
              />
            );
          })}

          {singleSeries ? (
            <Area
              dataKey={singleSeries.dataKey}
              type="linear"
              stroke="none"
              fill="url(#driftFill)"
              isAnimationActive={false}
              activeDot={false}
              tooltipType="none"
            />
          ) : null}

          {plotted.map((series) => (
            <Line
              key={series.dataKey}
              dataKey={series.dataKey}
              type="linear"
              stroke={series.color}
              strokeWidth={2}
              dot={seriesDot(series.color)}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ChartContainer>

      {/* Legend — identity never rides on color alone; single series is named
          by the panel title, so it carries only the drift status pill. */}
      {plotted.length > 1 ? (
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
      ) : driftingSeries.length > 0 ? (
        <div>
          <StatusPill tone="warning" size="sm" dot={false}>
            deriva
          </StatusPill>
        </div>
      ) : null}

      {driftingSeries.length > 0 ? (
        <p className="text-pretty text-xs text-amber-700 dark:text-amber-400">
          Tendência estatisticamente significativa em direção ao limite de
          tolerância — considere encurtar a periodicidade.
        </p>
      ) : null}
    </div>
  );
}
