import { beforeEach, describe, expect, it } from "vitest";
import {
  visitJobsRouter,
  visitRescheduleRequestsRouter,
  visitsRouter,
} from "./visits";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationVisit,
  customer,
  jobAuditLog,
  organization,
  service,
  visitAuditLog,
  visitRescheduleRequest,
} from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the visits router.
// Only the better-auth session is mocked (see test/integration/setup.ts);
// withLabPermission -> requireLabAuth -> requireOrganization -> requireOrgType ->
// requirePermission and the unit-scope resolver run for real against the seeded
// Postgres. This proves what the vi.mock(db) tier cannot: tenant isolation
// enforced by the handler's WHERE clause.
//
// RBAC surface:
//   - GET / and GET /:id → withLabPermission({ request: ["read"] })
//     All lab roles (member, operator, technician, admin) have request:read.
//   - POST /:id/confirm, POST /:id/cancel, PATCH /:id, POST /:id/complete,
//     POST /:id/assign → withLabPermission({ request: ["update"] })
//     "member" role lacks request:update → 403.
//     "operator" and above have request:update → 2xx.
//
// Proven properties:
//   REQ-VISIT-001  GET / returns ONLY the authed org's visits — two orgs, exact count
//   REQ-VISIT-002  Cross-tenant GET /:id leaks no data
//   REQ-VISIT-003  POST /:id/cancel as member → 403 (RBAC gate)
//   REQ-VISIT-004  POST /:id/cancel as operator → 200, persists CANCELLED state
//   REQ-VISIT-005  POST /:id/confirm as member → 403 (RBAC gate)
//   REQ-VISIT-006  POST /:id/confirm as admin → 200, persists CONFIRMED state, org-scoped
//   REQ-VISIT-007  Unit-scope: visit in another org's unit is hidden from this org's member
//   REQ-VISIT-008  Unauthenticated → 401
//
// visitJobsRouter (remove instrument from a PROPOSED visit):
//   REQ-VISITJOB-006  DELETE soft-cancels: row survives with status CANCELED
//   REQ-VISITJOB-013  DELETE writes a job_audit_log row (action "cancel",
//                     status old/new, performedBy) — audit parity with the
//                     main job-cancel route (append-only ISO 17025 trail)
//   REQ-VISITJOB-007  Non-DRAFT job → 409, status unchanged, NO audit row

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Domain seed helpers — inline so this file stays self-contained; parallel
// makers cannot conflict with the shared seed.ts.
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
 * Seed a customer row owned by a LAB org.
 * Returns the customer.id (needed as calibration_visit.customer_id FK).
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
 * Seed a calibration_visit row scoped to an org + unit + customer.
 * status defaults to PROPOSED.  scheduledAt is required for confirm tests.
 */
async function seedVisit(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  createdBy: string;
  status?: "PROPOSED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  scheduledAt?: Date;
  technicianId?: string;
}): Promise<number> {
  const [row] = await db
    .insert(calibrationVisit)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      createdBy: params.createdBy,
      status: params.status ?? "PROPOSED",
      scheduledAt: params.scheduledAt ?? null,
      technicianId: params.technicianId ?? null,
    })
    .returning({ id: calibrationVisit.id });

  if (!row) throw new Error("seedVisit: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------

describe("visitsRouter — real DB + real RBAC middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-VISIT-001: GET / returns ONLY the authed org's visits (tenant isolation)
  // =========================================================================
  it("REQ-VISIT-001: GET / returns only the authenticated org's visits — exact count, no cross-tenant leak", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const custA = await seedCustomer({
      labOrgId: orgA.orgId,
      clientOrgId: "client-a1",
      name: "Customer Alpha",
    });
    const custB = await seedCustomer({
      labOrgId: orgB.orgId,
      clientOrgId: "client-b1",
      name: "Customer Beta",
    });

    // Seed 2 visits for org A and 1 for org B
    await seedVisit({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      customerId: custA,
      createdBy: orgA.userId,
    });
    await seedVisit({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      customerId: custA,
      createdBy: orgA.userId,
    });
    await seedVisit({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      customerId: custB,
      createdBy: orgB.userId,
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await visitsRouter.request("/", { headers: JSON_HEADERS });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Exactly 2 visits (org A's), not 3
    expect(body.pagination.total).toBe(2);
    expect(body.data).toHaveLength(2);
    // All returned records belong to org A's customer
    const customerNames = body.data.map(
      (v: { customerName: string }) => v.customerName,
    );
    expect(customerNames.every((n: string) => n === "Customer Alpha")).toBe(
      true,
    );
  });

  // =========================================================================
  // REQ-VISIT-002: Cross-tenant GET /:id — no data leak
  // =========================================================================
  it("REQ-VISIT-002: GET /:id of another org's visit → 404, no data returned", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const custB = await seedCustomer({
      labOrgId: orgB.orgId,
      clientOrgId: "client-b1",
      name: "Secret Customer B",
    });
    const visitBId = await seedVisit({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      customerId: custB,
      createdBy: orgB.userId,
    });

    // Org A tries to read org B's visit by id
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await visitsRouter.request(`/${visitBId}`, {
      headers: JSON_HEADERS,
    });

    // getScopedVisit scopes by org+unit → null → 404; org B's data never leaks
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).not.toHaveProperty("customerId");
    expect(body).not.toHaveProperty("customerName");
  });

  // =========================================================================
  // REQ-VISIT-003: POST /:id/cancel as member → 403 (insufficient role)
  // =========================================================================
  it("REQ-VISIT-003: POST /:id/cancel as member → 403 (request:update absent for member role)", async () => {
    // "member" role has request:["read"] only — no "update"
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    const cust = await seedCustomer({
      labOrgId: org.orgId,
      clientOrgId: "client-a1",
    });
    const visitId = await seedVisit({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: cust,
      createdBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await visitsRouter.request(`/${visitId}/cancel`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Should be blocked" }),
    });

    expect(res.status).toBe(403);

    // Verify the visit was NOT cancelled in the DB
    const [row] = await db
      .select({ status: calibrationVisit.status })
      .from(calibrationVisit)
      .where(eq(calibrationVisit.id, visitId));
    expect(row?.status).toBe("PROPOSED");
  });

  // =========================================================================
  // REQ-VISIT-004: POST /:id/cancel as operator → 200, persists CANCELLED
  // =========================================================================
  it("REQ-VISIT-004: POST /:id/cancel as operator → 200, visit persists as CANCELLED, org-scoped", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    const cust = await seedCustomer({
      labOrgId: org.orgId,
      clientOrgId: "client-a1",
    });
    const visitId = await seedVisit({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: cust,
      createdBy: org.userId,
      status: "PROPOSED",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await visitsRouter.request(`/${visitId}/cancel`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Client request" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("CANCELLED");
    expect(body.cancelReason).toBe("Client request");
    // Verify org scope: the returned record belongs to the calling org
    expect(body.organizationId).toBe(org.orgId);

    // Verify persisted to DB
    const [row] = await db
      .select({
        status: calibrationVisit.status,
        cancelReason: calibrationVisit.cancelReason,
      })
      .from(calibrationVisit)
      .where(eq(calibrationVisit.id, visitId));
    expect(row?.status).toBe("CANCELLED");
    expect(row?.cancelReason).toBe("Client request");
  });

  // =========================================================================
  // REQ-VISIT-005: POST /:id/confirm as member → 403
  // =========================================================================
  it("REQ-VISIT-005: POST /:id/confirm as member → 403 (request:update absent)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    const cust = await seedCustomer({
      labOrgId: org.orgId,
      clientOrgId: "client-a1",
    });
    const visitId = await seedVisit({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: cust,
      createdBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await visitsRouter.request(`/${visitId}/confirm`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        scheduledAt: "2026-07-01T09:00:00.000Z",
        technicianId: org.userId,
      }),
    });

    expect(res.status).toBe(403);
  });

  // =========================================================================
  // REQ-VISIT-006: POST /:id/confirm as admin → 200, persists CONFIRMED, org-scoped
  // =========================================================================
  it("REQ-VISIT-006: POST /:id/confirm as admin → 200, visit persists as CONFIRMED with org scope", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const cust = await seedCustomer({
      labOrgId: org.orgId,
      clientOrgId: "client-a1",
    });
    const visitId = await seedVisit({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: cust,
      createdBy: org.userId,
      status: "PROPOSED",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await visitsRouter.request(`/${visitId}/confirm`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        scheduledAt: "2026-08-15T10:00:00.000Z",
        technicianId: org.userId,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("CONFIRMED");
    expect(body.technicianId).toBe(org.userId);
    expect(body.organizationId).toBe(org.orgId);
    expect(body.unitId).toBe(org.unitId);

    // Verify persisted to DB
    const [row] = await db
      .select({
        status: calibrationVisit.status,
        technicianId: calibrationVisit.technicianId,
        organizationId: calibrationVisit.organizationId,
      })
      .from(calibrationVisit)
      .where(eq(calibrationVisit.id, visitId));
    expect(row?.status).toBe("CONFIRMED");
    expect(row?.technicianId).toBe(org.userId);
    expect(row?.organizationId).toBe(org.orgId);
  });

  // =========================================================================
  // REQ-VISIT-007: Unit-scope filtering — visit in another org's unit is hidden
  // =========================================================================
  it("REQ-VISIT-007: GET / with unit scope — visits belonging to another org's unit are excluded", async () => {
    // Two separate orgs each with their own default unit. An admin scoped to
    // org A should see only its unit's visits, not org B's.
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const custA = await seedCustomer({
      labOrgId: orgA.orgId,
      clientOrgId: "client-a1",
      name: "Customer Alpha",
    });
    const custB = await seedCustomer({
      labOrgId: orgB.orgId,
      clientOrgId: "client-b1",
      name: "Customer Beta",
    });

    // One visit per org, each in their own unit
    await seedVisit({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      customerId: custA,
      createdBy: orgA.userId,
    });
    await seedVisit({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      customerId: custB,
      createdBy: orgB.userId,
    });

    // Authenticate as org A, scoped to org A's unit
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await visitsRouter.request("/", {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(orgA.unitId),
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Only 1 visit (orgA's), org B's visit is excluded
    expect(body.pagination.total).toBe(1);
    expect(body.data).toHaveLength(1);
    const customerNames = body.data.map(
      (v: { customerName: string }) => v.customerName,
    );
    expect(customerNames).toContain("Customer Alpha");
    expect(customerNames).not.toContain("Customer Beta");
  });

  // =========================================================================
  // REQ-VISIT-008: Unauthenticated → 401
  // =========================================================================
  it("REQ-VISIT-008: unauthenticated request → 401", async () => {
    logout();
    const res = await visitsRouter.request("/", { headers: JSON_HEADERS });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// visitJobsRouter — remove instrument (soft-cancel) audit trail
// ---------------------------------------------------------------------------

/** Seed an assetType. Returns assetType.id. */
async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({
      name: `Asset Type ${slug}`,
      slug,
      definition: [],
    })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

/** Seed an asset. Returns asset.id. */
async function seedAsset(params: {
  unitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: params.customerId,
      // SEC-03b (#638): per-org tag uniqueness — derive lab org from the customer.
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${params.customerId})`,
      assetTypeId: params.assetTypeId,
      name: "Test Instrument",
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

/** Seed a service. Returns service.id. */
async function seedService(params: {
  organizationId: string;
  unitId: number;
}): Promise<number> {
  const [row] = await db
    .insert(service)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: `Service ${params.organizationId}-${params.unitId}`,
      isActive: true,
    })
    .returning({ id: service.id });
  if (!row) throw new Error("seedService: insert failed");
  return row.id;
}

/**
 * Minimal valid MethodSnapshot (matches the MethodSnapshot type defined in
 * @calibra-facil/db/schema — required NOT-NULL JSONB on calibration_job).
 */
function minimalMethodSnapshot() {
  return {
    methodId: 1,
    methodName: "Test Method",
    methodVersion: 1,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  } satisfies Record<string, unknown>;
}

/** Seed a calibration_job row linked to a visit. Returns the numeric id. */
async function seedVisitJob(params: {
  jobId: string;
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  createdBy: string;
  visitId: number;
  status?: "DRAFT" | "IN_PROGRESS";
}): Promise<number> {
  const [row] = await db
    .insert(calibrationJob)
    .values({
      jobId: params.jobId,
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      assetId: params.assetId,
      serviceId: params.serviceId,
      createdBy: params.createdBy,
      status: params.status ?? "DRAFT",
      methodSnapshot: minimalMethodSnapshot(),
      certificateName: params.jobId,
      visitId: params.visitId,
    })
    .returning({ id: calibrationJob.id });
  if (!row) throw new Error("seedVisitJob: insert failed");
  return row.id;
}

/** Full fixture: org + customer + asset + service + PROPOSED visit. */
async function seedVisitJobFixture(params: { orgId: string; userId: string }) {
  const org = await seedOrg({
    orgId: params.orgId,
    userId: params.userId,
    role: "admin",
  });
  const customerId = await seedCustomer({
    labOrgId: params.orgId,
    clientOrgId: `client-${params.orgId}`,
  });
  const assetTypeId = await seedAssetType(`at-${params.orgId}`);
  const assetId = await seedAsset({
    unitId: org.unitId,
    customerId,
    assetTypeId,
    tag: `TAG-${params.orgId}`,
  });
  const serviceId = await seedService({
    organizationId: params.orgId,
    unitId: org.unitId,
  });
  const visitId = await seedVisit({
    organizationId: params.orgId,
    unitId: org.unitId,
    customerId,
    createdBy: org.userId,
  });
  return { ...org, customerId, assetId, serviceId, visitId };
}

describe("visitJobsRouter — remove instrument audit trail (ISO/IEC 17025)", () => {
  beforeEach(async () => {
    await truncateAll();
    logout();
  });

  it("REQ-VISITJOB-006,013: DELETE soft-cancels the DRAFT job and writes a job_audit_log cancel entry", async () => {
    const fx = await seedVisitJobFixture({
      orgId: "org-vja",
      userId: "user-vja",
    });
    const jobDbId = await seedVisitJob({
      jobId: "JOB-VJA-1",
      organizationId: fx.orgId,
      unitId: fx.unitId,
      customerId: fx.customerId,
      assetId: fx.assetId,
      serviceId: fx.serviceId,
      createdBy: fx.userId,
      visitId: fx.visitId,
    });

    loginAs({ userId: fx.userId, organizationId: fx.orgId });
    const res = await visitJobsRouter.request(
      `/${fx.visitId}/jobs/${jobDbId}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);

    // Soft-cancel: the row survives with status CANCELED (never a SQL DELETE).
    const [job] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, jobDbId));
    expect(job?.status).toBe("CANCELED");

    // Audit parity with the main job-cancel route.
    const auditRows = await db
      .select()
      .from(jobAuditLog)
      .where(eq(jobAuditLog.jobId, jobDbId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "cancel",
      performedBy: fx.userId,
      changes: { status: { old: "DRAFT", new: "CANCELED" } },
    });
    expect(auditRows[0]?.reason).toContain(`visita #${fx.visitId}`);
  });

  it("REQ-VISITJOB-007: non-DRAFT job → 409, status unchanged, NO audit row", async () => {
    const fx = await seedVisitJobFixture({
      orgId: "org-vjb",
      userId: "user-vjb",
    });
    const jobDbId = await seedVisitJob({
      jobId: "JOB-VJB-1",
      organizationId: fx.orgId,
      unitId: fx.unitId,
      customerId: fx.customerId,
      assetId: fx.assetId,
      serviceId: fx.serviceId,
      createdBy: fx.userId,
      visitId: fx.visitId,
      status: "IN_PROGRESS",
    });

    loginAs({ userId: fx.userId, organizationId: fx.orgId });
    const res = await visitJobsRouter.request(
      `/${fx.visitId}/jobs/${jobDbId}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(409);

    const [job] = await db
      .select({ status: calibrationJob.status })
      .from(calibrationJob)
      .where(eq(calibrationJob.id, jobDbId));
    expect(job?.status).toBe("IN_PROGRESS");

    const auditRows = await db
      .select()
      .from(jobAuditLog)
      .where(eq(jobAuditLog.jobId, jobDbId));
    expect(auditRows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// #739 — customer reschedule requests, lab side: accept / decline endpoints,
// the SUPERSEDED-on-lab-reschedule invariant, and the re-confirm reset when
// the visit date moves. Same real-DB + real-RBAC tier as above.
// ---------------------------------------------------------------------------

/** Seed a customer reschedule request (defaults to PENDING). */
async function seedRescheduleRequest(params: {
  visitId: number;
  organizationId: string;
  customerId: number;
  requestedBy: string;
  status?: "PENDING" | "ACCEPTED" | "DECLINED" | "SUPERSEDED";
}): Promise<number> {
  const [row] = await db
    .insert(visitRescheduleRequest)
    .values({
      visitId: params.visitId,
      organizationId: params.organizationId,
      customerId: params.customerId,
      requestedBy: params.requestedBy,
      status: params.status ?? "PENDING",
      preferredWindows: [{ date: "2026-08-10", period: "MORNING" }],
      reason: "Planta parada",
    })
    .returning({ id: visitRescheduleRequest.id });
  if (!row) throw new Error("seedRescheduleRequest: insert failed");
  return row.id;
}

describe("visitRescheduleRequestsRouter (#739) — real DB + real RBAC middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function seedVisitWithRequest(params?: {
    customerConfirmed?: boolean;
  }) {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const custId = await seedCustomer({
      labOrgId: org.orgId,
      clientOrgId: "client-a1",
      name: "Customer Alpha",
    });
    const scheduledAt = new Date("2026-08-01T12:00:00.000Z");
    const visitId = await seedVisit({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: custId,
      createdBy: org.userId,
      status: "CONFIRMED",
      scheduledAt,
    });
    if (params?.customerConfirmed) {
      await db
        .update(calibrationVisit)
        .set({
          customerConfirmedBy: org.userId,
          customerConfirmedAt: new Date("2026-07-20T12:00:00.000Z"),
        })
        .where(eq(calibrationVisit.id, visitId));
    }
    const requestId = await seedRescheduleRequest({
      visitId,
      organizationId: org.orgId,
      customerId: custId,
      requestedBy: org.userId,
    });
    return { org, custId, visitId, requestId, scheduledAt };
  }

  it("REQ-VRR-001: accept moves the visit, marks the request ACCEPTED and resets the customer confirmation", async () => {
    const fx = await seedVisitWithRequest({ customerConfirmed: true });

    loginAs({ userId: fx.org.userId, organizationId: fx.org.orgId });
    const res = await visitRescheduleRequestsRouter.request(
      `/${fx.visitId}/reschedule-requests/${fx.requestId}/accept`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          scheduledAt: "2026-08-10T12:00:00.000Z",
          resolutionNote: "Combinado pela manhã",
        }),
      },
    );

    expect(res.status).toBe(200);

    const [visit] = await db
      .select()
      .from(calibrationVisit)
      .where(eq(calibrationVisit.id, fx.visitId));
    expect(visit?.scheduledAt?.toISOString()).toBe("2026-08-10T12:00:00.000Z");
    // The customer confirmed the OLD date — a moved visit needs re-confirming.
    expect(visit?.customerConfirmedAt).toBeNull();
    expect(visit?.customerConfirmedBy).toBeNull();

    const [request] = await db
      .select()
      .from(visitRescheduleRequest)
      .where(eq(visitRescheduleRequest.id, fx.requestId));
    expect(request?.status).toBe("ACCEPTED");
    expect(request?.resolvedBy).toBe(fx.org.userId);
    expect(request?.resolutionNote).toBe("Combinado pela manhã");

    const auditRows = await db
      .select()
      .from(visitAuditLog)
      .where(eq(visitAuditLog.visitId, fx.visitId));
    expect(auditRows.map((row) => row.action)).toContain(
      "reschedule_request_accept",
    );
  });

  it("REQ-VRR-002: decline keeps the visit date and marks the request DECLINED with the note", async () => {
    const fx = await seedVisitWithRequest();

    loginAs({ userId: fx.org.userId, organizationId: fx.org.orgId });
    const res = await visitRescheduleRequestsRouter.request(
      `/${fx.visitId}/reschedule-requests/${fx.requestId}/decline`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ resolutionNote: "Sem agenda no mês" }),
      },
    );

    expect(res.status).toBe(200);

    const [visit] = await db
      .select()
      .from(calibrationVisit)
      .where(eq(calibrationVisit.id, fx.visitId));
    expect(visit?.scheduledAt?.toISOString()).toBe(
      fx.scheduledAt.toISOString(),
    );

    const [request] = await db
      .select()
      .from(visitRescheduleRequest)
      .where(eq(visitRescheduleRequest.id, fx.requestId));
    expect(request?.status).toBe("DECLINED");
    expect(request?.resolutionNote).toBe("Sem agenda no mês");

    const auditRows = await db
      .select()
      .from(visitAuditLog)
      .where(eq(visitAuditLog.visitId, fx.visitId));
    expect(auditRows.map((row) => row.action)).toContain(
      "reschedule_request_decline",
    );
  });

  it("REQ-VRR-003: resolving an already-resolved request → 409", async () => {
    const fx = await seedVisitWithRequest();

    loginAs({ userId: fx.org.userId, organizationId: fx.org.orgId });
    const decline = () =>
      visitRescheduleRequestsRouter.request(
        `/${fx.visitId}/reschedule-requests/${fx.requestId}/decline`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({}),
        },
      );
    expect((await decline()).status).toBe(200);
    expect((await decline()).status).toBe(409);
  });

  it("REQ-VRR-004 [HIGH RISK]: cross-tenant accept → 404, nothing written", async () => {
    const fx = await seedVisitWithRequest();
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    loginAs({ userId: orgB.userId, organizationId: orgB.orgId });
    const res = await visitRescheduleRequestsRouter.request(
      `/${fx.visitId}/reschedule-requests/${fx.requestId}/accept`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ scheduledAt: "2026-08-10T12:00:00.000Z" }),
      },
    );
    expect(res.status).toBe(404);

    const [request] = await db
      .select()
      .from(visitRescheduleRequest)
      .where(eq(visitRescheduleRequest.id, fx.requestId));
    expect(request?.status).toBe("PENDING");
  });

  it("REQ-VRR-005: RBAC — member (no request:update) cannot accept → 403", async () => {
    // "member" role has request:["read"] only — no "update".
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    const custId = await seedCustomer({
      labOrgId: org.orgId,
      clientOrgId: "client-a1",
    });
    const visitId = await seedVisit({
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId: custId,
      createdBy: org.userId,
      status: "CONFIRMED",
      scheduledAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    const requestId = await seedRescheduleRequest({
      visitId,
      organizationId: org.orgId,
      customerId: custId,
      requestedBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await visitRescheduleRequestsRouter.request(
      `/${visitId}/reschedule-requests/${requestId}/accept`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ scheduledAt: "2026-08-10T12:00:00.000Z" }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("REQ-VRR-010: lab PATCH reschedule supersedes the pending request and resets the customer confirmation", async () => {
    const fx = await seedVisitWithRequest({ customerConfirmed: true });

    loginAs({ userId: fx.org.userId, organizationId: fx.org.orgId });
    const res = await visitsRouter.request(`/${fx.visitId}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ scheduledAt: "2026-08-15T12:00:00.000Z" }),
    });

    expect(res.status).toBe(200);

    const [request] = await db
      .select()
      .from(visitRescheduleRequest)
      .where(eq(visitRescheduleRequest.id, fx.requestId));
    expect(request?.status).toBe("SUPERSEDED");
    expect(request?.resolvedBy).toBe(fx.org.userId);

    const [visit] = await db
      .select()
      .from(calibrationVisit)
      .where(eq(calibrationVisit.id, fx.visitId));
    expect(visit?.customerConfirmedAt).toBeNull();
  });

  it("REQ-VRR-011: lab PATCH without a date change keeps the pending request and the confirmation", async () => {
    const fx = await seedVisitWithRequest({ customerConfirmed: true });

    loginAs({ userId: fx.org.userId, organizationId: fx.org.orgId });
    const res = await visitsRouter.request(`/${fx.visitId}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ notes: "levar escada" }),
    });

    expect(res.status).toBe(200);

    const [request] = await db
      .select()
      .from(visitRescheduleRequest)
      .where(eq(visitRescheduleRequest.id, fx.requestId));
    expect(request?.status).toBe("PENDING");

    const [visit] = await db
      .select()
      .from(calibrationVisit)
      .where(eq(calibrationVisit.id, fx.visitId));
    expect(visit?.customerConfirmedAt).not.toBeNull();
  });

  it("REQ-VRR-012: GET / flags rescheduleRequested and filters by it", async () => {
    const fx = await seedVisitWithRequest();
    // A second visit without any request.
    const plainVisitId = await seedVisit({
      organizationId: fx.org.orgId,
      unitId: fx.org.unitId,
      customerId: fx.custId,
      createdBy: fx.org.userId,
      status: "CONFIRMED",
      scheduledAt: new Date("2026-09-01T12:00:00.000Z"),
    });

    loginAs({ userId: fx.org.userId, organizationId: fx.org.orgId });

    const all = await visitsRouter.request("/", { headers: JSON_HEADERS });
    expect(all.status).toBe(200);
    const allBody = await all.json();
    expect(allBody.data).toHaveLength(2);
    const flagged = new Map(
      allBody.data.map((v: { id: number; rescheduleRequested: boolean }) => [
        v.id,
        v.rescheduleRequested,
      ]),
    );
    expect(flagged.get(fx.visitId)).toBe(true);
    expect(flagged.get(plainVisitId)).toBe(false);

    const filtered = await visitsRouter.request("/?rescheduleRequested=true", {
      headers: JSON_HEADERS,
    });
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json();
    expect(filteredBody.data).toHaveLength(1);
    expect(filteredBody.data[0].id).toBe(fx.visitId);
  });
});
