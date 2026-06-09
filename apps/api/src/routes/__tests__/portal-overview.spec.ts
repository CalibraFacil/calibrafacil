import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Context, type Next } from "hono";

// A FIFO queue of canned query results. Each `await`ed drizzle builder pulls
// the next entry, so the order here mirrors the order the route issues queries:
// linkedCustomer, then the nine Promise.all aggregations.
const dbQueue: Array<unknown> = [];

vi.mock("@calibra-facil/db", () => {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
  ]) {
    builder[method] = () => builder;
  }
  // The builder is deliberately thenable so an `await`ed drizzle chain resolves
  // the next canned result; this is a test double, not production code.
  // oxlint-disable-next-line unicorn/no-thenable
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) =>
    Promise.resolve(dbQueue.length ? dbQueue.shift() : []).then(
      resolve,
      reject,
    );
  return { db: builder };
});

vi.mock("../../lib/portal-domains", () => ({
  resolveLabOrganizationIdByPortalHostname: vi.fn(async () => null),
}));

vi.mock("../../lib/portal-certificate-release-gate", () => ({
  applyPortalCertificateReleaseGate: vi.fn(
    async (rows: Array<{ certificateUrl: string | null }>) =>
      rows.map((row) => ({ ...row, releaseStatus: "RELEASED" as const })),
  ),
  loadPortalReleaseStatuses: vi.fn(),
}));

vi.mock("../../middleware/permission", () => {
  const setActor = async (c: Context, next: Next) => {
    c.set("session", { user: { id: "portal-user-1" } });
    c.set("member", {
      id: "member-1",
      role: "PORTAL_OWNER",
      organizationId: "client-org-1",
      organizationType: "CLIENT",
      userId: "portal-user-1",
    });
    await next();
  };

  return {
    requirePortalAuth: setActor,
    requirePortalProtected: [setActor],
    requirePermission: () => async (_c: Context, next: Next) => next(),
  };
});

const { portalRouter } = await import("../portal");

const LOCAL_ORIGIN = { origin: "http://localhost" };

beforeEach(() => {
  dbQueue.length = 0;
});

describe("GET /overview", () => {
  it("blocks requests from an unrecognized host", async () => {
    const res = await portalRouter.request("/overview");
    expect(res.status).toBe(403);
  });

  it("returns a zeroed overview when the org has no linked customer", async () => {
    dbQueue.push([]); // linkedCustomer lookup → none

    const res = await portalRouter.request("/overview", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.equipment).toEqual({
      total: 0,
      overdue: 0,
      dueSoon: 0,
      scheduled: 0,
      unscheduled: 0,
      inLab: 0,
      attention: [],
    });
    expect(body.certificates).toEqual({ available: 0, recent: [] });
    expect(body.serviceOrders.awaitingQuote).toEqual([]);
  });

  it("assembles fleet-wide counts and action lists for a linked customer", async () => {
    dbQueue.push(
      [{ id: 1, labOrganizationId: "lab-1" }], // linkedCustomer
      [
        {
          total: 12,
          overdue: 3,
          dueSoon: 2,
          scheduled: 6,
          unscheduled: 1,
          inLab: 4,
        },
      ], // equipment counts
      [
        {
          id: 5,
          name: "Paquímetro",
          tag: "EQ-5",
          nextCalibrationDate: "2026-05-20T00:00:00.000Z",
        },
      ], // attention
      [{ available: 9 }], // certificate count
      [
        {
          id: 7,
          jobId: "CAL-7",
          approvedAt: "2026-05-10T00:00:00.000Z",
          certificateUrl: "https://files/cert-7.pdf",
          assetName: "Balança",
          assetTag: "EQ-7",
        },
      ], // recent certificates (raw)
      [{ total: 4, open: 2, rejected: 1 }], // request counts
      [
        {
          id: 3,
          status: "PENDING",
          submittedAt: "2026-05-28T00:00:00.000Z",
          itemCount: 2,
        },
      ], // recent requests
      [
        {
          total: 5,
          inProgress: 3,
          awaitingQuoteApproval: 1,
          readyForPickup: 1,
        },
      ], // service order counts
      [
        {
          id: 8,
          serviceOrderNumber: "OS-8",
          status: "awaiting_quote_approval",
          openedAt: "2026-05-25T00:00:00.000Z",
          assetName: "Micrômetro",
        },
      ], // awaiting quote
      [
        {
          id: 8,
          serviceOrderNumber: "OS-8",
          status: "awaiting_quote_approval",
          openedAt: "2026-05-25T00:00:00.000Z",
          assetName: "Micrômetro",
        },
      ], // recent service orders
    );

    const res = await portalRouter.request("/overview", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.equipment.overdue).toBe(3);
    expect(body.equipment.inLab).toBe(4);
    expect(body.equipment.attention).toHaveLength(1);
    expect(body.certificates.available).toBe(9);
    expect(body.certificates.recent[0]).toMatchObject({
      jobId: "CAL-7",
      releaseStatus: "RELEASED",
      ready: true,
    });
    expect(body.requests.open).toBe(2);
    expect(body.serviceOrders.awaitingQuoteApproval).toBe(1);
    expect(body.serviceOrders.awaitingQuote).toHaveLength(1);
  });
});
