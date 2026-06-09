import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Context, type Next } from "hono";

// FIFO queue of canned query results; each awaited drizzle chain shifts one.
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
  // Thenable test double so an awaited chain resolves the next canned result.
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
    async (rows: Array<{ certificateUrl: string | null }>) => rows,
  ),
  loadPortalReleaseStatuses: vi.fn(),
}));

vi.mock("../../middleware/permission", () => {
  const passthrough = async (_c: Context, next: Next) => next();
  return {
    requirePortalAuth: passthrough,
    requirePortalProtected: [passthrough],
    requirePermission: () => passthrough,
  };
});

const { portalRouter } = await import("../portal");
const { resolveLabOrganizationIdByPortalHostname } =
  await import("../../lib/portal-domains");

beforeEach(() => {
  dbQueue.length = 0;
  vi.mocked(resolveLabOrganizationIdByPortalHostname).mockReset();
  vi.mocked(resolveLabOrganizationIdByPortalHostname).mockResolvedValue(null);
});

describe("GET /branding", () => {
  it("returns the lab name + logo for a verified custom domain", async () => {
    vi.mocked(resolveLabOrganizationIdByPortalHostname).mockResolvedValueOnce(
      "lab-1",
    );
    dbQueue.push([
      { name: "Laboratório Exemplo", logo: "https://api.test/logo/exemplo" },
    ]);

    const res = await portalRouter.request("/branding", {
      headers: { origin: "https://portal.laboratorio.example" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "Laboratório Exemplo",
      logo: "https://api.test/logo/exemplo",
    });
  });

  it("returns nulls on the default portal host (no specific lab)", async () => {
    const res = await portalRouter.request("/branding", {
      headers: { origin: "https://portal.calibrafacil.com" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: null, logo: null });
  });

  it("returns nulls for an unrecognized domain", async () => {
    const res = await portalRouter.request("/branding", {
      headers: { origin: "https://unknown.example.com" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: null, logo: null });
  });

  it("returns nulls when no Origin header is present", async () => {
    const res = await portalRouter.request("/branding");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: null, logo: null });
  });
});
