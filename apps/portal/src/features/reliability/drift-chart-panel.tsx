import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import { useDriftSeries } from "./queries";
import type { AssetDriftSeries, DriftPointSeries } from "./types";

/** Must match the API's regression time unit (portal-fleet-reliability.ts). */
const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4375;

/** How many matched-point series the chart shows at most. */
const MAX_SERIES = 3;

const SERIES_STROKE = [
  "stroke-foreground/70",
  "stroke-primary/70",
  "stroke-muted-foreground/70",
];
const SERIES_FILL = [
  "fill-foreground/70",
  "fill-primary/70",
  "fill-muted-foreground/70",
];
const DRIFTING_STROKE = "stroke-[var(--critical)]";
const DRIFTING_FILL = "fill-[var(--critical)]";

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
  colorIndex: number;
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
      colorIndex,
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

  const allTimes = plotted.flatMap((s) => s.points.map((p) => p.timeMs));
  const allValues = plotted.flatMap((s) => {
    const margins = s.points.map((p) => p.margin);
    const first = s.points[0];
    const last = s.points[s.points.length - 1];
    const fittedFirst = first ? fittedAt(s.entry, first.timeMs) : null;
    const fittedLast = last ? fittedAt(s.entry, last.timeMs) : null;
    return [
      ...margins,
      ...(fittedFirst !== null ? [fittedFirst] : []),
      ...(fittedLast !== null ? [fittedLast] : []),
    ];
  });

  const tMin = Math.min(...allTimes);
  const tMax = Math.max(...allTimes);
  const yMin = Math.min(...allValues, 0);
  const yMax = Math.max(...allValues, 0);

  const width = 320;
  const height = 170;
  const padX = 10;
  const padTop = 18;
  const padBottom = 24;
  const innerWidth = width - padX * 2;
  const innerHeight = height - padTop - padBottom;
  const tRange = tMax - tMin || 1;
  const yRange = yMax - yMin || 1;

  const x = (timeMs: number) => padX + ((timeMs - tMin) / tRange) * innerWidth;
  const y = (value: number) => padTop + ((yMax - value) / yRange) * innerHeight;

  const hasDrifting = plotted.some((s) => s.entry.drifting);

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-44 w-full"
        role="img"
        aria-label="Deriva da margem de conformidade por ponto medido"
      >
        {/* Tolerance limit — margin 0 */}
        <line
          x1={padX}
          x2={width - padX}
          y1={y(0)}
          y2={y(0)}
          className="stroke-muted-foreground/50"
          strokeDasharray="4 3"
          strokeWidth={1}
        />
        <text
          x={padX}
          y={y(0) - 4}
          className="fill-muted-foreground text-[9px]"
        >
          Limite de tolerância
        </text>

        {plotted.map((s) => {
          const stroke = s.entry.drifting
            ? DRIFTING_STROKE
            : SERIES_STROKE[s.colorIndex % SERIES_STROKE.length];
          const fill = s.entry.drifting
            ? DRIFTING_FILL
            : SERIES_FILL[s.colorIndex % SERIES_FILL.length];
          const path = s.points
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"} ${x(p.timeMs).toFixed(1)} ${y(p.margin).toFixed(1)}`,
            )
            .join(" ");
          const first = s.points[0];
          const last = s.points[s.points.length - 1];
          const fittedFirst = first ? fittedAt(s.entry, first.timeMs) : null;
          const fittedLast = last ? fittedAt(s.entry, last.timeMs) : null;

          return (
            <g key={s.entry.pointIndex}>
              {first && last && fittedFirst !== null && fittedLast !== null ? (
                <line
                  x1={x(first.timeMs)}
                  y1={y(fittedFirst)}
                  x2={x(last.timeMs)}
                  y2={y(fittedLast)}
                  className={cn(stroke, "opacity-45")}
                  strokeDasharray="6 4"
                  strokeWidth={1.25}
                />
              ) : null}
              <path d={path} fill="none" className={stroke} strokeWidth={1.5} />
              {s.points.map((p) => (
                <circle
                  key={p.timeMs}
                  cx={x(p.timeMs)}
                  cy={y(p.margin)}
                  r={2.4}
                  className={fill}
                />
              ))}
            </g>
          );
        })}

        {/* Time extent labels */}
        <text
          x={padX}
          y={height - 6}
          className="fill-muted-foreground font-mono text-[9px] tabular-nums"
        >
          {formatDate(new Date(tMin))}
        </text>
        <text
          x={width - padX}
          y={height - 6}
          textAnchor="end"
          className="fill-muted-foreground font-mono text-[9px] tabular-nums"
        >
          {formatDate(new Date(tMax))}
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {plotted.map((s) => (
          <span
            key={s.entry.pointIndex}
            className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
          >
            <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
              <circle
                cx={5}
                cy={5}
                r={4}
                className={
                  s.entry.drifting
                    ? DRIFTING_FILL
                    : SERIES_FILL[s.colorIndex % SERIES_FILL.length]
                }
              />
            </svg>
            Ponto {s.entry.pointIndex + 1}
            {s.entry.drifting ? (
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
