/**
 * The eccentricity-indicator diagram: a small SVG showing which platform
 * position the indicator sat on during the eccentricity test. Extracted from
 * the deleted XLSX renderer, SVG-only — Chromium renders SVG natively, so the
 * former PNG variant (and its `@resvg/resvg-js` rasterizer) is gone. It only
 * existed because a spreadsheet cell cannot hold an SVG.
 */

export type CertificateImageContext = {
  dataFields?: ReadonlyArray<{
    key: string;
    columns?: ReadonlyArray<{ key: string; label?: string }>;
    eccentricityIndicator?: {
      enabled?: boolean;
      variant?: string;
    } | null;
  }> | null;
  specifications?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
};

type EccentricityIndicatorVariant = "circular_platform" | "road_scale";
type EccentricityIndicatorPosition =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "1"
  | "2"
  | "3"
  | "4";

export const ECCENTRICITY_INDICATOR_SPEC_KEY = "eccentricityIndicatorPosition";
const CIRCULAR_ECCENTRICITY_INDICATOR_POSITIONS = new Set([
  "top",
  "right",
  "bottom",
  "left",
]);
const ROAD_SCALE_ECCENTRICITY_INDICATOR_POSITIONS = new Set([
  "1",
  "2",
  "3",
  "4",
]);
const CIRCULAR_ECCENTRICITY_LOAD_POINTS = ["A", "B", "C", "D", "E"];
/*
 * The diagram is embedded in the certificate body, so it has to be set in the
 * same face as the surrounding text. The old stack was Carlito-first, inherited
 * from the XLSX path where the SVG lived inside a Calibri-metric workbook; kept
 * as-is it would render the one graphic on the page in a Calibri clone while
 * everything around it is Arial. Same ordering rule as the accreditation symbol
 * (see ACCREDITATION_SEAL_FONT_FAMILY): Arial first, Liberation Sans as the
 * metric-compatible substitute actually present in the Gotenberg container.
 */
const ECCENTRICITY_INDICATOR_FONT_FAMILY =
  'Arial, "Liberation Sans", Helvetica, sans-serif';

/**
 * The eccentricity indicator as raw SVG markup, for HTML-rendered
 * certificates. Returns null when the method declares no eccentricity
 * indicator — the METHOD opts in, via a data field or an explicit
 * `graphics.eccentricityIndicatorVariant`. (The deleted XLSX path gated on the
 * template's image binding instead, which is exactly the kind of
 * layout-decides-content coupling the fixed layouts remove.)
 */
export function renderEccentricityIndicatorSvgMarkup(
  context: CertificateImageContext | undefined,
  data: Record<string, unknown>,
): string | null {
  const enabled =
    (context?.dataFields ?? []).some(
      (field) => field.eccentricityIndicator?.enabled,
    ) ||
    typeof getPathValue(data, "graphics.eccentricityIndicatorVariant") ===
      "string";
  if (!enabled) return null;
  const variant = resolveEccentricityIndicatorVariant(context, data);
  const selectedPosition = resolveEccentricityIndicatorPosition(
    context,
    data,
    variant,
  );
  const loadPositions =
    variant === "circular_platform"
      ? resolveCircularEccentricityLoadPositions(context, data)
      : undefined;
  return renderEccentricityIndicatorSvg({
    variant,
    selectedPosition,
    loadPositions,
  });
}

function resolveEccentricityIndicatorVariant(
  context: CertificateImageContext | undefined,
  data: Record<string, unknown>,
): EccentricityIndicatorVariant {
  const fields = context?.dataFields ?? [];
  const configuredField = fields.find(
    (field) => field.eccentricityIndicator?.enabled,
  );
  const value =
    configuredField?.eccentricityIndicator?.variant ??
    getPathValue(data, "graphics.eccentricityIndicatorVariant");

  return value === "road_scale" ? "road_scale" : "circular_platform";
}

function resolveEccentricityIndicatorPosition(
  context: CertificateImageContext | undefined,
  data: Record<string, unknown>,
  variant: EccentricityIndicatorVariant,
): EccentricityIndicatorPosition | null {
  const value =
    context?.specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY] ??
    context?.data?.[ECCENTRICITY_INDICATOR_SPEC_KEY] ??
    getPathValue(
      data,
      "assetSnapshot.specifications.eccentricityIndicatorPosition",
    ) ??
    getPathValue(data, "data.eccentricityIndicatorPosition") ??
    getPathValue(data, "graphics.eccentricityIndicatorPosition");
  return typeof value === "string" &&
    isEccentricityIndicatorPosition(value, variant)
    ? value
    : null;
}

function isEccentricityIndicatorPosition(
  value: string,
  variant: EccentricityIndicatorVariant,
): value is EccentricityIndicatorPosition {
  const allowed =
    variant === "road_scale"
      ? ROAD_SCALE_ECCENTRICITY_INDICATOR_POSITIONS
      : CIRCULAR_ECCENTRICITY_INDICATOR_POSITIONS;

  return allowed.has(value);
}

function resolveCircularEccentricityLoadPositions(
  context: CertificateImageContext | undefined,
  data: Record<string, unknown>,
): string[] {
  const field = context?.dataFields?.find(
    (item) => item.eccentricityIndicator?.enabled,
  );
  const configuredRows = field ? context?.data?.[field.key] : undefined;
  const rows =
    field && Array.isArray(configuredRows)
      ? configuredRows
      : getPathValue(data, "dataDisplay.excentricidade");

  if (!field?.columns || !Array.isArray(rows)) {
    return CIRCULAR_ECCENTRICITY_LOAD_POINTS;
  }

  const positionColumn = field.columns.find((column) => {
    const text = normalizeSearchText(`${column.key} ${column.label ?? ""}`);
    return text.includes("posicao") || text.includes("ponto");
  });

  if (!positionColumn) {
    return CIRCULAR_ECCENTRICITY_LOAD_POINTS;
  }

  const positions: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    const value = String(recordFromUnknown(row)[positionColumn.key] ?? "")
      .trim()
      .toUpperCase();
    if (
      CIRCULAR_ECCENTRICITY_LOAD_POINTS.includes(value) &&
      !positions.includes(value)
    ) {
      positions.push(value);
    }
  }

  return positions.length > 0 ? positions : CIRCULAR_ECCENTRICITY_LOAD_POINTS;
}

function renderEccentricityIndicatorSvg({
  variant,
  selectedPosition,
  loadPositions,
}: {
  variant: EccentricityIndicatorVariant;
  selectedPosition: EccentricityIndicatorPosition | null;
  loadPositions?: string[];
}) {
  return variant === "road_scale"
    ? renderRoadScaleEccentricitySvg(selectedPosition)
    : renderCircularEccentricitySvg(selectedPosition, loadPositions);
}

function renderCircularEccentricitySvg(
  selectedPosition: EccentricityIndicatorPosition | null,
  loadPositions = CIRCULAR_ECCENTRICITY_LOAD_POINTS,
) {
  const ink = "#111111";
  const fontFamily = ECCENTRICITY_INDICATOR_FONT_FAMILY;
  const marker = (
    position: EccentricityIndicatorPosition,
    x: number,
    y: number,
  ) => {
    const selected = selectedPosition === position;
    return `<g><rect x="${x}" y="${y}" width="16" height="16" fill="#ffffff" stroke="${ink}" stroke-width="1.3"/>${
      selected
        ? `<path d="M ${x + 3.5} ${y + 3.5} L ${x + 12.5} ${y + 12.5} M ${x + 12.5} ${y + 3.5} L ${x + 3.5} ${y + 12.5}" fill="none" stroke="${ink}" stroke-width="1.9" stroke-linecap="round"/>`
        : ""
    }</g>`;
  };
  const point = (label: string, x: number, y: number, anchor = "start") =>
    loadPositions.includes(label)
      ? `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${fontFamily}" font-size="16" font-weight="700" fill="${ink}">${label}</text>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="170" height="100" viewBox="0 0 170 100">
  <g transform="translate(44.5 4) scale(0.54)">
    <rect x="38" y="38" width="74" height="74" rx="37" fill="#ffffff" stroke="${ink}" stroke-width="1.5"/>
    <rect x="74.5" y="10" width="1" height="130" fill="${ink}"/>
    <rect x="10" y="74.5" width="130" height="1" fill="${ink}"/>
    <rect x="66" y="66" width="18" height="18" fill="#ffffff"/>
    ${point("A", 75, 80, "middle")}
    ${point("B", 54, 63)}
    ${point("C", 86, 63)}
    ${point("D", 86, 101)}
    ${point("E", 54, 101)}
    ${marker("top", 67, 0)}
    ${marker("right", 134, 67)}
    ${marker("bottom", 67, 134)}
    ${marker("left", 0, 67)}
  </g>
  <text x="85" y="95" text-anchor="middle" font-family="${fontFamily}" font-size="8.5" font-weight="600" fill="${ink}">Posição do indicador</text>
</svg>`;
}

function renderRoadScaleEccentricitySvg(
  selectedPosition: EccentricityIndicatorPosition | null,
) {
  const selectedFill = "#2563eb";
  const ink = "#111111";
  const fontFamily = ECCENTRICITY_INDICATOR_FONT_FAMILY;
  const sections = ["1", "2", "3", "4"]
    .map((section, index) => {
      const x = 12 + index * 42;
      const selected = selectedPosition === section;
      return `<rect x="${x}" y="58" width="42" height="34" fill="${selected ? selectedFill : "#ffffff"}" stroke="${ink}" stroke-width="1.5"/>
        <text x="${x + 21}" y="75" text-anchor="middle" dominant-baseline="central" font-family="${fontFamily}" font-size="14" font-weight="700" fill="${selected ? "#ffffff" : ink}">${section}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="170" height="100" viewBox="0 0 170 100">
  <g transform="translate(2 -35)">
    ${sections}
    <rect x="78" y="116" width="34" height="18" fill="#ffffff" stroke="${ink}" stroke-width="1.5"/>
  </g>
  <text x="85" y="97" text-anchor="middle" font-family="${fontFamily}" font-size="8.5" font-weight="600" fill="${ink}">Posição do indicador</text>
</svg>`;
}

function getPathValue(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number.parseInt(segment, 10)];
    }
    if (typeof current === "object") {
      return Reflect.get(current, segment);
    }
    return undefined;
  }, data);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}
