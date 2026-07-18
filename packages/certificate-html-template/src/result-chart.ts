import { escapeHtml } from "./blocks.js";

/**
 * Calibration curve charts (roadmap item 1): deterministic inline SVG —
 * error vs load with expanded-uncertainty bars — rendered PURELY from the
 * frozen input data. No rasterizer, no randomness, no clock: the SVG string
 * is part of the compiled artifact and covered by its sha256.
 *
 * The METHOD opts in via `certificateContent.resultCharts`; the renderer
 * silently omits when unconfigured or when the referenced series are absent
 * (accreditation-seal pattern — safe across methods).
 */

export type ResultChartConfig = {
  tableKey: string;
  xKey: string;
  yKey: string;
  uncertaintyKey?: string | null;
  label?: string | null;
};

type Data = Record<string, unknown>;

type ChartPoint = { x: number; y: number; u: number };

const WIDTH = 640;
const HEIGHT = 320;
const MARGIN = { top: 18, right: 20, bottom: 46, left: 64 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Series resolution: results[key][i] (computed) wins, else row[key] (input). */
function seriesValue(
  results: unknown,
  row: unknown,
  key: string,
  rowIndex: number,
): number | null {
  const computed = isRecord(results) ? Reflect.get(results, key) : null;
  if (Array.isArray(computed)) {
    const value = computed[rowIndex];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  const raw = isRecord(row) ? Reflect.get(row, key) : null;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function axisLabel(data: Data, tableKey: string, key: string): string {
  const methodSnapshot = Reflect.get(data, "methodSnapshot");
  if (!isRecord(methodSnapshot)) return key;
  const fields = Reflect.get(methodSnapshot, "dataFields");
  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (!isRecord(field) || Reflect.get(field, "key") !== tableKey) continue;
      const columns = Reflect.get(field, "columns");
      if (!Array.isArray(columns)) continue;
      for (const column of columns) {
        if (isRecord(column) && Reflect.get(column, "key") === key) {
          const label = Reflect.get(column, "label");
          const unit = Reflect.get(column, "unit");
          const base = typeof label === "string" ? label : key;
          return typeof unit === "string" && unit !== ""
            ? `${base} [${unit}]`
            : base;
        }
      }
    }
  }
  const formulas = Reflect.get(methodSnapshot, "formulas");
  if (Array.isArray(formulas)) {
    for (const formula of formulas) {
      if (isRecord(formula) && Reflect.get(formula, "outputKey") === key) {
        const label = Reflect.get(formula, "label");
        const unit = Reflect.get(formula, "unit");
        const base = typeof label === "string" ? label : key;
        return typeof unit === "string" && unit !== ""
          ? `${base} [${unit}]`
          : base;
      }
    }
  }
  return key;
}

/** Deterministic tick formatting: enough decimals for the span, pt-BR comma. */
function formatTick(value: number, span: number): string {
  const decimals = span >= 100 ? 0 : span >= 1 ? 1 : span >= 0.01 ? 3 : 5;
  return value.toFixed(decimals).replace(".", ",");
}

function buildChartSvg(
  points: ChartPoint[],
  xLabel: string,
  yLabel: string,
): string {
  const xs = points.map((point) => point.x);
  const yLows = points.map((point) => point.y - point.u);
  const yHighs = points.map((point) => point.y + point.u);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMinRaw = Math.min(0, ...yLows);
  const yMaxRaw = Math.max(0, ...yHighs);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMaxRaw - yMinRaw || 1;
  const yPad = ySpan * 0.1;
  const yMin = yMinRaw - yPad;
  const yMax = yMaxRaw + yPad;

  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const sx = (x: number) =>
    MARGIN.left + ((x - xMin) / xSpan) * plotWidth;
  const sy = (y: number) =>
    MARGIN.top + plotHeight - ((y - yMin) / (yMax - yMin)) * plotHeight;

  const ticks = 5;
  const parts: string[] = [];

  // frame + gridlines + tick labels
  for (let index = 0; index <= ticks; index++) {
    const yValue = yMin + ((yMax - yMin) * index) / ticks;
    const y = sy(yValue);
    parts.push(
      `<line x1="${MARGIN.left}" y1="${y.toFixed(2)}" x2="${WIDTH - MARGIN.right}" y2="${y.toFixed(2)}" stroke="#D3D7DE" stroke-width="1"/>`,
      `<text x="${MARGIN.left - 8}" y="${(y + 3).toFixed(2)}" text-anchor="end" font-size="10" fill="#2E3440">${escapeHtml(formatTick(yValue, yMax - yMin))}</text>`,
    );
    const xValue = xMin + (xSpan * index) / ticks;
    const x = sx(xValue);
    parts.push(
      `<text x="${x.toFixed(2)}" y="${HEIGHT - MARGIN.bottom + 16}" text-anchor="middle" font-size="10" fill="#2E3440">${escapeHtml(formatTick(xValue, xSpan))}</text>`,
    );
  }
  // zero line (error charts cross it)
  if (yMin < 0 && yMax > 0) {
    const zero = sy(0);
    parts.push(
      `<line x1="${MARGIN.left}" y1="${zero.toFixed(2)}" x2="${WIDTH - MARGIN.right}" y2="${zero.toFixed(2)}" stroke="#111418" stroke-width="1.2"/>`,
    );
  }

  // uncertainty bars
  for (const point of points) {
    if (point.u <= 0) continue;
    const x = sx(point.x).toFixed(2);
    const top = sy(point.y + point.u).toFixed(2);
    const bottom = sy(point.y - point.u).toFixed(2);
    parts.push(
      `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="#1F3A5F" stroke-width="1.4"/>`,
      `<line x1="${Number(x) - 4}" y1="${top}" x2="${Number(x) + 4}" y2="${top}" stroke="#1F3A5F" stroke-width="1.4"/>`,
      `<line x1="${Number(x) - 4}" y1="${bottom}" x2="${Number(x) + 4}" y2="${bottom}" stroke="#1F3A5F" stroke-width="1.4"/>`,
    );
  }

  // polyline + markers
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${sx(point.x).toFixed(2)},${sy(point.y).toFixed(2)}`,
    )
    .join(" ");
  parts.push(
    `<path d="${path}" fill="none" stroke="#1F3A5F" stroke-width="1.8"/>`,
  );
  for (const point of points) {
    parts.push(
      `<circle cx="${sx(point.x).toFixed(2)}" cy="${sy(point.y).toFixed(2)}" r="3.2" fill="#1F3A5F"/>`,
    );
  }

  // axes + labels
  parts.push(
    `<line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${HEIGHT - MARGIN.bottom}" stroke="#111418" stroke-width="1.2"/>`,
    `<line x1="${MARGIN.left}" y1="${HEIGHT - MARGIN.bottom}" x2="${WIDTH - MARGIN.right}" y2="${HEIGHT - MARGIN.bottom}" stroke="#111418" stroke-width="1.2"/>`,
    `<text x="${(MARGIN.left + WIDTH - MARGIN.right) / 2}" y="${HEIGHT - 8}" text-anchor="middle" font-size="11" fill="#111418">${escapeHtml(xLabel)}</text>`,
    `<text x="14" y="${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}" text-anchor="middle" font-size="11" fill="#111418" transform="rotate(-90 14 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2})">${escapeHtml(yLabel)}</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" font-family="Source Sans 3, sans-serif">${parts.join("")}</svg>`;
}

export type DerivedResultChart = { label: string; svg: string };

/** Charts for a given table (renderResultsTable attaches them after its grids). */
export function deriveResultCharts(
  data: Data,
  tableKey: string,
): DerivedResultChart[] {
  const methodSnapshot = Reflect.get(data, "methodSnapshot");
  if (!isRecord(methodSnapshot)) return [];
  const content = Reflect.get(methodSnapshot, "certificateContent");
  const rawCharts = isRecord(content)
    ? Reflect.get(content, "resultCharts")
    : null;
  if (!Array.isArray(rawCharts)) return [];

  const tableData = Reflect.get(data, "data");
  const results = Reflect.get(data, "results");
  const charts: DerivedResultChart[] = [];

  for (const raw of rawCharts) {
    if (!isRecord(raw)) continue;
    if (Reflect.get(raw, "tableKey") !== tableKey) continue;
    const xKey = Reflect.get(raw, "xKey");
    const yKey = Reflect.get(raw, "yKey");
    if (typeof xKey !== "string" || typeof yKey !== "string") continue;
    const uncertaintyKey = Reflect.get(raw, "uncertaintyKey");
    const rows = isRecord(tableData)
      ? Reflect.get(tableData, tableKey)
      : null;
    if (!Array.isArray(rows) || rows.length < 2) continue;

    const points: ChartPoint[] = [];
    rows.forEach((row, rowIndex) => {
      const x = seriesValue(results, row, xKey, rowIndex);
      const y = seriesValue(results, row, yKey, rowIndex);
      if (x === null || y === null) return;
      const u =
        typeof uncertaintyKey === "string"
          ? (seriesValue(results, row, uncertaintyKey, rowIndex) ?? 0)
          : 0;
      points.push({ x, y, u: Math.abs(u) });
    });
    if (points.length < 2) continue;
    points.sort((left, right) => left.x - right.x);

    const label = Reflect.get(raw, "label");
    charts.push({
      label:
        typeof label === "string" && label !== ""
          ? label
          : `Curva de calibração — ${axisLabel(data, tableKey, yKey)}`,
      svg: buildChartSvg(
        points,
        axisLabel(data, tableKey, xKey),
        axisLabel(data, tableKey, yKey),
      ),
    });
  }
  return charts;
}
