import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { portalVisitsRouter } from "./portal-visits";
import { db } from "@calibra-facil/db";
import {
  calibrationVisit,
  visitAuditLog,
  visitRescheduleRequest,
} from "@calibra-facil/db/schema";
import { loginAsPortal, logoutPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedPortalContext,
  seedPortalCustomer,
} from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the CLIENT PORTAL on-site VISITS feed
// (GET /api/portal/visits). This is a customer-facing tenant boundary, so only the
// portal better-auth getSession is mocked (see test/integration/setup.ts);
// requirePortalAuth -> requireOrganization -> requirePortalAccess and
// resolvePortalCustomerScope all run for real against a seeded Postgres. This
// proves the property the vi.mock(db) fast tier cannot: customer isolation enforced
// by the handler's `inArray(calibrationVisit.customerId, scope.customerIds)` WHERE
// clause (portal-visits.ts:70).

// The portal resolves the host lab from the request Origin (getPortalLabScope).
// A default/local host yields labScope=null, which is the clean path: scope is then
// resolved purely from customer.authOrganizationId.
const LOCAL_ORIGIN = { origin: "http://localhost" };

// ---------------------------------------------------------------------------
// Inline domain seed helper — NOT in shared seed.ts, to keep makers conflict-free
// (mirrors how portal.int.spec.ts keeps its asset/request seeders inline).
// ---------------------------------------------------------------------------

/**
 * Seed a calibration_visit row scoped to a lab org + unit + customer. status
 * defaults to a non-CANCELLED state so the row is visible (the handler filters
 * `ne(status, "CANCELLED")`). createdBy is a notNull FK to user — reuse a seeded
 * portal user id.
 */
async function seedVisit(params: {
  labOrgId: string;
  labUnitId: number;
  customerId: number;
  createdBy: string;
  status?: "PROPOSED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  scheduledAt?: Date;
  technicianId?: string;
}): Promise<number> {
  const [row] = await db
    .insert(calibrationVisit)
    .values({
      organizationId: params.labOrgId,
      unitId: params.labUnitId,
      customerId: params.customerId,
      createdBy: params.createdBy,
      status: params.status ?? "CONFIRMED",
      scheduledAt: params.scheduledAt ?? null,
      technicianId: params.technicianId ?? null,
    })
    .returning({ id: calibrationVisit.id });
  if (!row) throw new Error("seedVisit: insert failed");
  return row.id;
}

// A schedule date relative to now, so ordering is wall-clock-independent.
function inDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------

describe("portalVisitsRouter GET / — real DB + real portal middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-PV-001 [HIGH RISK]: a portal session scoped to customer-A sees ONLY
  // customer-A's visits. A customer-B visit is seeded under the SAME lab so it
  // WOULD appear if the `inArray(calibrationVisit.customerId, scope.customerIds)`
  // scope (portal-visits.ts:70) regressed — assert it is ABSENT. The customer-B
  // visit is the sole leak row, so the contested filter is the only discriminator.
  // =========================================================================
  it("REQ-PV-001: portal session for customer-A sees only customer-A's visits (customer isolation)", async () => {
    // One shared lab owns both customers (cross-customer, same lab — the real
    // leak vector: a scope regression returns the lab's other customer too).
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

    // Customer A: exactly one visit.
    await seedVisit({
      labOrgId: ctxA.labOrgId,
      labUnitId: ctxA.labUnitId,
      customerId: ctxA.customerId,
      createdBy: ctxA.portalUserId,
      scheduledAt: inDays(7),
    });

    // Customer B: the leak row. Same lab, same shape — it would surface by
    // customerName if the customerId scope were dropped.
    await seedVisit({
      labOrgId: ctxA.labOrgId,
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      createdBy: "portal-user-b",
      scheduledAt: inDays(3),
    });

    loginAsPortal({
      userId: ctxA.portalUserId,
      organizationId: ctxA.clientOrgId,
    });
    const res = await portalVisitsRouter.request("/", {
      headers: LOCAL_ORIGIN,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Customer A has exactly ONE visit — customer B's row is absent.
    expect(body.data).toHaveLength(1);

    const customerNames = body.data.map(
      (v: { customerName: string }) => v.customerName,
    );
    expect(customerNames).toEqual(["Customer A"]);
    expect(customerNames).not.toContain("Customer B");
  });

  // =========================================================================
  // REQ-PV-002: unauthenticated (portal getSession null) -> 401 via the real
  // requirePortalAuth (permission.ts:455 throws HTTPException 401).
  // =========================================================================
  it("REQ-PV-002: unauthenticated portal request -> 401", async () => {
    logoutPortal();
    const res = await portalVisitsRouter.request("/", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(401);
  });

  // =========================================================================
  // Happy path: the portal user's own visits return the expected customer-facing
  // shape + values, and the CANCELLED visit is excluded (ne(status,"CANCELLED")).
  // =========================================================================
  it("returns the portal user's own visits with the expected shape", async () => {
    const ctx = await seedPortalContext({
      labOrgId: "portal-lab-1",
      clientOrgId: "portal-client-a",
      portalUserId: "portal-user-a",
      customerName: "Customer A",
    });

    await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "CONFIRMED",
      scheduledAt: inDays(5),
    });
    // A CANCELLED visit for the SAME customer must NOT appear (status filter).
    await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "CANCELLED",
      scheduledAt: inDays(2),
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalVisitsRouter.request("/", {
      headers: LOCAL_ORIGIN,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Only the non-cancelled visit is returned.
    expect(body.data).toHaveLength(1);

    // The customer-facing visit shape the portal "Próximas visitas" feed reads.
    const visit = body.data[0];
    expect(visit).toMatchObject({
      status: "CONFIRMED",
      customerName: "Customer A",
    });
    expect(visit).toHaveProperty("scheduledAt");
    expect(visit).toHaveProperty("address");
    expect(visit).toHaveProperty("assetCount");
    expect(visit.assetCount).toBe(0);
    // #739 customer-facing acknowledgement + reschedule state
    expect(visit).toHaveProperty("customerConfirmedAt");
    expect(visit).toHaveProperty("rescheduleRequest");
    expect(visit.rescheduleRequest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #739 — customer writes: POST /:id/confirm and POST /:id/reschedule-request.
// Same real-DB, real-middleware tier as the GET tests above. Notifications are
// best-effort (try/catch in the routes) so no mail/env is needed.
// ---------------------------------------------------------------------------

const JSON_HEADERS = { ...LOCAL_ORIGIN, "content-type": "application/json" };

describe("portalVisitsRouter writes (#739) — real DB + real portal middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-PV-010: POST /:id/confirm records the customer acknowledgement + audit row", async () => {
    const ctx = await seedPortalContext({
      labOrgId: "portal-lab-1",
      clientOrgId: "portal-client-a",
      portalUserId: "portal-user-a",
      customerName: "Customer A",
    });
    const visitId = await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "PROPOSED",
      scheduledAt: inDays(7),
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalVisitsRouter.request(`/${visitId}/confirm`, {
      method: "POST",
      headers: LOCAL_ORIGIN,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const [row] = await db
      .select()
      .from(calibrationVisit)
      .where(eq(calibrationVisit.id, visitId));
    expect(row?.customerConfirmedAt).not.toBeNull();
    expect(row?.customerConfirmedBy).toBe(ctx.portalUserId);
    // The lab lifecycle is untouched — confirmation is an annotation.
    expect(row?.status).toBe("PROPOSED");
    expect(row?.confirmedAt).toBeNull();

    const auditRows = await db
      .select()
      .from(visitAuditLog)
      .where(eq(visitAuditLog.visitId, visitId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("customer_confirm");
    expect(auditRows[0]?.performedBy).toBe(ctx.portalUserId);
  });

  it("REQ-PV-011: POST /:id/confirm is idempotent (second call 200, no extra audit row)", async () => {
    const ctx = await seedPortalContext({});
    const visitId = await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "CONFIRMED",
      scheduledAt: inDays(7),
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const first = await portalVisitsRouter.request(`/${visitId}/confirm`, {
      method: "POST",
      headers: LOCAL_ORIGIN,
    });
    expect(first.status).toBe(200);
    const second = await portalVisitsRouter.request(`/${visitId}/confirm`, {
      method: "POST",
      headers: LOCAL_ORIGIN,
    });
    expect(second.status).toBe(200);

    const auditRows = await db
      .select()
      .from(visitAuditLog)
      .where(eq(visitAuditLog.visitId, visitId));
    expect(auditRows).toHaveLength(1);
  });

  it("REQ-PV-012 [HIGH RISK]: POST /:id/confirm on another customer's visit → 404, nothing written", async () => {
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
    const visitBId = await seedVisit({
      labOrgId: ctxA.labOrgId,
      labUnitId: ctxA.labUnitId,
      customerId: customerBId,
      createdBy: "portal-user-b",
      status: "PROPOSED",
      scheduledAt: inDays(7),
    });

    loginAsPortal({
      userId: ctxA.portalUserId,
      organizationId: ctxA.clientOrgId,
    });
    const res = await portalVisitsRouter.request(`/${visitBId}/confirm`, {
      method: "POST",
      headers: LOCAL_ORIGIN,
    });

    expect(res.status).toBe(404);
    const [row] = await db
      .select()
      .from(calibrationVisit)
      .where(eq(calibrationVisit.id, visitBId));
    expect(row?.customerConfirmedAt).toBeNull();
  });

  it("REQ-PV-013: confirm guards — IN_PROGRESS → 409; past scheduledAt → 409; no date → 409", async () => {
    const ctx = await seedPortalContext({});
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const inProgressId = await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "IN_PROGRESS",
      scheduledAt: inDays(1),
    });
    const pastId = await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "CONFIRMED",
      scheduledAt: inDays(-1),
    });
    const noDateId = await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "PROPOSED",
    });

    for (const id of [inProgressId, pastId, noDateId]) {
      const res = await portalVisitsRouter.request(`/${id}/confirm`, {
        method: "POST",
        headers: LOCAL_ORIGIN,
      });
      expect(res.status).toBe(409);
    }
  });

  it("REQ-PV-020: POST /:id/reschedule-request creates a PENDING record + audit row", async () => {
    const ctx = await seedPortalContext({});
    const visitId = await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "CONFIRMED",
      scheduledAt: inDays(7),
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const res = await portalVisitsRouter.request(
      `/${visitId}/reschedule-request`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          reason: "Planta parada nesta semana",
          preferredWindows: [
            { date: "2026-07-28", period: "MORNING" },
            { date: "2026-07-29", period: "ANY", note: "após as 10h" },
          ],
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.requestId).toBe("number");

    const [request] = await db
      .select()
      .from(visitRescheduleRequest)
      .where(eq(visitRescheduleRequest.visitId, visitId));
    expect(request?.status).toBe("PENDING");
    expect(request?.requestedBy).toBe(ctx.portalUserId);
    expect(request?.reason).toBe("Planta parada nesta semana");
    expect(request?.preferredWindows).toHaveLength(2);

    const auditRows = await db
      .select()
      .from(visitAuditLog)
      .where(eq(visitAuditLog.visitId, visitId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("reschedule_request");
  });

  it("REQ-PV-021: single-pending invariant — a second reschedule-request → 409", async () => {
    const ctx = await seedPortalContext({});
    const visitId = await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "CONFIRMED",
      scheduledAt: inDays(7),
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const payload = {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "qualquer", preferredWindows: [] }),
    };
    const first = await portalVisitsRouter.request(
      `/${visitId}/reschedule-request`,
      payload,
    );
    expect(first.status).toBe(200);
    const second = await portalVisitsRouter.request(
      `/${visitId}/reschedule-request`,
      payload,
    );
    expect(second.status).toBe(409);

    const requests = await db
      .select()
      .from(visitRescheduleRequest)
      .where(eq(visitRescheduleRequest.visitId, visitId));
    expect(requests).toHaveLength(1);
  });

  it("REQ-PV-022: reschedule-request guards — terminal status → 409, cross-customer → 404", async () => {
    const ctx = await seedPortalContext({});
    const completedId = await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "COMPLETED",
      scheduledAt: inDays(-3),
    });
    const customerBId = await seedPortalCustomer({
      labOrgId: ctx.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });
    const visitBId = await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: customerBId,
      createdBy: "portal-user-b",
      status: "CONFIRMED",
      scheduledAt: inDays(7),
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const payload = {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ preferredWindows: [] }),
    };

    const terminal = await portalVisitsRouter.request(
      `/${completedId}/reschedule-request`,
      payload,
    );
    expect(terminal.status).toBe(409);

    const crossCustomer = await portalVisitsRouter.request(
      `/${visitBId}/reschedule-request`,
      payload,
    );
    expect(crossCustomer.status).toBe(404);
  });

  it("REQ-PV-023: GET / surfaces the pending reschedule request on the visit", async () => {
    const ctx = await seedPortalContext({});
    const visitId = await seedVisit({
      labOrgId: ctx.labOrgId,
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "CONFIRMED",
      scheduledAt: inDays(7),
    });

    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    await portalVisitsRouter.request(`/${visitId}/reschedule-request`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        reason: "feriado local",
        preferredWindows: [{ date: "2026-08-03", period: "AFTERNOON" }],
      }),
    });

    const res = await portalVisitsRouter.request("/", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].rescheduleRequest).toMatchObject({
      status: "PENDING",
      reason: "feriado local",
    });
    expect(body.data[0].rescheduleRequest.preferredWindows).toEqual([
      { date: "2026-08-03", period: "AFTERNOON" },
    ]);
  });
});
