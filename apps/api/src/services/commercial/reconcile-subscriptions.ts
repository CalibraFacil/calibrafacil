import { db } from "@calibra-facil/db";
import {
  operatorAlert,
  subscription,
  type SubscriptionStatus,
} from "@calibra-facil/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { AsaasPaymentList, AsaasSubscription } from "../asaas/types";
import { getSubscription, listPayments } from "../asaas/subscriptions";
import { AsaasError } from "../asaas/client";

// REQ-REL-ASA-002: periodic reconciliation of local subscription state against
// ASAAS. Webhooks are the primary sync path, but a lost/never-retried delivery
// (or an ASAAS cancel whose webhook was dropped) leaves the local subscription
// ACTIVE indefinitely. This job re-derives each still-billing subscription's
// status from the provider and corrects + alerts on any divergence.
//
// The provider access is behind a small PORT so the detection/correction logic is
// unit-testable against a fake, and the cron wires the real ASAAS client.

export interface AsaasReconciliationPort {
  /** Return the provider subscription, or null when it no longer exists (404). */
  getSubscription(
    providerSubscriptionId: string,
  ): Promise<AsaasSubscription | null>;
  listPayments(options: {
    subscription?: string;
    status?: string;
    limit?: number;
  }): Promise<AsaasPaymentList>;
}

export type SubscriptionDivergence = {
  subscriptionId: number;
  organizationId: string;
  providerSubscriptionId: string;
  localStatus: SubscriptionStatus;
  expectedStatus: SubscriptionStatus;
  reason: string;
};

export type ReconciliationSummary = {
  checked: number;
  diverged: number;
  corrected: number;
  errors: { subscriptionId: number; message: string }[];
  divergences: SubscriptionDivergence[];
};

// Local states that still grant entitlement, so a provider cancel/lapse that we
// missed is financially material. Terminal states (CANCELED) are intentionally
// not reloaded — that is what makes a repeat run idempotent.
const BILLING_LOCAL_STATES: SubscriptionStatus[] = ["ACTIVE", "PAST_DUE"];

function expectedStatusFor(
  remote: AsaasSubscription | null,
  hasOverduePayment: boolean,
): { status: SubscriptionStatus; reason: string } | null {
  if (remote === null) {
    return { status: "CANCELED", reason: "provider_subscription_not_found" };
  }
  if (remote.status === "INACTIVE" || remote.status === "EXPIRED") {
    return { status: "CANCELED", reason: "provider_subscription_canceled" };
  }
  // remote.status === "ACTIVE"
  if (hasOverduePayment) {
    return { status: "PAST_DUE", reason: "provider_payments_overdue" };
  }
  return null;
}

async function recordDivergenceAlert(params: {
  now: Date;
  divergence: SubscriptionDivergence;
}): Promise<void> {
  const { now, divergence } = params;
  const severity = divergence.expectedStatus === "CANCELED" ? "critical" : "warning";
  const title = `Assinatura divergente do ASAAS: ${divergence.organizationId}`;
  const detail = `Estado local ${divergence.localStatus} → ASAAS indica ${divergence.expectedStatus} (${divergence.reason}). Corrigido para ${divergence.expectedStatus}.`;

  await db
    .insert(operatorAlert)
    .values({
      organizationId: divergence.organizationId,
      dedupeKey: `subscription:${divergence.subscriptionId}:provider_divergence`,
      kind: "subscription_provider_divergence",
      severity,
      title,
      detail,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: operatorAlert.dedupeKey,
      set: { severity, title, detail, lastSeenAt: now, updatedAt: now },
    });
}

export async function reconcileProviderSubscriptions(
  port: AsaasReconciliationPort,
  options?: { now?: Date },
): Promise<ReconciliationSummary> {
  const now = options?.now ?? new Date();

  const locals = await db
    .select()
    .from(subscription)
    .where(
      and(
        isNotNull(subscription.providerSubscriptionId),
        inArray(subscription.status, BILLING_LOCAL_STATES),
      ),
    );

  const divergences: SubscriptionDivergence[] = [];
  const errors: { subscriptionId: number; message: string }[] = [];
  let corrected = 0;

  for (const local of locals) {
    const providerSubscriptionId = local.providerSubscriptionId;
    if (!providerSubscriptionId) continue;

    try {
      const remote = await port.getSubscription(providerSubscriptionId);

      let hasOverduePayment = false;
      if (remote !== null && remote.status === "ACTIVE") {
        const overdue = await port.listPayments({
          subscription: providerSubscriptionId,
          status: "OVERDUE",
          limit: 1,
        });
        hasOverduePayment = (overdue.data?.length ?? 0) > 0;
      }

      const expected = expectedStatusFor(remote, hasOverduePayment);
      if (!expected || expected.status === local.status) {
        continue;
      }

      const divergence: SubscriptionDivergence = {
        subscriptionId: local.id,
        organizationId: local.organizationId,
        providerSubscriptionId,
        localStatus: local.status,
        expectedStatus: expected.status,
        reason: expected.reason,
      };
      divergences.push(divergence);

      await db.transaction(async (tx) => {
        await tx
          .update(subscription)
          .set({
            status: expected.status,
            ...(expected.status === "CANCELED"
              ? {
                  canceledAt: local.canceledAt ?? now,
                  cancelReason:
                    local.cancelReason ?? `reconciliation:${expected.reason}`,
                }
              : {}),
          })
          .where(eq(subscription.id, local.id));
      });

      await recordDivergenceAlert({ now, divergence });
      corrected += 1;
    } catch (error) {
      // Isolate per-subscription failures (e.g. a non-404 provider error) so one
      // bad row never aborts the whole sweep. A NON-404 getSubscription error must
      // NOT be read as "canceled" — the port returns null only on a real 404.
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ subscriptionId: local.id, message });
      console.error("[SubscriptionReconciliation] subscription failed", {
        subscriptionId: local.id,
        message,
      });
    }
  }

  return {
    checked: locals.length,
    diverged: divergences.length,
    corrected,
    errors,
    divergences,
  };
}

function isAsaasNotFound(error: unknown): boolean {
  if (!(error instanceof AsaasError)) return false;
  // The client sets code from the ASAAS error body, or `HTTP_<status>` when the
  // body is unparseable. Treat an explicit 404 or an object-not-found code as a
  // definitive "subscription no longer exists at the provider".
  return (
    error.code === "HTTP_404" ||
    error.code === "not_found" ||
    error.code === "invalid_object" ||
    /not found|não encontrad/i.test(error.message)
  );
}

/**
 * Real ASAAS-backed port. Maps a definitive 404 to `null` (subscription removed)
 * and rethrows any other provider error so the sweep records it without wrongly
 * canceling the local subscription. Gives `getSubscription`/`listPayments` their
 * first production caller (issue #651).
 */
export function createAsaasReconciliationPort(): AsaasReconciliationPort {
  return {
    async getSubscription(providerSubscriptionId) {
      try {
        return await getSubscription(providerSubscriptionId);
      } catch (error) {
        if (isAsaasNotFound(error)) return null;
        throw error;
      }
    },
    listPayments: (options) => listPayments(options),
  };
}
