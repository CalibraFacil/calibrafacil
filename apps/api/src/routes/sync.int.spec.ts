import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { syncRouter } from "./sync";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  organization,
  user,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for syncRouter.
// Only the better-auth session is mocked (test/integration/setup.ts).
// The full chain — requireLabAuth → requireOrganization → requireOrgType("LAB") →
// withLabPermission (calibration:read / calibration:create) + resolveMemberUnitScope —
// runs for real against the seeded Postgres.
//
// Cut-line invariant: TENANT ISOLATION.
// A device for org A must never write into, nor read, another org's data.
//
// Covered:
//   REQ-SYNC-001  [HIGH RISK]  POST /push cross-tenant WRITE blocked — org-scope guard
//   REQ-SYNC-002  [HIGH RISK]  POST /push actor-scope — stray actorUserId rejected
//   REQ-SYNC-003  [HIGH RISK]  POST /push RBAC — member=403, operator=200
//   REQ-SYNC-004  [HIGH RISK]  POST /bootstrap tenant isolation — org B data absent from org A response
//   REQ-SYNC-005  [HIGH RISK]  GET  /pull  tenant isolation — org B customer absent from org A pull
//   REQ-SYNC-006               POST /push + GET /pull unauthenticated → 401

const JSON_HEADERS = { "content-type": "application/json" };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a minimal CLIENT organization + customer row owned by the given lab org.
 * Required because customer.authOrganizationId has a NOT NULL FK to organization.
 */
async function seedCustomerRow(params: {
  labOrgId: string;
  clientOrgId: string;
  name: string;
}): Promise<number> {
  await db.insert(organization).values({
    id: params.clientOrgId,
    name: `Client ${params.clientOrgId}`,
    slug: params.clientOrgId,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  const [row] = await db
    .insert(customer)
    .values({
      name: params.name,
      authOrganizationId: params.clientOrgId,
      labOrganizationId: params.labOrgId,
    })
    .returning({ id: customer.id });

  if (!row) throw new Error("seedCustomerRow: insert failed");
  return row.id;
}

/**
 * Insert a user row that is NOT a member of any organization.
 * Used to assert ACTOR_SCOPE_MISMATCH when a stray userId is supplied.
 */
async function seedStrayUser(userId: string): Promise<void> {
  await db.insert(user).values({
    id: userId,
    name: "Stray User",
    email: `${userId}@stray.test`,
  });
}

/**
 * Build a minimal but schema-valid sync event. The scope guards at lines 489,
 * 499, and 511 of sync.ts run BEFORE any payload application, so payload can
 * be an empty object for rejection-path tests.
 */
function buildSyncEvent(overrides: {
  eventId?: string;
  organizationId: string;
  unitId: number | null;
  actorUserId: string;
}): Record<string, unknown> {
  return {
    eventId: overrides.eventId ?? `evt-${Math.random().toString(36).slice(2)}`,
    entityType: "unknown_entity",
    entityId: "local-entity-1",
    operation: "noop",
    payload: {},
    occurredAt: new Date().toISOString(),
    actorUserId: overrides.actorUserId,
    organizationId: overrides.organizationId,
    unitId: overrides.unitId,
    idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
    localVersion: 0,
  };
}

/**
 * Build the minimal push request body around a list of events.
 */
function buildPushBody(events: Record<string, unknown>[]): string {
  return JSON.stringify({
    deviceId: "device-test-1",
    clientBatchId: `batch-${Math.random().toString(36).slice(2)}`,
    baseCursor: null,
    events,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe("syncRouter — real DB + real middleware (tenant isolation cut-line)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SYNC-001: Cross-tenant WRITE blocked — org-scope guard (line ~489)
  // RED-able: removing the `event.organizationId !== memberData.organizationId`
  // check at sync.ts:489 would let the event through (accepted), causing this test
  // to fail on both the rejected assertion and the customer-count check.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "REQ-SYNC-001: POST /push with event.organizationId=orgB while authed as orgA is rejected ORGANIZATION_SCOPE_MISMATCH, no DB row created for orgB",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "operator" });
      const orgB = await seedOrg({ orgId: "org-b", role: "operator" });

      // Count org B's customer rows before the push
      const beforeRows = await db
        .select({ id: customer.id })
        .from(customer)
        .where(eq(customer.labOrganizationId, orgB.orgId));
      const beforeCount = beforeRows.length;

      // Authenticate as org A, but push an event with organizationId = org B
      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

      const eventId = "evt-cross-org-001";
      const res = await syncRouter.request(
        "/push",
        {
          method: "POST",
          headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
          body: buildPushBody([
            buildSyncEvent({
              eventId,
              organizationId: orgB.orgId, // ← cross-tenant claim
              unitId: orgA.unitId,
              actorUserId: orgA.userId,
            }),
          ]),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      // The event must land in rejected with the exact scope-mismatch code
      expect(body.accepted).toHaveLength(0);
      expect(body.rejected).toHaveLength(1);
      expect(body.rejected[0].eventId).toBe(eventId);
      expect(body.rejected[0].code).toBe("ORGANIZATION_SCOPE_MISMATCH");

      // DB-verify: no new customer row for org B was created
      const afterRows = await db
        .select({ id: customer.id })
        .from(customer)
        .where(eq(customer.labOrganizationId, orgB.orgId));
      expect(afterRows).toHaveLength(beforeCount);
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SYNC-002: Actor-scope guard — stray actorUserId (not a member of org A)
  // RED-able: removing `validateSyncActorScope` at sync.ts:511 would let the event
  // through with the stray actor, causing this test to fail on the rejected assertion.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "REQ-SYNC-002: POST /push with actorUserId of a non-member stray user is rejected ACTOR_SCOPE_MISMATCH",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "operator" });

      // Seed a user that exists in the DB but is NOT a member of org A
      const strayUserId = "stray-user-not-in-org-a";
      await seedStrayUser(strayUserId);

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

      const eventId = "evt-actor-mismatch-002";
      const res = await syncRouter.request(
        "/push",
        {
          method: "POST",
          headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
          body: buildPushBody([
            buildSyncEvent({
              eventId,
              organizationId: orgA.orgId, // ← same org (passes org check)
              unitId: orgA.unitId,
              actorUserId: strayUserId, // ← not a member of org A
            }),
          ]),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      // The actor guard (not session user, not an org member) must reject it
      expect(body.accepted).toHaveLength(0);
      expect(body.rejected).toHaveLength(1);
      expect(body.rejected[0].eventId).toBe(eventId);
      expect(body.rejected[0].code).toBe("ACTOR_SCOPE_MISMATCH");
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SYNC-003: RBAC gate — member=403, operator=200
  // withLabPermission({ calibration: ["create"] }) — member role has only "read"
  // RED-able: downgrading the guard to calibration:read would let member through.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "REQ-SYNC-003a: POST /push as role=member → 403 (calibration:create denied)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "member" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await syncRouter.request(
        "/push",
        {
          method: "POST",
          headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
          body: buildPushBody([
            buildSyncEvent({
              organizationId: org.orgId,
              unitId: org.unitId,
              actorUserId: org.userId,
            }),
          ]),
        },
      );

      expect(res.status).toBe(403);
    },
  );

  it(
    "REQ-SYNC-003b: POST /push as role=operator with valid same-org empty-events batch → 200 (not 403)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "operator" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await syncRouter.request(
        "/push",
        {
          method: "POST",
          headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
          body: buildPushBody([]),
        },
      );

      // Empty batch → accepted/rejected both empty, but the response is 200 (not 403)
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accepted).toHaveLength(0);
      expect(body.rejected).toHaveLength(0);
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SEC-TAG-006: the desktop sync CREATE path (create_local_asset) persists
  // asset.lab_organization_id (denormalized from the device's own lab org), so a
  // desktop-created asset satisfies the per-org UNIQUE(lab_organization_id, tag).
  // Without setting it, the NOT NULL column would reject the insert (#638 / SEC-03b).
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "REQ-SEC-TAG-006: POST /push create_local_asset persists lab_organization_id (== the device's org)",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "operator" });
      const customerId = await seedCustomerRow({
        labOrgId: org.orgId,
        clientOrgId: "client-a1",
        name: "Acme",
      });
      const [type] = await db
        .insert(assetType)
        .values({ name: "Balança", slug: "balanca-sync", definition: [] })
        .returning({ id: assetType.id });
      if (!type) throw new Error("assetType insert failed");

      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await syncRouter.request("/push", {
        method: "POST",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: buildPushBody([
          {
            eventId: "evt-create-asset-006",
            entityType: "asset",
            entityId: "local-asset-1",
            operation: "create_local_asset",
            payload: {
              customerId,
              assetTypeId: type.id,
              name: "Balança de Bancada",
              serialNumber: "SN-SYNC-1",
              tag: "SYNC-TAG-1",
              // "Balança" trips the mass-asset heuristic → a base unit is required.
              baseMeasurementUnit: "kg",
            },
            occurredAt: new Date().toISOString(),
            actorUserId: org.userId,
            organizationId: org.orgId,
            unitId: org.unitId,
            idempotencyKey: "idem-create-asset-006",
            localVersion: 0,
          },
        ]),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rejected).toHaveLength(0);
      expect(body.accepted).toHaveLength(1);

      const [created] = await db
        .select({
          customerId: asset.customerId,
          labOrganizationId: asset.labOrganizationId,
        })
        .from(asset)
        .where(eq(asset.tag, "SYNC-TAG-1"))
        .limit(1);
      expect(created?.customerId).toBe(customerId);
      expect(created?.labOrganizationId).toBe(org.orgId);
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SEC-TAG-001 (desktop RENAME, cross-org): applyUpdateLocalAsset's tag
  // collision check was still the GLOBAL, unscoped `WHERE tag=@tag` — the same
  // bug class as the CREATE path above, on the rename path instead. Unscoped it
  // over-rejected a rename to a tag only ANOTHER lab holds (the DB now only
  // enforces UNIQUE(lab_organization_id, tag)) and re-exposed the cross-tenant
  // existence oracle. RED today: the rename is rejected TAG_ALREADY_EXISTS even
  // though org B, not org A, holds the tag.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "REQ-SEC-TAG-001: POST /push update_local_asset rename to a tag used ONLY by another org → accepted, tag persisted",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "operator" });
      const orgB = await seedOrg({ orgId: "org-b", role: "operator" });

      const customerA = await seedCustomerRow({
        labOrgId: orgA.orgId,
        clientOrgId: "client-a-rename-xorg",
        name: "Acme",
      });
      const customerB = await seedCustomerRow({
        labOrgId: orgB.orgId,
        clientOrgId: "client-b-rename-xorg",
        name: "Beta",
      });
      const [type] = await db
        .insert(assetType)
        .values({
          name: "Instrumento",
          slug: "instrumento-rename-xorg",
          definition: [],
        })
        .returning({ id: assetType.id });
      if (!type) throw new Error("assetType insert failed");

      // Org B already holds the target tag.
      await db.insert(asset).values({
        unitId: orgB.unitId,
        customerId: customerB,
        labOrganizationId: orgB.orgId,
        assetTypeId: type.id,
        name: "Ativo Org B",
        serialNumber: "SN-ORGB-RENAME",
        tag: "XORG-RENAME-TARGET",
        status: "ACTIVE",
      });

      // Org A's own asset, to be renamed.
      const [ownAsset] = await db
        .insert(asset)
        .values({
          unitId: orgA.unitId,
          customerId: customerA,
          labOrganizationId: orgA.orgId,
          assetTypeId: type.id,
          name: "Ativo Org A",
          serialNumber: "SN-ORGA-RENAME",
          tag: "ORGA-ORIGINAL-TAG",
          status: "ACTIVE",
        })
        .returning({ id: asset.id });
      if (!ownAsset) throw new Error("ownAsset insert failed");

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

      const res = await syncRouter.request("/push", {
        method: "POST",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
        body: buildPushBody([
          {
            eventId: "evt-rename-xorg-001",
            entityType: "asset",
            entityId: "local-asset-rename-xorg",
            operation: "update_local_asset",
            payload: {
              remoteId: ownAsset.id,
              tag: "XORG-RENAME-TARGET",
            },
            occurredAt: new Date().toISOString(),
            actorUserId: orgA.userId,
            organizationId: orgA.orgId,
            unitId: orgA.unitId,
            idempotencyKey: "idem-rename-xorg-001",
            localVersion: 0,
          },
        ]),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rejected).toHaveLength(0);
      expect(body.accepted).toHaveLength(1);

      const [renamed] = await db
        .select({ tag: asset.tag })
        .from(asset)
        .where(eq(asset.id, ownAsset.id))
        .limit(1);
      expect(renamed?.tag).toBe("XORG-RENAME-TARGET");

      // Both orgs now hold the tag, each scoped to its own lab org.
      const holders = await db
        .select({ id: asset.id })
        .from(asset)
        .where(eq(asset.tag, "XORG-RENAME-TARGET"));
      expect(holders).toHaveLength(2);
    },
  );

  // REQ-SEC-TAG-002 (desktop RENAME, same-org) ------------------------------
  it(
    "REQ-SEC-TAG-002: POST /push update_local_asset rename to a tag already used in the SAME org → rejected, tag unchanged",
    async () => {
      const org = await seedOrg({ orgId: "org-a", role: "operator" });
      const customerId = await seedCustomerRow({
        labOrgId: org.orgId,
        clientOrgId: "client-a-rename-same",
        name: "Acme",
      });
      const [type] = await db
        .insert(assetType)
        .values({
          name: "Instrumento",
          slug: "instrumento-rename-same",
          definition: [],
        })
        .returning({ id: assetType.id });
      if (!type) throw new Error("assetType insert failed");

      // Another asset in the SAME org already holds the target tag.
      await db.insert(asset).values({
        unitId: org.unitId,
        customerId,
        labOrganizationId: org.orgId,
        assetTypeId: type.id,
        name: "Outro Ativo",
        serialNumber: "SN-SAME-RENAME-OTHER",
        tag: "SAME-ORG-TAKEN",
        status: "ACTIVE",
      });

      const [ownAsset] = await db
        .insert(asset)
        .values({
          unitId: org.unitId,
          customerId,
          labOrganizationId: org.orgId,
          assetTypeId: type.id,
          name: "Ativo a renomear",
          serialNumber: "SN-SAME-RENAME-SELF",
          tag: "SAME-ORG-ORIGINAL",
          status: "ACTIVE",
        })
        .returning({ id: asset.id });
      if (!ownAsset) throw new Error("ownAsset insert failed");

      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await syncRouter.request("/push", {
        method: "POST",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: buildPushBody([
          {
            eventId: "evt-rename-same-002",
            entityType: "asset",
            entityId: "local-asset-rename-same",
            operation: "update_local_asset",
            payload: {
              remoteId: ownAsset.id,
              tag: "SAME-ORG-TAKEN",
            },
            occurredAt: new Date().toISOString(),
            actorUserId: org.userId,
            organizationId: org.orgId,
            unitId: org.unitId,
            idempotencyKey: "idem-rename-same-002",
            localVersion: 0,
          },
        ]),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accepted).toHaveLength(0);
      expect(body.rejected).toHaveLength(1);
      expect(body.rejected[0].code).toBe("TAG_ALREADY_EXISTS");

      const [unchanged] = await db
        .select({ tag: asset.tag })
        .from(asset)
        .where(eq(asset.id, ownAsset.id))
        .limit(1);
      expect(unchanged?.tag).toBe("SAME-ORG-ORIGINAL");
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SYNC-004: Bootstrap tenant isolation — org B data absent from org A response
  // The bootstrap handler queries customers WHERE labOrganizationId = memberData.organizationId
  // and services WHERE organizationId = memberData.organizationId.
  // RED-able: removing the WHERE org filter would expose org B's rows in org A's response.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "REQ-SYNC-004: POST /bootstrap returns only orgA's customers and services; orgB's are absent",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      // Seed a customer for each org
      const orgACustomerId = await seedCustomerRow({
        labOrgId: orgA.orgId,
        clientOrgId: "client-a1",
        name: "Alpha Client",
      });
      await seedCustomerRow({
        labOrgId: orgB.orgId,
        clientOrgId: "client-b1",
        name: "Beta Client",
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

      const res = await syncRouter.request(
        "/bootstrap",
        {
          method: "POST",
          headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
          body: JSON.stringify({ deviceId: "device-boot-001" }),
        },
      );

      expect(res.status).toBe(200);
      const body: unknown = await res.json();

      // Parse the response with Zod to avoid `as` assertions (consistent-type-assertions rule)
      const bootstrapShape = z.object({
        organization: z.object({ id: z.string() }),
        customers: z.array(z.object({ id: z.number(), name: z.string() })),
      });
      const parsed = bootstrapShape.parse(body);

      // customers array must contain org A's customer
      const customerIds = parsed.customers.map((c) => c.id);
      const customerNames = parsed.customers.map((c) => c.name);
      expect(customerIds).toContain(orgACustomerId);
      expect(customerNames).toContain("Alpha Client");

      // org B's customer must NOT be present
      expect(customerNames).not.toContain("Beta Client");

      // Organization in the response must be org A
      expect(parsed.organization.id).toBe(orgA.orgId);
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SYNC-005: Pull tenant isolation — org B customer absent from org A pull
  // loadCloudSyncEventsSince filters customers by labOrganizationId = memberData.organizationId.
  // We seed a customer for each org with updatedAt in the past, then pull with
  // cursor=1970-01-01 to fetch all records. Org B's customer must be absent.
  // RED-able: removing the WHERE org filter in loadCloudSyncEventsSince would expose
  // org B's customer in the events list.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    "REQ-SYNC-005: GET /pull returns only orgA's entities; orgB's customer entityId is absent",
    async () => {
      const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
      const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

      // Seed a customer for each org. The pull mechanism uses customer.updatedAt > cursor.
      // We seed now, then pull from epoch so both would be returned without the org filter.
      const orgACustomerId = await seedCustomerRow({
        labOrgId: orgA.orgId,
        clientOrgId: "client-a1",
        name: "Alpha Pull Client",
      });
      const orgBCustomerId = await seedCustomerRow({
        labOrgId: orgB.orgId,
        clientOrgId: "client-b1",
        name: "Beta Pull Client",
      });

      loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

      // Pull from epoch so that all records (updatedAt > 1970-01-01) are included
      const res = await syncRouter.request(
        "/pull?cursor=1970-01-01T00%3A00%3A00.000Z",
        {
          headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
        },
      );

      expect(res.status).toBe(200);
      const rawBody: unknown = await res.json();

      // Parse the response with Zod to avoid `as` assertions (consistent-type-assertions rule)
      const pullShape = z.object({
        events: z.array(
          z.object({
            entityType: z.string(),
            entityId: z.union([z.number(), z.string()]),
            payload: z.object({ name: z.string().optional() }).passthrough(),
          }),
        ),
      });
      const body = pullShape.parse(rawBody);
      const events = body.events;

      // The customer events for org A must be present
      const customerEvents = events.filter((e) => e.entityType === "customer");
      const customerEntityIds = customerEvents.map((e) => Number(e.entityId));
      expect(customerEntityIds).toContain(orgACustomerId);

      // Org B's customer entityId must NOT appear anywhere in the events
      expect(customerEntityIds).not.toContain(orgBCustomerId);

      // Additional name-level check as a second layer
      const customerNames = customerEvents
        .map((e) => e.payload?.name)
        .filter(Boolean);
      expect(customerNames).toContain("Alpha Pull Client");
      expect(customerNames).not.toContain("Beta Pull Client");
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SYNC-006: Unauthenticated requests → 401
  // ───────────────────────────────────────────────────────────────────────────
  it("REQ-SYNC-006a: POST /push unauthenticated → 401", async () => {
    logout();

    const res = await syncRouter.request(
      "/push",
      {
        method: "POST",
        headers: { ...JSON_HEADERS },
        body: buildPushBody([]),
      },
    );

    expect(res.status).toBe(401);
  });

  it("REQ-SYNC-006b: GET /pull unauthenticated → 401", async () => {
    logout();

    const res = await syncRouter.request("/pull", {
      headers: { ...JSON_HEADERS },
    });

    expect(res.status).toBe(401);
  });
});
