import { beforeEach, describe, expect, it } from "vitest";
import { financeOverviewRouter } from "./overview";
import { db } from "@calibra-facil/db";
import {
  billingDocument,
  customer,
  organization,
  subscription,
} from "@calibra-facil/db/schema";
import { inArray } from "drizzle-orm";
import { loginAs, logout } from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";

// Real-DB + real-RBAC integration test for financeOverviewRouter (GET /finance/overview).
//
// Only the better-auth session is mocked (see test/integration/setup.ts).
// withLabPermission({ financial: ["read"] }) + requireFeature("financial") run
// for real against the seeded Postgres.  This proves what the vi.mock(db) tier
// cannot: money-data tenant isolation enforced by the handler's WHERE clauses.
//
// RBAC surface:
//   GET / → withLabPermission({ financial: ["read"] })
//     "member"  → 403  (financial:read NOT granted; member role has no financial perms)
//     "admin"   → pass (financial:read granted)
//
// Feature-gate surface:
//   requireFeature("financial") checks the subscription row:
//     no subscription / FREE / STANDARD → 403 (financial feature absent on these plans)
//     PROFESSIONAL                      → pass-through
//
// Proven properties:
//   REQ-FINOVW-001  GET / returns ONLY the authed org's financial totals —
//                   two orgs each with billing documents; org B's data must not
//                   appear in org A's counts or recent-documents list.
//                   [HIGH VALUE — money data isolation]
//   REQ-FINOVW-002  GET / as "member" → 403 (financial:read absent for member role)
//   REQ-FINOVW-003  GET / as admin without a PROFESSIONAL subscription → 403
//                   (feature gate fires before business logic)
//   REQ-FINOVW-004  Unauthenticated → 401

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Inline domain seed helpers — NOT in shared seed.ts (parallel makers must not
// conflict with that file).
// ---------------------------------------------------------------------------

/** Insert a minimal CLIENT org (required for customer.authOrganizationId FK). */
async function seedClientOrg(clientOrgId: string): Promise<void> {
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });
}

/**
 * Seed a customer row owned by a lab org.
 * Returns the customer.id (needed as billingDocument.customerId FK).
 */
async function seedCustomer(params: {
  labOrgId: string;
  clientOrgId: string;
  name?: string;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);

  const [row] = await db
    .insert(customer)
    .values({
      name: params.name ?? `Customer of ${params.labOrgId}`,
      labOrganizationId: params.labOrgId,
      authOrganizationId: params.clientOrgId,
    })
    .returning({ id: customer.id });

  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

/**
 * Seed a PROFESSIONAL subscription for an org so requireFeature("financial")
 * passes.  PROFESSIONAL plan has both "financial" and "financial_integrations".
 */
async function seedProfessionalSubscription(orgId: string): Promise<void> {
  await db.insert(subscription).values({
    organizationId: orgId,
    planId: "PROFESSIONAL",
    status: "ACTIVE",
  });
}

/**
 * Seed a billing_document row scoped to an org + unit + customer.
 * Returns the inserted row's internal id and publicId.
 */
async function seedBillingDocument(params: {
  orgId: string;
  unitId: number;
  customerId: number;
  createdBy: string;
  status?: "DRAFT" | "ISSUED" | "PAID" | "OVERDUE";
  totalCents?: number;
}): Promise<{ id: number; publicId: string }> {
  const [row] = await db
    .insert(billingDocument)
    .values({
      organizationId: params.orgId,
      unitId: params.unitId,
      customerId: params.customerId,
      status: params.status ?? "DRAFT",
      dueDate: new Date("2026-12-31T00:00:00.000Z"),
      currency: "BRL",
      subtotalCents: params.totalCents ?? 100_00,
      discountCents: 0,
      totalCents: params.totalCents ?? 100_00,
      createdBy: params.createdBy,
      updatedBy: params.createdBy,
    })
    .returning({ id: billingDocument.id, publicId: billingDocument.publicId });

  if (!row) throw new Error("seedBillingDocument: insert failed");
  return { id: row.id, publicId: row.publicId };
}

// ---------------------------------------------------------------------------

describe("financeOverviewRouter — real DB + real RBAC + feature gate", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-FINOVW-001: tenant isolation — org B's billing documents must not appear
  // in org A's overview response.
  // [HIGH VALUE — money data isolation]
  // =========================================================================
  it("REQ-FINOVW-001: GET / returns only the authed org's financial totals — org B's documents excluded", async () => {
    // Two independent labs, each with PROFESSIONAL subscription.
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    await seedProfessionalSubscription(orgA.orgId);
    await seedProfessionalSubscription(orgB.orgId);

    const custA = await seedCustomer({
      labOrgId: orgA.orgId,
      clientOrgId: "client-a1",
      name: "Acme SP",
    });
    const custB = await seedCustomer({
      labOrgId: orgB.orgId,
      clientOrgId: "client-b1",
      name: "Beta Industries",
    });

    // Org A: 2 DRAFT documents
    await seedBillingDocument({
      orgId: orgA.orgId,
      unitId: orgA.unitId,
      customerId: custA,
      createdBy: orgA.userId,
      status: "DRAFT",
      totalCents: 50_00,
    });
    await seedBillingDocument({
      orgId: orgA.orgId,
      unitId: orgA.unitId,
      customerId: custA,
      createdBy: orgA.userId,
      status: "DRAFT",
      totalCents: 75_00,
    });

    // Org B: 3 DRAFT documents — must be completely invisible to org A
    await Promise.all([
      seedBillingDocument({
        orgId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        createdBy: orgB.userId,
        status: "DRAFT",
        totalCents: 200_00,
      }),
      seedBillingDocument({
        orgId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        createdBy: orgB.userId,
        status: "DRAFT",
        totalCents: 200_00,
      }),
      seedBillingDocument({
        orgId: orgB.orgId,
        unitId: orgB.unitId,
        customerId: custB,
        createdBy: orgB.userId,
        status: "DRAFT",
        totalCents: 200_00,
      }),
    ]);

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await financeOverviewRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Org A has exactly 2 DRAFT documents — not 5 (which would indicate cross-tenant leak)
    expect(body.counts.draftDocuments).toBe(2);

    // Recent documents must only carry org A's records (max 8 returned)
    expect(body.recentDocuments).toHaveLength(2);

    // Confirm every returned document belongs to org A via a direct DB check
    const returnedIds: number[] = body.recentDocuments.map(
      (d: { id: number }) => d.id,
    );
    const dbRows = await db
      .select({
        id: billingDocument.id,
        organizationId: billingDocument.organizationId,
      })
      .from(billingDocument)
      .where(inArray(billingDocument.id, returnedIds));
    expect(dbRows).toHaveLength(2);
    for (const row of dbRows) {
      expect(row.organizationId).toBe(orgA.orgId);
    }

    // Other totals: no installments or receipts seeded, so all zero
    expect(body.totals.openCents).toBe(0);
    expect(body.totals.receivedCents).toBe(0);
  });

  // =========================================================================
  // REQ-FINOVW-002: GET / as "member" → 403 (financial:read absent)
  // =========================================================================
  it("REQ-FINOVW-002: GET / as member → 403 (financial:read not granted to member role)", async () => {
    // Even with a valid subscription the "member" role has no financial perms
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    await seedProfessionalSubscription(org.orgId);

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await financeOverviewRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(403);
  });

  // =========================================================================
  // REQ-FINOVW-003: GET / as admin with FREE plan → 403 (feature gate)
  // (no subscription row → tier defaults to FREE → "financial" feature absent)
  // =========================================================================
  it("REQ-FINOVW-003: GET / as admin with no subscription (FREE plan) → 403 (requireFeature blocks financial)", async () => {
    // Admin role has financial:read permission, but no subscription row is
    // seeded → tier-guard falls back to FREE plan → hasFeature("financial")=false
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    // Intentionally no subscription — defaults to FREE

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await financeOverviewRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(403);
  });

  // =========================================================================
  // REQ-FINOVW-004: Unauthenticated → 401
  // =========================================================================
  it("REQ-FINOVW-004: unauthenticated request → 401", async () => {
    logout();
    const res = await financeOverviewRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });
});
