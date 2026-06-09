import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Context, type Next } from "hono";

// FIFO queue of canned query results (see portal-overview.spec.ts). For
// GET /calendar the order is: linkedCustomer, then the dues query. For
// GET /certificates: userOrgs, customers, count, page.
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

beforeEach(() => {
  dbQueue.length = 0;
  vi.mocked(resolveLabOrganizationIdByPortalHostname).mockResolvedValue(null);
});

describe("GET /calendar", () => {
  it("blocks requests from an unrecognized host", async () => {
    const res = await portalRouter.request(
      "/calendar?from=2026-06-01&to=2026-06-30",
    );
    expect(res.status).toBe(403);
  });

  it("rejects a malformed date", async () => {
    const res = await portalRouter.request(
      "/calendar?from=01-06-2026&to=2026-06-30",
      { headers: LOCAL_ORIGIN },
    );
    expect(res.status).toBe(400);
  });

  it("rejects an inverted window", async () => {
    const res = await portalRouter.request(
      "/calendar?from=2026-06-30&to=2026-06-01",
      { headers: LOCAL_ORIGIN },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a window beyond the range cap", async () => {
    const res = await portalRouter.request(
      "/calendar?from=2026-01-01&to=2026-12-31",
      { headers: LOCAL_ORIGIN },
    );
    expect(res.status).toBe(400);
  });

  it("returns an empty list when the org has no linked customer", async () => {
    dbQueue.push([]); // linkedCustomer lookup → none

    const res = await portalRouter.request(
      "/calendar?from=2026-06-01&to=2026-06-30",
      { headers: LOCAL_ORIGIN },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it("rejects a customer linked to a different lab than the portal host", async () => {
    vi.mocked(resolveLabOrganizationIdByPortalHostname).mockResolvedValue(
      "lab-A",
    );
    dbQueue.push([{ id: 1, labOrganizationId: "lab-B" }]); // linkedCustomer

    const res = await portalRouter.request(
      "/calendar?from=2026-06-01&to=2026-06-30",
      { headers: LOCAL_ORIGIN },
    );
    expect(res.status).toBe(403);
  });

  it("returns the dues inside the window", async () => {
    dbQueue.push(
      [{ id: 1, labOrganizationId: "lab-1" }], // linkedCustomer
      [
        {
          id: 5,
          name: "Paquímetro",
          tag: "EQ-5",
          assetTypeName: "Paquímetro",
          nextCalibrationDate: "2026-06-12T00:00:00.000Z",
          inLab: true,
        },
      ], // dues
    );

    const res = await portalRouter.request(
      "/calendar?from=2026-06-01&to=2026-06-30",
      { headers: LOCAL_ORIGIN },
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: 5, tag: "EQ-5", inLab: true });
  });
});

describe("GET /certificates assetId filter", () => {
  it("rejects a non-numeric assetId", async () => {
    const res = await portalRouter.request("/certificates?assetId=abc", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(400);
  });

  it("scopes the list when assetId is provided", async () => {
    dbQueue.push(
      [{ orgId: "client-org-1" }], // userOrgs
      [{ id: 1 }], // customers
      [{ count: 1 }], // total
      [
        {
          id: 7,
          jobId: "CAL-7",
          certificateName: "CAL-7",
          status: "APPROVED",
          performedAt: null,
          approvedAt: "2026-05-10T00:00:00.000Z",
          certificateUrl: "https://files/cert-7.pdf",
          verificationToken: "tok",
          assetId: 3,
          assetName: "Balança",
          assetTag: "EQ-3",
          assetManufacturer: null,
          assetModel: null,
          assetSerialNumber: "SN-3",
          serviceName: "Calibração",
          labName: "Lab",
        },
      ], // page
    );

    const res = await portalRouter.request("/certificates?assetId=3", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ assetId: 3, jobId: "CAL-7" });
    expect(body.pagination.total).toBe(1);
  });
});
