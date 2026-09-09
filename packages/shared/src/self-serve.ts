/**
 * Whether an organization may contract a plan by itself right now.
 *
 * The reason this exists is a real defect one layer down: paying a second
 * `PLAN_RECURRING` offer calls `createSubscription` again and
 * `upsertSubscriptionFromOffer` overwrites `providerSubscriptionId` on the
 * organization's single subscription row — nothing ever tells Asaas to stop
 * the previous recurrence, and nothing reads `activationBehavior:
 * "IMMEDIATE_REPLACE"`. The old subscription keeps charging while we lose its
 * id, so the customer is billed twice and reconciliation cannot see it.
 *
 * Until replacement is implemented (update the existing Asaas subscription, or
 * cancel it inside the activation transaction), self-serve refuses to be the
 * path that creates that situation. Operators can still change plans from the
 * backoffice, where a human reconciles the provider side.
 */
export type SelfServeEligibility =
  | { ok: true }
  | { ok: false; code: "PLAN_CHANGE_REQUIRES_SUPPORT"; message: string };

type SubscriptionRow = { planId: string; status: string };

export function checkSelfServeEligibility(
  current: SubscriptionRow | null | undefined,
): SelfServeEligibility {
  if (!current) return { ok: true };

  // A free plan has no recurrence at the provider, so there is nothing to
  // orphan. Canceled subscriptions are equally safe to replace.
  const holdsPaidPlan = current.planId !== "FREE";
  const billingIsLive =
    current.status === "ACTIVE" || current.status === "PAST_DUE";

  if (holdsPaidPlan && billingIsLive) {
    return {
      ok: false,
      code: "PLAN_CHANGE_REQUIRES_SUPPORT",
      message:
        "Seu laboratório já tem um plano ativo. Para trocar de plano, fale com a nossa equipe — assim garantimos que a cobrança anterior seja encerrada antes da nova.",
    };
  }

  return { ok: true };
}
