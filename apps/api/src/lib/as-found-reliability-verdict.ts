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
 *
 * The verdict follows the method's declared decision rule (ISO/IEC 17025 7.8.6,
 * ILAC-G8; roadmap 2 C4, `@calibra-facil/shared/decision-rule`): with a guard band
 * (w = U) the per-point as-found expanded uncertainty
 * (`incerteza_expandida_antes`) takes part. A method that declares none is judged
 * by simple acceptance, as before, and the verdict says the rule was undeclared
 * (Q57). The verdict drives the out-of-tolerance event and the customer alert.
 */

import {
  type DecisionRuleKind,
  type PointDecision,
  decidePoint,
  isNonConformingDecision,
} from "@calibra-facil/shared/decision-rule";

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
  /** The rule the points were judged by; "undeclared" judges by simple acceptance. */
  decisionRule: DecisionRuleKind | "undeclared";
  /** One decision per point, in the order of `margins`. */
  decisions: PointDecision[];
};

/**
 * As-found (pre-adjustment) conformity-margin key. Deliberately NEVER the `_apos`
 * (as-left) key — see the module header. Changing this to fall back to `_apos`
 * would corrupt the reliability signal.
 */
const AS_FOUND_MARGIN_KEY = "margem_conformidade_antes";
/** The as-found expanded uncertainty per point: the guard band of guarded rules. */
const AS_FOUND_UNCERTAINTY_KEY = "incerteza_expandida_antes";

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
  /** The frozen method's declared rule (`certificateContent.decisionRuleKind`). */
  decisionRule?: DecisionRuleKind | null;
}): AsFoundReliabilityVerdict {
  const results = input.results ?? null;
  const rule: DecisionRuleKind = input.decisionRule ?? "simple_acceptance";

  const margins = numericValues(results?.[AS_FOUND_MARGIN_KEY]);
  const uncertainties = numericValues(results?.[AS_FOUND_UNCERTAINTY_KEY]);
  // A guard band is per point: only a list as long as the margins pairs up.
  const uncertaintyAt = (index: number) =>
    uncertainties.length === margins.length
      ? (uncertainties[index] ?? null)
      : null;
  const decisions = margins.map((margin, index) =>
    decidePoint(rule, margin, uncertaintyAt(index)),
  );
  const pointsTotal = margins.length;
  const pointsWithin = margins.filter((margin) => margin >= 0).length;

  const conformity: AsFoundConformity =
    pointsTotal === 0
      ? "UNKNOWN"
      : decisions.some(isNonConformingDecision)
        ? "NON_CONFORMING"
        : decisions.some((decision) => decision === "undetermined")
          ? "UNKNOWN"
          : "CONFORMING";

  return {
    conformity,
    pointsTotal,
    pointsWithin,
    margins,
    decisionRule: input.decisionRule ?? "undeclared",
    decisions,
  };
}
