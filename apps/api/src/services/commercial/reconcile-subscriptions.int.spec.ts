import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import {
  operatorAlert,
  organization,
  subscription,
  type SubscriptionStatus,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../../test/integration/db";
import {
  reconcileProviderSubscriptions,
  type AsaasReconciliationPort,
} from "./reconcile-subscriptions";
import type {
  AsaasPayment,
  AsaasPaymentList,
  AsaasSubscription,
  AsaasSubscriptionStatus,
} from "../asaas/types";

// REQ-REL-ASA-002: the reconciliation job detects subscriptions whose LOCAL state
// diverges from ASAAS and corrects/alerts. The canonical loss it guards against
// (issue #651): a cancel at ASAAS whose webhook was lost leaves the local
// subscription ACTIVE indefinitely. Runs against the ephemeral Docker Postgres
// with an injected fake provider port (no network).

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

function remoteSubscription(
  id: string,
  status: AsaasSubscriptionStatus,
): AsaasSubscription {
  return {
    id,
    customer: `cus_${id}`,
    billingType: "PIX",
    value: 1499,
    nextDueDate: "2026-02-01",
    cycle: "MONTHLY",
    status,
    dateCreated: "2026-01-01",
  };
}

function overduePayment(id: string): AsaasPayment {
  return {
    id,
    customer: "cus_x",
    billingType: "PIX",
    value: 1499,
    dueDate: "2026-01-10",
    status: "OVERDUE",
  };
}

function fakePort(config: {
  subscriptions: Record<string, AsaasSubscription | null>;
  overdueCount?: Record<string, number>;
}): AsaasReconciliationPort {
  return {
    async getSubscription(id) {
      if (!(id in config.subscriptions)) {
        throw new Error(`fakePort: unexpected getSubscription(${id})`);
      }
      return config.subscriptions[id] ?? null;
    },
    async listPayments(options): Promise<AsaasPaymentList> {
      const subId = options.subscription ?? "";
      const count =
        options.status === "OVERDUE" ? (config.overdueCount?.[subId] ?? 0) : 0;
      const data = Array.from({ length: count }, (_, i) =>
        overduePayment(`pay_${subId}_${i}`),
      );
      return {
        object: "list",
        hasMore: false,
        totalCount: count,
        limit: options.limit ?? 10,
        offset: 0,
        data,
      };
    },
  };
}

async function seedSubscription(params: {
  orgId: string;
  providerSubscriptionId: string | null;
  status: SubscriptionStatus;
}): Promise<number> {
  await db.insert(organization).values({
    id: params.orgId,
    name: `Lab ${params.orgId}`,
    slug: params.orgId,
    type: "LAB",
    status: "ACTIVE",
    createdAt: FIXED_NOW,
  });
  const [row] = await db
    .insert(subscription)
    .values({
      organizationId: params.orgId,
      planId: "STANDARD",
      status: params.status,
      billingCycle: "MONTHLY",
      providerSubscriptionId: params.providerSubscriptionId,
    })
    .returning({ id: subscription.id });
  if (!row) throw new Error("seedSubscription: insert failed");
  return row.id;
}

async function subRow(id: number) {
  const [row] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.id, id));
  return row;
}

async function alertsFor(orgId: string) {
  return db
    .select()
    .from(operatorAlert)
    .where(eq(operatorAlert.organizationId, orgId));
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("reconcileProviderSubscriptions (REQ-REL-ASA-002)", () => {
  it("REQ-REL-ASA-002 detects a subscription CANCELED at ASAAS while locally ACTIVE, corrects to CANCELED, and alerts", async () => {
    const subId = await seedSubscription({
      orgId: "org-cancel",
      providerSubscriptionId: "sub_cancel",
      status: "ACTIVE",
    });

    const summary = await reconcileProviderSubscriptions(
      fakePort({
        subscriptions: {
          sub_cancel: remoteSubscription("sub_cancel", "INACTIVE"),
        },
      }),
      { now: FIXED_NOW },
    );

    expect(summary.checked).toBe(1);
    expect(summary.diverged).toBe(1);
    expect(summary.corrected).toBe(1);
    expect(summary.divergences[0]).toMatchObject({
      subscriptionId: subId,
      organizationId: "org-cancel",
      localStatus: "ACTIVE",
      expectedStatus: "CANCELED",
    });

    const row = await subRow(subId);
    expect(row?.status).toBe("CANCELED");
    expect(row?.canceledAt).not.toBeNull();
    expect(row?.cancelReason).toBeTruthy();

    const alerts = await alertsFor("org-cancel");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe("critical");
    expect(alerts[0]?.kind).toBe("subscription_provider_divergence");
  });

  it("REQ-REL-ASA-002 treats a subscription MISSING at ASAAS (404 → null) as canceled", async () => {
    const subId = await seedSubscription({
      orgId: "org-missing",
      providerSubscriptionId: "sub_missing",
      status: "PAST_DUE",
    });

    const summary = await reconcileProviderSubscriptions(
      fakePort({ subscriptions: { sub_missing: null } }),
      { now: FIXED_NOW },
    );

    expect(summary.corrected).toBe(1);
    const row = await subRow(subId);
    expect(row?.status).toBe("CANCELED");
    expect(row?.cancelReason).toContain("not_found");
  });

  it("REQ-REL-ASA-002 is idempotent — a second run over an already-corrected subscription is a no-op", async () => {
    const subId = await seedSubscription({
      orgId: "org-idem",
      providerSubscriptionId: "sub_idem",
      status: "ACTIVE",
    });
    const port = fakePort({
      subscriptions: { sub_idem: remoteSubscription("sub_idem", "EXPIRED") },
    });

    const first = await reconcileProviderSubscriptions(port, {
      now: FIXED_NOW,
    });
    expect(first.corrected).toBe(1);

    const second = await reconcileProviderSubscriptions(port, {
      now: FIXED_NOW,
    });
    // The subscription is now CANCELED, so it is no longer an active-state row the
    // reconciler loads → nothing to check, nothing to correct.
    expect(second.checked).toBe(0);
    expect(second.corrected).toBe(0);

    const row = await subRow(subId);
    expect(row?.status).toBe("CANCELED");
    // Still exactly one alert (dedupeKey upsert, no duplication across runs).
    expect(await alertsFor("org-idem")).toHaveLength(1);
  });

  it("REQ-REL-ASA-002 leaves an in-sync ACTIVE subscription untouched and raises no alert", async () => {
    const subId = await seedSubscription({
      orgId: "org-sync",
      providerSubscriptionId: "sub_sync",
      status: "ACTIVE",
    });

    const summary = await reconcileProviderSubscriptions(
      fakePort({
        subscriptions: { sub_sync: remoteSubscription("sub_sync", "ACTIVE") },
        overdueCount: { sub_sync: 0 },
      }),
      { now: FIXED_NOW },
    );

    expect(summary.checked).toBe(1);
    expect(summary.diverged).toBe(0);
    expect(summary.corrected).toBe(0);

    expect((await subRow(subId))?.status).toBe("ACTIVE");
    expect(await alertsFor("org-sync")).toHaveLength(0);
  });

  it("REQ-REL-ASA-002 marks an ACTIVE subscription PAST_DUE when ASAAS reports an OVERDUE payment (via listPayments)", async () => {
    const subId = await seedSubscription({
      orgId: "org-overdue",
      providerSubscriptionId: "sub_overdue",
      status: "ACTIVE",
    });

    const summary = await reconcileProviderSubscriptions(
      fakePort({
        subscriptions: {
          sub_overdue: remoteSubscription("sub_overdue", "ACTIVE"),
        },
        overdueCount: { sub_overdue: 1 },
      }),
      { now: FIXED_NOW },
    );

    expect(summary.corrected).toBe(1);
    expect(summary.divergences[0]).toMatchObject({
      expectedStatus: "PAST_DUE",
      localStatus: "ACTIVE",
    });

    expect((await subRow(subId))?.status).toBe("PAST_DUE");
    const alerts = await alertsFor("org-overdue");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe("warning");
  });
});
