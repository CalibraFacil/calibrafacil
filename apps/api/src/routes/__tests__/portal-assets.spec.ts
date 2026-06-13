import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Context, type Next } from "hono";

// A FIFO queue of canned query results. Each `await`ed drizzle builder pulls
// the next entry, so the order here mirrors the order the route issues
// queries: linkedCustomer, count, asset page, then (when the page is
// non-empty) the latest-certificate-per-asset lookup. The in-lab EXISTS
// subqueries are embedded in SQL and never awaited, so they don't consume
// from the queue.
const dbQueue: Array<unknown> = [];

vi.mock("@calibra-facil/db", () => {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "selectDistinctOn",
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
    "offset",
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

vi.mock("../../lib/asset-measurement", () => ({
  denormalizeAssetSpecificationsForResponse: vi.fn(
    ({ specifications }: { specifications: unknown }) => specifications,
  ),
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

const { resolveLabOrganizationIdByPortalHostname } = await import(
  "../../lib/portal-domains"
);
const { portalRouter } = await import("../portal");

const LOCAL_ORIGIN = { origin: "http://localhost" };

function fleetAssetRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    customerId: 1,
    customerName: "Cliente",
    assetTypeId: 1,
    assetTypeName: "Balança",
    assetTypeSlug: "balanca",
    assetTypeDefinition: null,
    name: "Balança analítica",
    manufacturer: "Marte",
    model: "AD-500",
    serialNumber: "SN-1",
    tag: "EQ-1",
    status: "ACTIVE",
    baseMeasurementUnit: "g",
    specifications: null,
    lastCalibrationDate: "2025-12-01T00:00:00.000Z",
    nextCalibrationDate: "2026-05-01T00:00:00.000Z",
    inLab: false,
    comments: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  dbQueue.length = 0;
  vi.mocked(resolveLabOrganizationIdByPortalHostname).mockResolvedValue(null);
});

describe("GET /assets", () => {
  it("blocks requests from an unrecognized host", async () => {
    const res = await portalRouter.request("/assets");
    expect(res.status).toBe(403);
  });

  it("returns an empty page when the org has no linked customer", async () => {
    dbQueue.push([]); // linkedCustomer lookup → none

    const res = await portalRouter.request("/assets", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it("rejects a customer linked to a different lab than the portal host", async () => {
    vi.mocked(resolveLabOrganizationIdByPortalHostname).mockResolvedValue(
      "lab-A",
    );
    dbQueue.push([{ id: 1, labOrganizationId: "lab-B" }]); // linkedCustomer

    const res = await portalRouter.request("/assets", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(403);
  });

  it("rejects an unknown sortBy value", async () => {
    const res = await portalRouter.request("/assets?sortBy=serialNumber", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed ids filter", async () => {
    const res = await portalRouter.request("/assets?ids=1,abc", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(400);
  });

  it("accepts an exact-id lookup (recall preselection)", async () => {
    dbQueue.push(
      [{ id: 1, labOrganizationId: "lab-1" }], // linkedCustomer
      [{ total: 1 }], // count
      [fleetAssetRow({ id: 7, tag: "EQ-7" })], // asset page
      [], // latest certificates
    );

    const res = await portalRouter.request("/assets?ids=7,8", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: 7, tag: "EQ-7" });
  });

  it("accepts the in_lab due-status filter", async () => {
    dbQueue.push(
      [{ id: 1, labOrganizationId: "lab-1" }], // linkedCustomer
      [{ total: 0 }], // count
      [], // asset page (empty → no certificate lookup)
    );

    const res = await portalRouter.request("/assets?dueStatus=in_lab", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it("merges in-lab state and the latest certificate per instrument", async () => {
    dbQueue.push(
      [{ id: 1, labOrganizationId: "lab-1" }], // linkedCustomer
      [{ total: 2 }], // count
      [
        fleetAssetRow({ id: 1, tag: "EQ-1", inLab: true }),
        fleetAssetRow({ id: 2, tag: "EQ-2", serialNumber: "SN-2" }),
      ], // asset page
      [
        {
          assetId: 1,
          id: 10,
          jobId: "CAL-2026-10",
          approvedAt: "2025-12-02T00:00:00.000Z",
        },
      ], // latest approved certificate per asset
    );

    const res = await portalRouter.request(
      "/assets?sortBy=nextCalibrationDate&sortDir=desc",
      { headers: LOCAL_ORIGIN },
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      id: 1,
      inLab: true,
      lastCertificate: {
        id: 10,
        jobId: "CAL-2026-10",
        approvedAt: "2025-12-02T00:00:00.000Z",
      },
    });
    expect(body.data[1]).toMatchObject({
      id: 2,
      inLab: false,
      lastCertificate: null,
    });
    expect(body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
    });
  });
});
