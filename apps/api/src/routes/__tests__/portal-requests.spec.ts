import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Context, type Next } from "hono";

// Canned results for SELECT chains (FIFO) and for insert().returning() (FIFO).
const dbQueue: Array<unknown> = [];
const insertReturns: Array<unknown> = [];

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
  // SELECT chains resolve the next canned result.
  // oxlint-disable-next-line unicorn/no-thenable
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) =>
    Promise.resolve(dbQueue.length ? dbQueue.shift() : []).then(
      resolve,
      reject,
    );
  builder.execute = () => Promise.resolve([]);
  builder.insert = () => {
    const ins: Record<string, unknown> = {
      values: () => ins,
      returning: () =>
        Promise.resolve(insertReturns.length ? insertReturns.shift() : []),
      // Awaiting an insert without .returning() (items/audit) resolves to undefined.
      // oxlint-disable-next-line unicorn/no-thenable
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(undefined).then(resolve),
    };
    return ins;
  };
  builder.transaction = (callback: (tx: typeof builder) => Promise<unknown>) =>
    callback(builder);
  return { db: builder };
});

vi.mock("../../lib/portal-domains", () => ({
  resolveLabOrganizationIdByPortalHostname: vi.fn(async () => null),
}));

const notifyCalibrationRequestSubmitted = vi.fn(async () => undefined);
vi.mock("@calibra-facil/notifications", () => ({
  notifyCalibrationRequestSubmitted,
}));

vi.mock("../../middleware/permission", () => {
  const setActor = async (c: Context, next: Next) => {
    c.set("session", { user: { id: "portal-user-1" } });
    c.set("member", {
      id: "member-1",
      role: "PORTAL_OWNER",
      organizationId: "group-org-1",
      organizationType: "CLIENT",
      userId: "portal-user-1",
    });
    await next();
  };
  return {
    requirePortalProtected: [setActor],
    requirePermission: () => async (_c: Context, next: Next) => next(),
  };
});

const { portalRequestsRouter } = await import("../portal-requests");

const JSON_HEADERS = {
  origin: "http://localhost",
  "content-type": "application/json",
};

// Resolver (group mode): no direct customer, a group, then its branches.
function pushGroupScope() {
  dbQueue.push(
    [], // resolver: not a direct customer
    [{ id: 3, labOrganizationId: "lab-1" }], // resolver: group org
    [
      { id: 10, name: "Norte", labOrganizationId: "lab-1" },
      { id: 11, name: "Sul", labOrganizationId: "lab-1" },
    ], // resolver: branches
  );
}

beforeEach(() => {
  dbQueue.length = 0;
  insertReturns.length = 0;
  notifyCalibrationRequestSubmitted.mockClear();
});

describe("POST /requests/batch", () => {
  it("splits a cross-unit selection into one request per (customer, unit)", async () => {
    pushGroupScope();
    dbQueue.push(
      [
        {
          id: 100,
          unitId: 1,
          customerId: 10,
          authOrganizationId: "org-10",
          labOrganizationId: "lab-1",
        },
        {
          id: 200,
          unitId: 2,
          customerId: 11,
          authOrganizationId: "org-11",
          labOrganizationId: "lab-1",
        },
      ], // assets
      [], // tx: existing active items (none)
    );
    insertReturns.push(
      [{ id: 501, status: "PENDING" }], // request for (10,1)
      [{ id: 502, status: "PENDING" }], // request for (11,2)
    );

    const res = await portalRequestsRouter.request("/batch", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ assetIds: [100, 200], deliveryMethod: "dropoff" }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.created).toHaveLength(2);
    expect(
      body.created.map((r: { customerId: number }) => r.customerId),
    ).toEqual([10, 11]);
    expect(notifyCalibrationRequestSubmitted).toHaveBeenCalledTimes(2);
  });

  it("rejects when an asset is out of the customer scope (count mismatch)", async () => {
    pushGroupScope();
    dbQueue.push([
      {
        id: 100,
        unitId: 1,
        customerId: 10,
        authOrganizationId: "org-10",
        labOrganizationId: "lab-1",
      },
    ]); // only 1 of 2 assets in scope

    const res = await portalRequestsRouter.request("/batch", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ assetIds: [100, 999], deliveryMethod: "dropoff" }),
    });
    expect(res.status).toBe(400);
    expect(notifyCalibrationRequestSubmitted).not.toHaveBeenCalled();
  });

  it("is all-or-nothing when any asset already has an active request", async () => {
    pushGroupScope();
    dbQueue.push(
      [
        {
          id: 100,
          unitId: 1,
          customerId: 10,
          authOrganizationId: "org-10",
          labOrganizationId: "lab-1",
        },
      ], // assets
      [{ assetId: 100 }], // tx: existing active item → abort
    );

    const res = await portalRequestsRouter.request("/batch", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ assetIds: [100], deliveryMethod: "dropoff" }),
    });
    expect(res.status).toBe(400);
    expect(notifyCalibrationRequestSubmitted).not.toHaveBeenCalled();
  });
});
