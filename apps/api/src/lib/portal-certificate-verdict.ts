import { formatCalibrationValue } from "@calibra-facil/shared";

/**
 * Compact, customer-facing calibration verdict for the client portal.
 *
 * The lab dashboard derives the at-a-glance approval verdict (points within
 * tolerance + expanded uncertainty) on the client from the frozen `results`
 * jsonb (see `apps/web/.../detail-model.ts`). The portal must not pull that
 * method-runtime graph in, so we recompute the same numbers server-side from
 * the already-frozen `results` and expose only the summary the customer needs.
 *
 * Conformance mirrors the dashboard: a measurement point is "within" when its
 * post-adjustment tolerance margin (`margem_conformidade_apos`) is >= 0.
 */

export type CertificateConformity = "CONFORMING" | "NON_CONFORMING" | "UNKNOWN";

export type PortalCertificateVerdict = {
  /** Overall conformance; UNKNOWN when the method declares no tolerance. */
  conformity: CertificateConformity;
  /** Total tolerance-checked measurement points (0 when none declared). */
  pointsTotal: number;
  /** Points whose post-adjustment margin is within tolerance. */
  pointsWithin: number;
  /** Pre-formatted expanded uncertainty (e.g. "±0,12 g"), or null. */
  expandedUncertainty: string | null;
};

type FormulaLike = {
  outputKey?: string | null;
  unit?: string | null;
};

/** Parse a number from unknown, tolerating comma decimals (matches dashboard). */
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

const UNCERTAINTY_OUTPUT_KEYS = [
  "incerteza_expandida_apos",
  "incerteza_expandida_antes",
] as const;

const MARGIN_OUTPUT_KEY = "margem_conformidade_apos";

function formatExpandedUncertainty(
  results: Record<string, unknown> | null,
  formulas: FormulaLike[],
): string | null {
  const unitByOutputKey = new Map(
    formulas
      .filter((formula) => typeof formula.outputKey === "string")
      .map((formula) => [formula.outputKey, formula.unit ?? null] as const),
  );

  for (const key of UNCERTAINTY_OUTPUT_KEYS) {
    const values = numericValues(results?.[key]);
    if (values.length === 0) continue;
    const max = Math.max(...values.map((value) => Math.abs(value)));
    const unit = unitByOutputKey.get(key);
    return `±${formatCalibrationValue(max)}${unit ? ` ${unit}` : ""}`;
  }

  return null;
}

export function buildPortalCertificateVerdict(input: {
  results: Record<string, unknown> | null | undefined;
  formulas: FormulaLike[] | null | undefined;
}): PortalCertificateVerdict {
  const results = input.results ?? null;
  const formulas = input.formulas ?? [];

  const margins = numericValues(results?.[MARGIN_OUTPUT_KEY]);
  const pointsTotal = margins.length;
  const pointsWithin = margins.filter((margin) => margin >= 0).length;

  const conformity: CertificateConformity =
    pointsTotal === 0
      ? "UNKNOWN"
      : pointsWithin === pointsTotal
        ? "CONFORMING"
        : "NON_CONFORMING";

  return {
    conformity,
    pointsTotal,
    pointsWithin,
    expandedUncertainty: formatExpandedUncertainty(results, formulas),
  };
}
