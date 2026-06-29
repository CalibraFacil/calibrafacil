/**
 * As-found reliability verdict — the per-job in-tolerance signal that feeds
 * reliability-based calibration-interval analysis (ILAC-G24 / OIML D 10 §6.6 →
 * NCSL RP-1). Spec: `specs/calibration-interval-customer-owned/spec.md` (REQ-RELIA-*).
 *
 * This is the AS-FOUND (pre-adjustment) counterpart to the certificate verdict in
 * `portal-certificate-verdict.ts`. The distinction is metrological and load-bearing:
 * reliability R = (in-tolerance as-found) / (total) MUST use the instrument's
 * condition BEFORE any adjustment — what it looked like when it arrived, after a
 * full interval in service. The certificate verdict uses the post-adjustment margin
 * (`margem_conformidade_apos`, "as-left"), which only confirms the instrument was
 * restored and says nothing about in-service drift. Using as-left for reliability
 * would make every adjusted instrument look reliable and defeat the analysis.
 *
 * We therefore read ONLY `margem_conformidade_antes` and NEVER fall back to the
 * as-left key. When no as-found margin is present the verdict is UNKNOWN (the job is
 * excluded from reliability), never silently counted as conforming.
 *
 * Margin convention ground truth: `apps/web/src/features/jobs/detail-model.ts`
 * (`margem_conformidade_antes` / `_apos`) and `portal-certificate-verdict.ts`.
 */

export type AsFoundConformity = "CONFORMING" | "NON_CONFORMING" | "UNKNOWN";

export type AsFoundReliabilityVerdict = {
  /** Overall as-found conformance; UNKNOWN when the method emits no as-found margin. */
  conformity: AsFoundConformity;
  /** Total as-found tolerance-checked points (0 when none declared). */
  pointsTotal: number;
  /** As-found points whose margin is within tolerance (margin ≥ 0). */
  pointsWithin: number;
  /** The parsed per-point as-found margins (for persistence / later analysis). */
  margins: number[];
};

/**
 * As-found (pre-adjustment) conformity-margin key. Deliberately NEVER the `_apos`
 * (as-left) key — see the module header. Changing this to fall back to `_apos`
 * would corrupt the reliability signal.
 */
const AS_FOUND_MARGIN_KEY = "margem_conformidade_antes";

/** Parse a number from unknown, tolerating comma decimals (matches the dashboard). */
function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Flatten nested arrays of point values into a flat list of finite numbers. */
function numericValues(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => numericValues(item));
  }
  const parsed = numberFromUnknown(value);
  return parsed === null ? [] : [parsed];
}

export function buildAsFoundReliabilityVerdict(input: {
  results: Record<string, unknown> | null | undefined;
}): AsFoundReliabilityVerdict {
  const results = input.results ?? null;

  const margins = numericValues(results?.[AS_FOUND_MARGIN_KEY]);
  const pointsTotal = margins.length;
  const pointsWithin = margins.filter((margin) => margin >= 0).length;

  const conformity: AsFoundConformity =
    pointsTotal === 0
      ? "UNKNOWN"
      : pointsWithin === pointsTotal
        ? "CONFORMING"
        : "NON_CONFORMING";

  return { conformity, pointsTotal, pointsWithin, margins };
}
