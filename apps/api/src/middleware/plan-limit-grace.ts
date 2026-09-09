import {
  getEffectivePlanLimits,
  type PlanId,
  type PlanLimits,
} from "@calibra-facil/shared";

export type LimitResource = keyof PlanLimits;

/**
 * How far past a plan's monthly ceiling a laboratory may go before it is
 * actually stopped.
 *
 * Blocking a lab from creating a calibration on the 28th is not a nudge to
 * upgrade — it is the day their customer does not get a certificate, and for
 * work that is already scheduled it has no good answer. The ceiling still
 * exists, and it is still the fence the plans are sold on; what changes is
 * that crossing it opens a short, visible band instead of a wall, so the
 * upgrade conversation happens while the lab keeps working.
 *
 * Ten per cent, never fewer than five: enough for a busy last week, far too
 * little to live in permanently. Seats keep the hard ceiling — an extra user
 * is a decision someone makes deliberately, not a surprise on a busy Friday.
 */
const GRACE_RATIO = 0.1;
const MIN_GRACE = 5;

export type LimitDecision =
  | { outcome: "within" }
  | { outcome: "grace"; limit: number; ceiling: number }
  | { outcome: "blocked"; limit: number; ceiling: number };

export function graceCeiling(resource: LimitResource, limit: number): number {
  if (resource !== "certificates") return limit;
  if (!Number.isFinite(limit)) return limit;

  return limit + Math.max(MIN_GRACE, Math.ceil(limit * GRACE_RATIO));
}

/**
 * Decides what happens to a request that would take usage past the plan limit.
 */
export function decidePlanLimit(input: {
  resource: LimitResource;
  planId: PlanId;
  organizationCreatedAt?: Date | null;
  usage: number;
  requestedCount: number;
}): LimitDecision {
  const limit = getEffectivePlanLimits(
    input.planId,
    input.organizationCreatedAt ?? undefined,
  )[input.resource];

  const projected = input.usage + input.requestedCount;
  if (projected <= limit) return { outcome: "within" };

  const ceiling = graceCeiling(input.resource, limit);
  if (projected <= ceiling) return { outcome: "grace", limit, ceiling };

  return { outcome: "blocked", limit, ceiling };
}
