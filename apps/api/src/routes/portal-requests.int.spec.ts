import { beforeEach, describe, expect, it } from "vitest";
import { portalRequestsRouter } from "./portal-requests";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationRequest,
  calibrationRequestItem,
} from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { loginAsPortal, logoutPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedPortalContext,
  seedPortalCustomer,
} from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the CLIENT PORTAL calibration-request
// endpoints (portal-requests.ts) — the customer-facing tenant boundary. Only the
// portal better-auth getSession is mocked (see test/integration/setup.ts); the
// full guard chain runs for real against a seeded Postgres:
//   requirePortalProtected = [requirePortalAuth, requireOrganization,
//                             requirePortalAccess]  (permission.ts:915)
// plus requirePermission({ request: [...] }) resolving locally from the seeded
// `client_user` role, plus resolvePortalCustomerScope (portal-customer-scope.ts).
//
// The property this proves — that the fast vi.mock(db) tier cannot — is customer
// isolation enforced by the handler's
//   inArray(calibrationRequest.customerId, scope.customerIds)
// WHERE clause (portal-requests.ts:133 list, :251 detail) and, on create, the
// customerId being bound from the session scope (linkedCustomer.id) rather than
// any client-supplied value, with cross-customer assets rejected (:321).

// The portal resolves the host lab from the request Origin (getPortalLabScope).
// A default/local host yields labScope=null (resolveLabOrganizationIdByPortalHostname
// returns null for an unknown host), which is the clean path: scope is then
// resolved purely from customer.authOrganizationId.
const LOCAL_ORIGIN = { origin: "http://localhost" };

// ---------------------------------------------------------------------------
// Inline domain seed helpers — kept local (not in shared seed.ts) so the harness
// files inherited from the base branch stay UNCHANGED.
// ---------------------------------------------------------------------------

/** A global asset type (asset rows need one). */
async function ensureAssetType(): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({
      name: "Balança Digital",
      slug: "balanca-digital",
      definition: [],
    })
    .returning({ id: assetType.id });
  if (!row) throw new Error("ensureAssetType: insert failed");
  return row.id;
}

/** Seed an ACTIVE asset owned by a customer, unit-scoped to the lab. */
async function seedAsset(params: {
  labUnitId: number;
  customerId: number;
  assetTypeId: number;
  name: string;
  tag: string;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.labUnitId,
      customerId: params.customerId,
      // SEC-03b (#638): per-org tag uniqueness — derive lab org from the customer.
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${params.customerId})`,
      assetTypeId: params.assetTypeId,
      name: params.name,
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
      status: "ACTIVE",
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/** Seed a PENDING calibration request (with no items) for a customer. */
async function seedRequest(params: {
  labOrgId: string;
  labUnitId: number;
  customerId: number;
  clientOrgId: string;
  submittedBy: string;
  observations?: string;
}): Promise<number> {
  const [row] = await db
    .insert(calibrationRequest)
    .values({
      organizationId: params.labOrgId,
      unitId: params.labUnitId,
      customerId: params.customerId,
      authOrganizationId: params.clientOrgId,
      submittedBy: params.submittedBy,
      status: "PENDING",
      observations: params.observations ?? null,
    })
    .returning({ id: calibrationRequest.id });
  if (!row) throw new Error("seedRequest: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------

describe("portalRequestsRouter — real DB + real portal middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-PR-001 [HIGH RISK]: a portal session scoped to customer-A sees ONLY
  // customer-A's requests. Customer-B (same lab) is seeded with a request that
  // WOULD appear if the `inArray(..customerId, scope.customerIds)` list scope
  // (portal-requests.ts:133) regressed — assert it is ABSENT. The leak row is
  // the SOLE discriminator: both customers share the lab, so only the customerId
  // filter separates them.
  // =========================================================================
  it("REQ-PR-001: list for customer-A returns only customer-A's requests (customer isolation)", async () => {
    const ctxA = await seedPortalContext({
      labOrgId: "portal-lab-1",
      clientOrgId: "portal-client-a",
      portalUserId: "portal-user-a",
      customerName: "Customer A",
    });
    const customerBId = await seedPortalCustomer({
      labOrgId: ctxA.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });

    // Customer A: exactly one request (the only row that should be in scope).
    const reqAId = await seedRequest({
      labOrgId: ctxA.labOrgId,
      labUnitId: ctxA.labUnitId,
      customerId: ctxA.customerId,
      clientOrgId: ctxA.clientOrgId,
      submittedBy: ctxA.portalUserId,
      observations: "Solicitação do cliente A",
    });

    // Customer B: TWO requests (strictly more than A) — the leak rows. A scope
    // regression that drops the customerId filter would surface these and change
    // the count + ids returned.
    const reqB1Id = await seedRequest({
      labOrgId: ctxA.labOrgId,
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      clientOrgId: "portal-client-b",
      submittedBy: "portal-user-b",
      observations: "Solicitação do cliente B (1)",
    });
    const reqB2Id = await seedRequest({
      labOrgId: ctxA.labOrgId,
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      clientOrgId: "portal-client-b",
      submittedBy: "portal-user-b",
      observations: "Solicitação do cliente B (2)",
    });

    loginAsPortal({
      userId: ctxA.portalUserId,
      organizationId: ctxA.clientOrgId,
    });
    const res = await portalRequestsRouter.request("/", {
      headers: LOCAL_ORIGIN,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Customer A sees exactly ONE request — B's two rows are absent.
    expect(body.pagination.total).toBe(1);
    expect(body.data).toHaveLength(1);

    const returnedIds = body.data.map((r: { id: number }) => r.id);
    expect(returnedIds).toContain(reqAId);
    expect(returnedIds).not.toContain(reqB1Id);
    expect(returnedIds).not.toContain(reqB2Id);

    // The customerName carried by each row must be A's, never B's.
    const returnedCustomers = body.data.map(
      (r: { customerName: string }) => r.customerName,
    );
    expect(returnedCustomers).toEqual(["Customer A"]);
  });

  // =========================================================================
  // REQ-PR-001 (detail facet): GET /:id for a customer-B request from a
  // customer-A session is denied (404) — the per-row read scope
  // (portal-requests.ts:251) is the discriminator. Mutation-prove: neutralizing
  // that inArray makes the cross-customer detail readable -> RED.
  // =========================================================================
  it("REQ-PR-001: detail GET /:id cannot read another customer's request (cross-customer denied)", async () => {
    const ctxA = await seedPortalContext({
      labOrgId: "portal-lab-1",
      clientOrgId: "portal-client-a",
      portalUserId: "portal-user-a",
      customerName: "Customer A",
    });
    const customerBId = await seedPortalCustomer({
      labOrgId: ctxA.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });

    const reqBId = await seedRequest({
      labOrgId: ctxA.labOrgId,
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      clientOrgId: "portal-client-b",
      submittedBy: "portal-user-b",
      observations: "Confidencial do cliente B",
    });

    loginAsPortal({
      userId: ctxA.portalUserId,
      organizationId: ctxA.clientOrgId,
    });
    const res = await portalRequestsRouter.request(`/${reqBId}`, {
      headers: LOCAL_ORIGIN,
    });

    // Customer A must not be able to read customer B's request.
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).not.toHaveProperty("observations");
    expect(JSON.stringify(body)).not.toContain("Confidencial do cliente B");
  });

  // =========================================================================
  // REQ-PR-002 [HIGH RISK]: a portal create binds the new request to the
  // session's OWN customer scope (linkedCustomer.id, portal-requests.ts:403) and
  // rejects assets that belong to another customer (the validation at :321). The
  // request has no client-supplied customerId — the scope is the sole binder.
  //
  // Facet (a): creating a request for an asset that belongs to customer B (while
  // logged in as A) is rejected 400 — no row is created, nothing crosses tenants.
  // =========================================================================
  it("REQ-PR-002: create rejects an asset owned by another customer (cannot cross customer scope)", async () => {
    const assetTypeId = await ensureAssetType();

    const ctxA = await seedPortalContext({
      labOrgId: "portal-lab-1",
      clientOrgId: "portal-client-a",
      portalUserId: "portal-user-a",
      customerName: "Customer A",
    });
    const customerBId = await seedPortalCustomer({
      labOrgId: ctxA.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });

    // An asset owned by customer B — A must not be able to request against it.
    const assetBId = await seedAsset({
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      assetTypeId,
      name: "Balança B",
      tag: "EQ-B1",
    });

    loginAsPortal({
      userId: ctxA.portalUserId,
      organizationId: ctxA.clientOrgId,
    });
    const res = await portalRequestsRouter.request("/", {
      method: "POST",
      headers: { ...LOCAL_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ assetIds: [assetBId] }),
    });

    // The cross-customer asset is rejected and NO request row is created.
    expect(res.status).toBe(400);
    const rows = await db
      .select({ id: calibrationRequest.id })
      .from(calibrationRequest);
    expect(rows).toHaveLength(0);
  });

  // =========================================================================
  // REQ-PR-002 (facet b): a successful create binds customerId to the session's
  // OWN customer (A), not to anything the client could choose. We assert the
  // persisted row's customerId === ctxA.customerId.
  // =========================================================================
  it("REQ-PR-002: create binds the new request to the session's own customer scope", async () => {
    const assetTypeId = await ensureAssetType();

    const ctxA = await seedPortalContext({
      labOrgId: "portal-lab-1",
      clientOrgId: "portal-client-a",
      portalUserId: "portal-user-a",
      customerName: "Customer A",
    });
    // A second customer exists on the same lab; its id must NOT end up on the row.
    const customerBId = await seedPortalCustomer({
      labOrgId: ctxA.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });

    const assetAId = await seedAsset({
      labUnitId: ctxA.labUnitId,
      customerId: ctxA.customerId,
      assetTypeId,
      name: "Balança A",
      tag: "EQ-A1",
    });

    loginAsPortal({
      userId: ctxA.portalUserId,
      organizationId: ctxA.clientOrgId,
    });
    const res = await portalRequestsRouter.request("/", {
      method: "POST",
      headers: { ...LOCAL_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        assetIds: [assetAId],
        observations: "Round-trip A",
      }),
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.status).toBe("PENDING");

    // The persisted request is bound to customer A — never to customer B.
    const [persisted] = await db
      .select({
        customerId: calibrationRequest.customerId,
        authOrganizationId: calibrationRequest.authOrganizationId,
        submittedBy: calibrationRequest.submittedBy,
      })
      .from(calibrationRequest)
      .where(eq(calibrationRequest.id, created.id))
      .limit(1);

    expect(persisted?.customerId).toBe(ctxA.customerId);
    expect(persisted?.customerId).not.toBe(customerBId);
    expect(persisted?.authOrganizationId).toBe(ctxA.clientOrgId);
    expect(persisted?.submittedBy).toBe(ctxA.portalUserId);

    // The item row was created against the seeded asset.
    const items = await db
      .select({ assetId: calibrationRequestItem.assetId })
      .from(calibrationRequestItem)
      .where(eq(calibrationRequestItem.requestId, created.id));
    expect(items.map((i) => i.assetId)).toEqual([assetAId]);
  });

  // =========================================================================
  // REQ-PR-003: unauthenticated (logoutPortal -> portal getSession null) -> 401
  // via the real requirePortalAuth (permission.ts:455). No org/scope is resolved.
  // =========================================================================
  it("REQ-PR-003: unauthenticated portal list request -> 401", async () => {
    logoutPortal();
    const res = await portalRequestsRouter.request("/", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(401);
  });

  it("REQ-PR-003: unauthenticated portal create request -> 401", async () => {
    logoutPortal();
    const res = await portalRequestsRouter.request("/", {
      method: "POST",
      headers: { ...LOCAL_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ assetIds: [1] }),
    });
    expect(res.status).toBe(401);
  });

  // =========================================================================
  // Happy path: the portal user's own request list + create round-trip end to
  // end (real guards + real scope + real persistence).
  // =========================================================================
  it("returns the portal user's own request list with the expected shape", async () => {
    const assetTypeId = await ensureAssetType();

    const ctx = await seedPortalContext({
      labOrgId: "portal-lab-1",
      clientOrgId: "portal-client-a",
      portalUserId: "portal-user-a",
      customerName: "Customer A",
    });

    const assetId = await seedAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId,
      name: "Balança A",
      tag: "EQ-A1",
    });

    // Seed one request and attach the item so itemCount reflects it.
    const reqId = await seedRequest({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      clientOrgId: ctx.clientOrgId,
      submittedBy: ctx.portalUserId,
      observations: "Minha solicitação",
    });
    await db
      .insert(calibrationRequestItem)
      .values({ requestId: reqId, assetId });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalRequestsRouter.request("/", {
      headers: LOCAL_ORIGIN,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("pagination");
    expect(body.pagination.total).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: reqId,
      status: "PENDING",
      observations: "Minha solicitação",
      customerName: "Customer A",
      itemCount: 1,
    });
  });
});
