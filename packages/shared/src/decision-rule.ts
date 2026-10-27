/**
 * Decision rules for statements of conformity (ISO/IEC 17025 7.8.6, 7.1.3;
 * ILAC-G8:09/2019), roadmap 2 C4.
 *
 * A point is judged from its conformity margin m = T - |E| (tolerance minus the
 * absolute error; m >= 0 is inside the tolerance) and, for the rules that use a
 * guard band, its expanded uncertainty U (the guard band w = U):
 *
 * - simple_acceptance (ILAC-G8 4.2.1, w = 0): pass when m >= 0, else fail.
 * - guarded_acceptance (ILAC-G8 4.2.2, binary, w = U): pass only when m >= U, so
 *   the measured value is inside the tolerance by at least its uncertainty;
 *   anything else fails (the customer is protected from a false accept).
 * - non_binary (ILAC-G8 4.2.3, w = U): pass (m >= U), conditional pass
 *   (0 <= m < U), conditional fail (-U <= m < 0), fail (m < -U).
 *
 * A rule with a guard band and no U for a point leaves that point undetermined.
 */
export const DECISION_RULE_KINDS = [
  "simple_acceptance",
  "guarded_acceptance",
  "non_binary",
] as const;

export type DecisionRuleKind = (typeof DECISION_RULE_KINDS)[number];

export type PointDecision =
  | "pass"
  | "conditional_pass"
  | "conditional_fail"
  | "fail"
  | "undetermined";

export const DECISION_RULE_LABELS: Record<DecisionRuleKind, string> = {
  simple_acceptance: "Aceitação simples (ILAC-G8 4.2.1, sem banda de guarda)",
  guarded_acceptance:
    "Aceitação com banda de guarda w = U (ILAC-G8 4.2.2, binária)",
  non_binary:
    "Regra não binária com w = U (ILAC-G8 4.2.3: conforme, conforme condicional, não conforme condicional, não conforme)",
};

export function isDecisionRuleKind(value: unknown): value is DecisionRuleKind {
  return (
    typeof value === "string" &&
    DECISION_RULE_KINDS.some((kind) => kind === value)
  );
}

export function decidePoint(
  kind: DecisionRuleKind,
  margin: number,
  expandedUncertainty: number | null,
): PointDecision {
  if (kind === "simple_acceptance") return margin >= 0 ? "pass" : "fail";
  if (expandedUncertainty === null || !Number.isFinite(expandedUncertainty)) {
    return "undetermined";
  }
  const guard = Math.abs(expandedUncertainty);
  if (kind === "guarded_acceptance") return margin >= guard ? "pass" : "fail";
  if (margin >= guard) return "pass";
  if (margin >= 0) return "conditional_pass";
  if (margin >= -guard) return "conditional_fail";
  return "fail";
}

/** A point that the rule says does not conform (the measured value may be out). */
export function isNonConformingDecision(decision: PointDecision): boolean {
  return decision === "fail" || decision === "conditional_fail";
}
