import { CURRENT_DESKTOP_BUILD } from "../../../../test/integration/desktop-build";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { syncRouter } from "./";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  assetType,
  customer,
  organization,
  organizationEventLog,
  referenceStandard,
  referenceStandardCertificateDocument,
  syncAppliedEvent,
  user,
} from "@calibra-facil/db/schema";
import { syncBootstrapPageResponseSchema } from "@calibra-facil/contracts";
import { eq, sql } from "drizzle-orm";
import { loginAs, logout } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

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
//                              (the pull's isolation is REQ-18I-PULL-1 in sync-lab-scope.int.spec.ts)
//   REQ-SYNC-006               POST /push + GET /pull unauthenticated → 401
//                              (the pull cursor and tombstones are sync-change-seq.int.spec.ts)
//   REQ-SYNC-PUSH-UNKNOWN-001  POST /push unknown op rejected, not acknowledged
//   REQ-SYNC-PUSH-DEDUP-001    POST /push retried op id deduplicated
//   REQ-SYNC-PUSH-DEDUP-002..006 concurrent / in-flight / abandoned / rejected / died-late claims
//   REQ-SYNC-PUSH-REMOTEID-001 POST /push remote id lookup not capped by an unordered LIMIT

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
  await withStatusRepair((tx) =>
    tx.insert(organization).values({
      id: params.clientOrgId,
      name: `Client ${params.clientOrgId}`,
      slug: params.clientOrgId,
      type: "CLIENT",
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  );

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
    ...CURRENT_DESKTOP_BUILD,
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
  it("REQ-SYNC-001: POST /push with event.organizationId=orgB while authed as orgA is rejected ORGANIZATION_SCOPE_MISMATCH, no DB row created for orgB", async () => {
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
    const res = await syncRouter.request("/push", {
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
    });

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
  });

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SYNC-002: Actor-scope guard — stray actorUserId (not a member of org A)
  // RED-able: removing `validateSyncActorScope` at sync.ts:511 would let the event
  // through with the stray actor, causing this test to fail on the rejected assertion.
  // ───────────────────────────────────────────────────────────────────────────
  it("REQ-SYNC-002: POST /push with actorUserId of a non-member stray user is rejected ACTOR_SCOPE_MISMATCH", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "operator" });

    // Seed a user that exists in the DB but is NOT a member of org A
    const strayUserId = "stray-user-not-in-org-a";
    await seedStrayUser(strayUserId);

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

    const eventId = "evt-actor-mismatch-002";
    const res = await syncRouter.request("/push", {
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
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // The actor guard (not session user, not an org member) must reject it
    expect(body.accepted).toHaveLength(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].eventId).toBe(eventId);
    expect(body.rejected[0].code).toBe("ACTOR_SCOPE_MISMATCH");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SYNC-003: RBAC — decided per event (sync-operation-permissions.int.spec.ts):
  // a member (read-only) is refused SYNC_PERMISSION_DENIED, an operator is not.
  // RED-able: dropping the per-event check would let the member's event through.
  // ───────────────────────────────────────────────────────────────────────────
  it("REQ-SYNC-003a: POST /push as role=member → the event is refused SYNC_PERMISSION_DENIED (P0-2: decided per operation, not by one gate)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: buildPushBody([
        {
          ...buildSyncEvent({
            organizationId: org.orgId,
            unitId: org.unitId,
            actorUserId: org.userId,
          }),
          entityType: "asset",
          operation: "create_local_asset",
        },
      ]),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([
      expect.objectContaining({ code: "SYNC_PERMISSION_DENIED" }),
    ]);
  });

  it("REQ-SYNC-003b: POST /push as role=operator with valid same-org empty-events batch → 200 (not 403)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: buildPushBody([]),
    });

    // Empty batch → accepted/rejected both empty, but the response is 200 (not 403)
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toHaveLength(0);
    expect(body.rejected).toHaveLength(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SEC-TAG-006: the desktop sync CREATE path (create_local_asset) persists
  // asset.lab_organization_id (denormalized from the device's own lab org), so a
  // desktop-created asset satisfies the per-org UNIQUE(lab_organization_id, tag).
  // Without setting it, the NOT NULL column would reject the insert.
  // ───────────────────────────────────────────────────────────────────────────
  it("REQ-SEC-TAG-006: POST /push create_local_asset persists lab_organization_id (== the device's org)", async () => {
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
  });

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SEC-TAG-001/002 (desktop CREATE, tag uniqueness): the tag collision check is
  // scoped to the device's laboratory (the DB enforces UNIQUE(lab_organization_id, tag)).
  // Unscoped it would over-reject a tag only ANOTHER lab holds and re-expose a
  // cross-tenant existence oracle. (The rename path, `update_local_asset`, is retired;
  // the create path is the one a desktop still writes.)
  // ───────────────────────────────────────────────────────────────────────────
  async function seedTagFixture(slug: string) {
    const [type] = await db
      .insert(assetType)
      .values({ name: "Instrumento", slug, definition: [] })
      .returning({ id: assetType.id });
    if (!type) throw new Error("assetType insert failed");
    return type.id;
  }

  async function pushCreateAsset(
    org: { userId: string; orgId: string; unitId: number },
    event: { eventId: string; customerId: number; typeId: number; tag: string },
  ) {
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: buildPushBody([
        {
          eventId: event.eventId,
          entityType: "asset",
          entityId: `local-${event.eventId}`,
          operation: "create_local_asset",
          payload: {
            customerId: event.customerId,
            assetTypeId: event.typeId,
            name: "Ativo novo",
            serialNumber: `SN-${event.eventId}`,
            tag: event.tag,
          },
          occurredAt: new Date().toISOString(),
          actorUserId: org.userId,
          organizationId: org.orgId,
          unitId: org.unitId,
          idempotencyKey: `idem-${event.eventId}`,
          localVersion: 0,
        },
      ]),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  it("REQ-SEC-TAG-001: POST /push create_local_asset with a tag used ONLY by another org → accepted, tag persisted", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "operator" });
    const orgB = await seedOrg({ orgId: "org-b", role: "operator" });
    const customerA = await seedCustomerRow({
      labOrgId: orgA.orgId,
      clientOrgId: "client-a-tag-xorg",
      name: "Acme",
    });
    const customerB = await seedCustomerRow({
      labOrgId: orgB.orgId,
      clientOrgId: "client-b-tag-xorg",
      name: "Beta",
    });
    const typeId = await seedTagFixture("instrumento-tag-xorg");

    // Org B already holds the tag.
    await withStatusRepair((tx) =>
      tx.insert(asset).values({
        unitId: orgB.unitId,
        customerId: customerB,
        labOrganizationId: orgB.orgId,
        assetTypeId: typeId,
        name: "Ativo Org B",
        serialNumber: "SN-ORGB-TAG",
        tag: "XORG-TAG-TARGET",
        status: "ACTIVE",
      }),
    );

    const body = await pushCreateAsset(orgA, {
      eventId: "evt-tag-xorg-001",
      customerId: customerA,
      typeId,
      tag: "XORG-TAG-TARGET",
    });
    expect(body.rejected).toHaveLength(0);
    expect(body.accepted).toHaveLength(1);

    // Both orgs now hold the tag, each scoped to its own lab org.
    const holders = await db
      .select({ org: asset.labOrganizationId })
      .from(asset)
      .where(eq(asset.tag, "XORG-TAG-TARGET"));
    expect(holders.map((row) => row.org).toSorted()).toEqual([
      orgA.orgId,
      orgB.orgId,
    ]);
  });

  it("REQ-SEC-TAG-002: POST /push create_local_asset with a tag already used in the SAME org → rejected, nothing created", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    const customerId = await seedCustomerRow({
      labOrgId: org.orgId,
      clientOrgId: "client-a-tag-same",
      name: "Acme",
    });
    const typeId = await seedTagFixture("instrumento-tag-same");
    await withStatusRepair((tx) =>
      tx.insert(asset).values({
        unitId: org.unitId,
        customerId,
        labOrganizationId: org.orgId,
        assetTypeId: typeId,
        name: "Outro Ativo",
        serialNumber: "SN-SAME-TAG-OTHER",
        tag: "SAME-ORG-TAKEN",
        status: "ACTIVE",
      }),
    );

    const body = await pushCreateAsset(org, {
      eventId: "evt-tag-same-002",
      customerId,
      typeId,
      tag: "SAME-ORG-TAKEN",
    });
    expect(body.accepted).toHaveLength(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].code).toBe("TAG_ALREADY_EXISTS");
    expect(
      await db
        .select({ id: asset.id })
        .from(asset)
        .where(eq(asset.tag, "SAME-ORG-TAKEN")),
    ).toHaveLength(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SYNC-004: Bootstrap tenant isolation — org B data absent from org A response
  // The bootstrap handler queries customers WHERE labOrganizationId = memberData.organizationId
  // and services WHERE organizationId = memberData.organizationId.
  // RED-able: removing the WHERE org filter would expose org B's rows in org A's response.
  // ───────────────────────────────────────────────────────────────────────────
  it("REQ-SYNC-004: POST /bootstrap returns only orgA's customers and services; orgB's are absent", async () => {
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

    const res = await syncRouter.request("/bootstrap", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
      body: JSON.stringify({ protocolVersion: 3 }),
    });

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
  });

  it("REQ-SYNC-PULL-005: the bootstrap pages exclude a soft-deleted asset and standard (the pull sends them as tombstones: sync-change-seq.int.spec.ts)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const customerId = await seedCustomerRow({
      labOrgId: org.orgId,
      clientOrgId: "client-del",
      name: "Acme Del",
    });
    const [type] = await db
      .insert(assetType)
      .values({ name: "Termômetro", slug: "termometro-del", definition: [] })
      .returning({ id: assetType.id });
    if (!type) throw new Error("assetType insert failed");
    const deletedAt = new Date(Date.UTC(2026, 0, 2, 12, 0, 0));
    const [liveAsset] = await withStatusRepair((tx) =>
      tx
        .insert(asset)
        .values({
          unitId: org.unitId,
          customerId,
          labOrganizationId: org.orgId,
          assetTypeId: type.id,
          name: "Ativo",
          serialNumber: "SN-LIVE",
          tag: "TAG-LIVE",
        })
        .returning({ id: asset.id }),
    );
    await withStatusRepair((tx) =>
      tx.insert(asset).values({
        unitId: org.unitId,
        customerId,
        labOrganizationId: org.orgId,
        assetTypeId: type.id,
        name: "Apagado",
        serialNumber: "SN-DEL",
        tag: "TAG-DEL",
        deletedAt,
      }),
    );
    await withStatusRepair((tx) =>
      tx.insert(referenceStandard).values({
        unitId: org.unitId,
        organizationId: org.orgId,
        name: "Padrão apagado",
        serialNumber: "STD-DEL",
        certificateNumber: "CERT-DEL",
        calibrationDate: new Date(Date.UTC(2025, 0, 1)),
        nextCalibrationDate: new Date(Date.UTC(2027, 0, 1)),
        createdBy: org.userId,
        deletedAt,
      }),
    );
    if (!liveAsset) throw new Error("seed failed");

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const bootstrap = await syncRouter.request("/bootstrap", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ protocolVersion: 3 }),
    });
    expect(bootstrap.status).toBe(200);
    const snapshot = z
      .object({
        assets: z.array(z.object({ id: z.number() })),
        standards: z.array(z.object({ id: z.number() })),
      })
      .parse(await bootstrap.json());
    expect(snapshot.assets.map((row) => row.id)).toEqual([liveAsset.id]);
    expect(snapshot.standards).toEqual([]);
  });

  it("REQ-SYNC-BOOTSTRAP-STD: a bootstrap page carries a standard's certified values and its current certificate document", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const [standard] = await withStatusRepair((tx) =>
      tx
        .insert(referenceStandard)
        .values({
          unitId: org.unitId,
          organizationId: org.orgId,
          name: "Mass set",
          kind: "mass_set",
          serialNumber: "STD-100",
          certificateNumber: "CERT-100",
          calibratedBy: "Trace Lab",
          calibrationDate: new Date(Date.UTC(2026, 0, 1)),
          nextCalibrationDate: new Date(Date.UTC(2027, 0, 1)),
          uncertainty: 0.001,
          createdBy: org.userId,
          certifiedValues: [
            {
              nominal: "1 kg",
              authentication: "A",
              value: 1000,
              uncertainty: 0.005,
              unit: "g",
              maxError: 0.01,
              drift: 0.001,
              buoyancy: 0.0002,
              coverageFactor: 2,
              compositionProfile: true,
              profileKey: "1 kg stack",
              profileClass: "M1",
              profileQuantityAvailable: 1,
            },
          ],
        })
        .returning({ id: referenceStandard.id }),
    );
    if (!standard) throw new Error("standard insert failed");
    await db.insert(referenceStandardCertificateDocument).values({
      standardId: standard.id,
      organizationId: org.orgId,
      unitId: org.unitId,
      certificateNumber: "CERT-100",
      calibrationDate: new Date(Date.UTC(2026, 0, 1)),
      nextCalibrationDate: new Date(Date.UTC(2027, 0, 1)),
      fileName: "cert-100.pdf",
      contentType: "application/pdf",
      fileSize: 1024,
      sha256: "a".repeat(64),
      r2Key: "standards/cert-100.pdf",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const response = await syncRouter.request("/bootstrap", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ protocolVersion: 3 }),
    });
    expect(response.status).toBe(200);
    const page = syncBootstrapPageResponseSchema.parse(await response.json());
    expect(page.standards).toEqual([
      expect.objectContaining({
        id: standard.id,
        kind: "mass_set",
        calibratedBy: "Trace Lab",
        uncertainty: 0.001,
        certifiedValues: [
          expect.objectContaining({ nominal: "1 kg", value: 1000 }),
        ],
        certificateDocument: expect.objectContaining({
          fileName: "cert-100.pdf",
        }),
      }),
    ]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Unknown ops must be rejected, never acknowledged
  // ───────────────────────────────────────────────────────────────────────────
  it("REQ-SYNC-PUSH-UNKNOWN-001: POST /push with an unknown entity/operation is rejected UNSUPPORTED_SYNC_OPERATION and leaves no audit row", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: buildPushBody([
        buildSyncEvent({
          eventId: "evt-unknown-op-001",
          organizationId: org.orgId,
          unitId: org.unitId,
          actorUserId: org.userId,
        }),
      ]),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toHaveLength(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].eventId).toBe("evt-unknown-op-001");
    expect(body.rejected[0].code).toBe("UNSUPPORTED_SYNC_OPERATION");

    // An audit row would make a retry look "already applied".
    const audit = await db
      .select({ id: organizationEventLog.id })
      .from(organizationEventLog)
      .where(eq(organizationEventLog.entityId, "local-entity-1"));
    expect(audit).toHaveLength(0);
  });

  it("REQ-SYNC-PUSH-UNKNOWN-002 (Q69): the retired audit-only certificate-draft marker is refused as unsupported, like an attachment that names no uploaded file (sync-attachments.int.spec.ts)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: buildPushBody([
        {
          ...buildSyncEvent({
            eventId: "evt-attachment-001",
            organizationId: org.orgId,
            unitId: org.unitId,
            actorUserId: org.userId,
          }),
          entityType: "attachment",
          operation: "create_local_attachment",
        },
        {
          ...buildSyncEvent({
            eventId: "evt-draft-001",
            organizationId: org.orgId,
            unitId: org.unitId,
            actorUserId: org.userId,
          }),
          entityType: "certificate_draft",
          operation: "create_local_certificate_draft",
        },
      ]),
    });

    const body = await res.json();
    // An attachment event that names no uploaded file is no longer acknowledged.
    expect(body.accepted).toHaveLength(0);
    expect(body.rejected).toHaveLength(2);
    expect(body.rejected[0].eventId).toBe("evt-attachment-001");
    expect(body.rejected[1].eventId).toBe("evt-draft-001");
    expect(body.rejected[1].code).toBe("UNSUPPORTED_SYNC_OPERATION");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Push idempotency: a retried op id is acknowledged, not re-applied
  // ───────────────────────────────────────────────────────────────────────────
  it("REQ-SYNC-PUSH-DEDUP-001: a retried op id is deduplicated even when its entity has more than 100 audit rows", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    for (let index = 0; index < 150; index += 1) {
      await db.insert(organizationEventLog).values({
        organizationId: org.orgId,
        action: "desktop_sync.save_local_execution",
        entityType: "calibration_job",
        entityId: "local-busy-job",
        details: { eventId: `evt-other-${index}` },
      });
    }
    await db.insert(organizationEventLog).values({
      organizationId: org.orgId,
      action: "desktop_sync.save_local_execution",
      entityType: "calibration_job",
      entityId: "local-busy-job",
      details: { eventId: "evt-retried" },
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    // Applying this event would be rejected (empty payload): it can only be
    // acknowledged because the lookup finds the earlier application.
    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: buildPushBody([
        {
          eventId: "evt-retried",
          entityType: "asset",
          entityId: "local-busy-job",
          operation: "create_local_asset",
          payload: {},
          occurredAt: new Date().toISOString(),
          actorUserId: org.userId,
          organizationId: org.orgId,
          unitId: org.unitId,
          idempotencyKey: "idem-retried",
          localVersion: 0,
        },
      ]),
    });

    const body = await res.json();
    expect(body.rejected).toHaveLength(0);
    expect(body.accepted).toHaveLength(1);
    expect(body.accepted[0].eventId).toBe("evt-retried");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Replay dedup under concurrency (sync_applied_event)
  // ───────────────────────────────────────────────────────────────────────────
  // A create op that is NOT idempotent by itself apart from the tag unique
  // index: applied twice it would write the asset and its audit log twice.
  async function seedAssetCreateContext(orgId: string, suffix: string) {
    const customerId = await seedCustomerRow({
      labOrgId: orgId,
      clientOrgId: `client-${suffix}`,
      name: "Acme",
    });
    const [type] = await db
      .insert(assetType)
      .values({
        name: "Balança",
        slug: `balanca-${suffix}`,
        definition: [],
      })
      .returning({ id: assetType.id });
    if (!type) throw new Error("assetType insert failed");
    return { customerId, assetTypeId: type.id };
  }

  function createAssetEvent(
    org: { orgId: string; unitId: number; userId: string },
    eventId: string,
    context: { customerId: number; assetTypeId: number },
    tag: string,
  ): Record<string, unknown> {
    return {
      eventId,
      entityType: "asset",
      entityId: `local-asset-${eventId}`,
      operation: "create_local_asset",
      payload: {
        customerId: context.customerId,
        assetTypeId: context.assetTypeId,
        name: "Balança de Bancada",
        serialNumber: `SN-${tag}`,
        tag,
        baseMeasurementUnit: "kg",
      },
      occurredAt: new Date().toISOString(),
      actorUserId: org.userId,
      organizationId: org.orgId,
      unitId: org.unitId,
      idempotencyKey: `idem-${eventId}`,
      localVersion: 0,
    };
  }

  function pushRequest(org: { unitId: number }, events: unknown[]) {
    return syncRouter.request("/push", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: buildPushBody(events.map((event) => ({ ...Object(event) }))),
    });
  }

  it("REQ-SYNC-PUSH-DEDUP-002: concurrent pushes of the same op id apply it exactly once", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const context = await seedAssetCreateContext(org.orgId, "race");
    const event = createAssetEvent(org, "evt-concurrent", context, "RACE-1");

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => pushRequest(org, [event])),
    );
    const bodies = await Promise.all(responses.map((res) => res.json()));

    const created = await db
      .select({ id: asset.id })
      .from(asset)
      .where(eq(asset.tag, "RACE-1"));
    expect(created).toHaveLength(1);
    const audits = await db
      .select({ id: assetAuditLog.id })
      .from(assetAuditLog)
      .where(eq(assetAuditLog.assetId, created[0]?.id ?? -1));
    expect(audits).toHaveLength(1);

    // Whoever did not apply it is told the op is in flight (retry) or already
    // applied: no request other than the winner tried to apply it again (that
    // would surface as TAG_ALREADY_EXISTS), and no second success appears for
    // a different entity.
    for (const body of bodies) {
      for (const rejection of body.rejected) {
        expect(rejection.code).toBe("SYNC_EVENT_IN_PROGRESS");
      }
    }
    const acceptedIds = bodies.flatMap((body) =>
      body.accepted.map(
        (entry: { remoteEntityId: number }) => entry.remoteEntityId,
      ),
    );
    expect(acceptedIds.length).toBeGreaterThanOrEqual(1);
    expect(new Set(acceptedIds)).toEqual(new Set([created[0]?.id]));

    const rows = await db
      .select()
      .from(syncAppliedEvent)
      .where(eq(syncAppliedEvent.eventId, "evt-concurrent"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appliedAt).not.toBeNull();

    // A later retry is acknowledged from the record, with the same entity.
    const retry = await (await pushRequest(org, [event])).json();
    expect(retry.accepted).toHaveLength(1);
    expect(retry.accepted[0].remoteEntityId).toBe(created[0]?.id);
  });

  it("REQ-SYNC-PUSH-DEDUP-003: an op claimed by a request still in flight is not applied again", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const context = await seedAssetCreateContext(org.orgId, "inflight");
    await db.insert(syncAppliedEvent).values({
      organizationId: org.orgId,
      eventId: "evt-inflight",
      entityType: "asset",
      entityId: "local-asset-evt-inflight",
    });

    const body = await (
      await pushRequest(org, [
        createAssetEvent(org, "evt-inflight", context, "INFLIGHT-1"),
      ])
    ).json();

    expect(body.accepted).toHaveLength(0);
    expect(body.rejected[0].code).toBe("SYNC_EVENT_IN_PROGRESS");
    const created = await db
      .select({ id: asset.id })
      .from(asset)
      .where(eq(asset.tag, "INFLIGHT-1"));
    expect(created).toHaveLength(0);
  });

  it("REQ-SYNC-PUSH-DEDUP-004: a claim abandoned past the lease is taken over and applied", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const context = await seedAssetCreateContext(org.orgId, "abandoned");
    await db.insert(syncAppliedEvent).values({
      organizationId: org.orgId,
      eventId: "evt-abandoned",
      entityType: "asset",
      entityId: "local-asset-evt-abandoned",
      claimedAt: sql`now() - interval '1 hour'`,
    });

    const body = await (
      await pushRequest(org, [
        createAssetEvent(org, "evt-abandoned", context, "ABANDONED-1"),
      ])
    ).json();

    expect(body.rejected).toHaveLength(0);
    expect(body.accepted).toHaveLength(1);
    const rows = await db
      .select()
      .from(syncAppliedEvent)
      .where(eq(syncAppliedEvent.eventId, "evt-abandoned"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appliedAt).not.toBeNull();
  });

  it("REQ-SYNC-PUSH-DEDUP-006: an abandoned claim whose op already wrote its audit row is completed, not re-applied", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const context = await seedAssetCreateContext(org.orgId, "diedlate");
    const [existing] = await withStatusRepair((tx) =>
      tx
        .insert(asset)
        .values({
          unitId: org.unitId,
          customerId: context.customerId,
          labOrganizationId: org.orgId,
          assetTypeId: context.assetTypeId,
          name: "Nome original",
          serialNumber: "SN-DL",
          tag: "DIEDLATE-1",
        })
        .returning({ id: asset.id }),
    );
    if (!existing) throw new Error("seed failed");
    // A creation that already applied and wrote its audit row (the last thing an
    // op does); the process died before marking the claim applied, and the
    // lease has since run out. Applying it again would create the instrument again.
    await db.insert(organizationEventLog).values({
      organizationId: org.orgId,
      action: "desktop_sync.create_local_asset",
      entityType: "asset",
      entityId: "local-asset-diedlate",
      details: { eventId: "evt-diedlate", remoteEntityId: existing.id },
    });
    await db.insert(syncAppliedEvent).values({
      organizationId: org.orgId,
      eventId: "evt-diedlate",
      entityType: "asset",
      entityId: "local-asset-diedlate",
      claimedAt: sql`now() - interval '1 hour'`,
    });

    const body = await (
      await pushRequest(org, [
        {
          eventId: "evt-diedlate",
          entityType: "asset",
          entityId: "local-asset-diedlate",
          operation: "create_local_asset",
          payload: {
            customerId: context.customerId,
            assetTypeId: context.assetTypeId,
            name: "Nome do replay",
            serialNumber: "SN-DL-REPLAY",
            tag: "DIEDLATE-REPLAY",
          },
          occurredAt: new Date().toISOString(),
          actorUserId: org.userId,
          organizationId: org.orgId,
          unitId: org.unitId,
          idempotencyKey: "idem-diedlate",
          localVersion: 1,
        },
      ])
    ).json();

    expect(body.rejected).toHaveLength(0);
    expect(body.accepted).toHaveLength(1);
    expect(body.accepted[0].remoteEntityId).toBe(existing.id);
    // Not applied again: no second instrument, the first untouched.
    expect(
      await db
        .select({ id: asset.id })
        .from(asset)
        .where(eq(asset.tag, "DIEDLATE-REPLAY")),
    ).toEqual([]);
    const [after] = await db
      .select({ name: asset.name })
      .from(asset)
      .where(eq(asset.id, existing.id));
    expect(after?.name).toBe("Nome original");
    const [claim] = await db
      .select()
      .from(syncAppliedEvent)
      .where(eq(syncAppliedEvent.eventId, "evt-diedlate"));
    expect(claim?.appliedAt).not.toBeNull();
    expect(claim?.result).toMatchObject({ remoteEntityId: existing.id });
  });

  it("REQ-SYNC-PUSH-DEDUP-005: an op that is rejected leaves no claim, so the corrected event can be pushed again", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const context = await seedAssetCreateContext(org.orgId, "rejected");

    const rejected = await (
      await pushRequest(org, [
        {
          ...createAssetEvent(org, "evt-bad", context, "BAD-1"),
          payload: {},
        },
      ])
    ).json();
    expect(rejected.rejected).toHaveLength(1);
    expect(
      await db
        .select()
        .from(syncAppliedEvent)
        .where(eq(syncAppliedEvent.eventId, "evt-bad")),
    ).toHaveLength(0);

    const fixed = await (
      await pushRequest(org, [
        createAssetEvent(org, "evt-bad", context, "BAD-1"),
      ])
    ).json();
    expect(fixed.accepted).toHaveLength(1);
  });

  it("REQ-SYNC-PUSH-REMOTEID-001: the remote id of a busy entity is found even when it is not among its first 20 audit rows", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    const customerId = await seedCustomerRow({
      labOrgId: org.orgId,
      clientOrgId: "client-busy",
      name: "Acme",
    });
    const [type] = await db
      .insert(assetType)
      .values({ name: "Balança", slug: "balanca-busy", definition: [] })
      .returning({ id: assetType.id });
    if (!type) throw new Error("assetType insert failed");

    // Many audit rows for this local id that carry no remote id come first...
    for (let index = 0; index < 30; index += 1) {
      await db.insert(organizationEventLog).values({
        organizationId: org.orgId,
        action: "desktop_sync.save_local_execution",
        entityType: "asset",
        entityId: "local-busy-asset",
        details: { eventId: `evt-noise-${index}` },
      });
    }
    // ...and the one that maps it to the cloud asset comes last.
    await db.insert(organizationEventLog).values({
      organizationId: org.orgId,
      action: "desktop_sync.create_local_asset",
      entityType: "asset",
      entityId: "local-busy-asset",
      details: { eventId: "evt-created-earlier", remoteEntityId: 424242 },
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: buildPushBody([
        {
          eventId: "evt-create-again",
          entityType: "asset",
          entityId: "local-busy-asset",
          operation: "create_local_asset",
          payload: {
            customerId,
            assetTypeId: type.id,
            name: "Balança de Bancada",
            serialNumber: "SN-BUSY-1",
            tag: "BUSY-TAG-1",
            baseMeasurementUnit: "kg",
          },
          occurredAt: new Date().toISOString(),
          actorUserId: org.userId,
          organizationId: org.orgId,
          unitId: org.unitId,
          idempotencyKey: "idem-create-again",
          localVersion: 0,
        },
      ]),
    });

    const body = await res.json();
    expect(body.rejected).toHaveLength(0);
    expect(body.accepted).toHaveLength(1);
    expect(body.accepted[0].remoteEntityId).toBe(424242);
    const created = await db
      .select({ id: asset.id })
      .from(asset)
      .where(eq(asset.tag, "BUSY-TAG-1"));
    expect(created).toHaveLength(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // REQ-SYNC-006: Unauthenticated requests → 401
  // ───────────────────────────────────────────────────────────────────────────
  it("REQ-SYNC-006a: POST /push unauthenticated → 401", async () => {
    logout();

    const res = await syncRouter.request("/push", {
      method: "POST",
      headers: { ...JSON_HEADERS },
      body: buildPushBody([]),
    });

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
