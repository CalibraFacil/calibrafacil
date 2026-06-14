import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Context, type Next } from "hono";

// FIFO queue of canned drizzle results (see portal-overview.spec.ts).
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
    "insert",
    "values",
    "returning",
    "update",
    "set",
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

const createClientOrganizationAsServiceOwner = vi.fn(async () => ({
  id: "group-org-1",
}));
const createPortalInvitationAsService = vi.fn(async () => ({ id: "inv-1" }));

vi.mock("../../lib/portal-service-account", () => ({
  createClientOrganizationAsServiceOwner,
  createPortalInvitationAsService,
  PortalServiceAccountError: class extends Error {},
}));

let featureEnabled = true;

vi.mock("../../middleware/permission", () => {
  const labMiddleware = async (c: Context, next: Next) => {
    c.set("session", { user: { id: "lab-user-1" } });
    c.set("member", { organizationId: "lab-1", userId: "lab-user-1" });
    await next();
  };
  return {
    withLabPermission: () => [labMiddleware],
  };
});

vi.mock("../../middleware/tier-guard", () => ({
  requireFeature: () => async (c: Context, next: Next) => {
    if (!featureEnabled) {
      return c.json({ error: "feature" }, 403);
    }
    return next();
  },
}));

const { customerGroupsRouter } = await import("../customer-groups");

const JSON_HEADERS = { "content-type": "application/json" };

beforeEach(() => {
  dbQueue.length = 0;
  featureEnabled = true;
  createClientOrganizationAsServiceOwner.mockClear();
  createPortalInvitationAsService.mockClear();
});

describe("POST /customer-groups", () => {
  it("provisions a CLIENT org and inserts the group", async () => {
    dbQueue.push([{ id: 5, name: "Rede X", authOrganizationId: "group-org-1" }]); // insert..returning

    const res = await customerGroupsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Rede X" }),
    });
    expect(res.status).toBe(201);
    expect(createClientOrganizationAsServiceOwner).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body).toMatchObject({ id: 5, name: "Rede X" });
  });

  it("invites the unified manager when an email is given", async () => {
    dbQueue.push([{ id: 5, name: "Rede X", authOrganizationId: "group-org-1" }]);

    const res = await customerGroupsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Rede X", email: "qa@rede.com" }),
    });
    expect(res.status).toBe(201);
    expect(createPortalInvitationAsService).toHaveBeenCalledOnce();
  });

  it("is gated by the customer_group entitlement", async () => {
    featureEnabled = false;
    const res = await customerGroupsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Rede X" }),
    });
    expect(res.status).toBe(403);
    expect(createClientOrganizationAsServiceOwner).not.toHaveBeenCalled();
  });
});

describe("POST /customer-groups/:id/branches", () => {
  it("rejects a branch from another lab (cross-tenant guard)", async () => {
    dbQueue.push(
      [{ id: 5 }], // group found in this lab
      [], // branch NOT found under this lab
    );

    const res = await customerGroupsRouter.request("/5/branches", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ customerId: 99 }),
    });
    expect(res.status).toBe(404);
  });

  it("assigns an in-lab branch to the group", async () => {
    dbQueue.push(
      [{ id: 5 }], // group
      [{ id: 7, groupId: null }], // branch in this lab
      [], // update
      [], // audit insert
    );

    const res = await customerGroupsRouter.request("/5/branches", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ customerId: 7 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});
