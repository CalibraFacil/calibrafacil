import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Context, type Next } from "hono";
import { portalDigestFrequenciesFor } from "@calibra-facil/shared";
import { PORTAL_NOTIFICATION_TYPES } from "@calibra-facil/schemas";

// FIFO queue of canned query results (see portal-overview.spec.ts).
const dbQueue: Array<unknown> = [];

vi.mock("@calibra-facil/db", () => {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "selectDistinct",
    "selectDistinctOn",
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
    "offset",
    "insert",
    "values",
    "onConflictDoUpdate",
    "returning",
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
    async (rows: Array<unknown>) => rows,
  ),
  loadPortalReleaseStatuses: vi.fn(),
}));

vi.mock("../../lib/asset-measurement", () => ({
  denormalizeAssetSpecificationsForResponse: vi.fn(() => null),
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
const JSON_HEADERS = { ...LOCAL_ORIGIN, "content-type": "application/json" };

beforeEach(() => {
  dbQueue.length = 0;
});

// The payload always projects exactly the whitelisted types, defaulting
// absent entries to both-channels-on (mirrors sendNotification's fallback).
const DEFAULT_PORTAL_PREFERENCES = Object.fromEntries(
  PORTAL_NOTIFICATION_TYPES.map((type) => [type, { inApp: true, email: true }]),
);

describe("GET /notification-preferences", () => {
  it("blocks requests from an unrecognized host", async () => {
    const res = await portalRouter.request("/notification-preferences");
    expect(res.status).toBe(403);
  });

  it("defaults to NONE + whitelist defaults when the user has no preference row", async () => {
    dbQueue.push([]); // preference lookup → none

    const res = await portalRouter.request("/notification-preferences", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      digestFrequency: "NONE",
      emailEnabled: true,
      preferences: DEFAULT_PORTAL_PREFERENCES,
    });
  });

  it("returns stored values, projecting only whitelisted types", async () => {
    dbQueue.push([
      {
        digestFrequency: "WEEKLY",
        emailEnabled: false,
        preferences: {
          CERTIFICATE_READY: { inApp: false, email: true },
          JOB_APPROVED: { inApp: true, email: true }, // lab-side key: never exposed
        },
      },
    ]);

    const res = await portalRouter.request("/notification-preferences", {
      headers: LOCAL_ORIGIN,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.digestFrequency).toBe("WEEKLY");
    expect(body.emailEnabled).toBe(false);
    expect(body.preferences.CERTIFICATE_READY).toEqual({
      inApp: false,
      email: true,
    });
    expect(body.preferences.VISIT_CONFIRMED).toEqual({
      inApp: true,
      email: true,
    });
    expect(body.preferences.JOB_APPROVED).toBeUndefined();
  });
});

describe("PUT /notification-preferences", () => {
  it("rejects an unknown frequency", async () => {
    const res = await portalRouter.request("/notification-preferences", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ digestFrequency: "MONTHLY" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects preference keys outside the portal whitelist", async () => {
    const res = await portalRouter.request("/notification-preferences", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        preferences: { JOB_APPROVED: { inApp: false, email: false } },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("upserts and echoes the saved payload", async () => {
    dbQueue.push([]); // existing-preferences lookup → none
    dbQueue.push([]); // insert..onConflictDoUpdate

    const res = await portalRouter.request("/notification-preferences", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ digestFrequency: "DAILY" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      digestFrequency: "DAILY",
      emailEnabled: true,
      preferences: DEFAULT_PORTAL_PREFERENCES,
    });
  });
});

describe("portalDigestFrequenciesFor", () => {
  it("includes WEEKLY only on Mondays (UTC)", () => {
    // 2026-06-15 is a Monday.
    expect(
      portalDigestFrequenciesFor(new Date("2026-06-15T09:00:00Z")),
    ).toEqual(["DAILY", "WEEKLY"]);
    // 2026-06-16 is a Tuesday.
    expect(
      portalDigestFrequenciesFor(new Date("2026-06-16T09:00:00Z")),
    ).toEqual(["DAILY"]);
    // Late Sunday UTC stays daily-only even when it's already Monday in UTC+X.
    expect(
      portalDigestFrequenciesFor(new Date("2026-06-14T23:59:00Z")),
    ).toEqual(["DAILY"]);
  });
});
