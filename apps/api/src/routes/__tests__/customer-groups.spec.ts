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
    "groupBy",
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
const cancelPortalInvitationAsService = vi.fn(async () => ({ success: true }));
const removePortalMemberAsService = vi.fn(async () => ({ success: true }));
const enforceClientPortalMembershipBoundary = vi.fn(async () => undefined);

vi.mock("../../lib/portal-service-account", () => ({
  createClientOrganizationAsServiceOwner,
  createPortalInvitationAsService,
  cancelPortalInvitationAsService,
  removePortalMemberAsService,
  enforceClientPortalMembershipBoundary,
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
  cancelPortalInvitationAsService.mockClear();
  removePortalMemberAsService.mockClear();
  enforceClientPortalMembershipBoundary.mockClear();
});

describe("POST /customer-groups", () => {
  it("provisions a CLIENT org and inserts the group", async () => {
    dbQueue.push([
      { id: 5, name: "Rede X", authOrganizationId: "group-org-1" },
    ]); // insert..returning

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
    dbQueue.push([
      { id: 5, name: "Rede X", authOrganizationId: "group-org-1" },
    ]);

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

describe("GET /customer-groups/:id", () => {
  it("enriches each branch with active-instrument counts", async () => {
    dbQueue.push(
      [
        {
          id: 5,
          name: "Rede X",
          authOrganizationId: "group-org-1",
          createdAt: new Date().toISOString(),
        },
      ], // group
      [
        { id: 7, name: "Unidade A", taxId: "111" },
        { id: 8, name: "Unidade B", taxId: "222" },
      ], // branches
      [{ customerId: 7, total: 3, overdue: 1, dueSoon: 2 }], // grouped counts
    );

    const res = await customerGroupsRouter.request("/5");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branches).toHaveLength(2);
    const a = body.branches.find((b: { id: number }) => b.id === 7);
    const b = body.branches.find((b: { id: number }) => b.id === 8);
    expect(a).toMatchObject({ total: 3, overdue: 1, dueSoon: 2 });
    // A branch with no rows in the counts query defaults to zeros.
    expect(b).toMatchObject({ total: 0, overdue: 0, dueSoon: 0 });
  });

  it("returns 404 for a group in another lab", async () => {
    dbQueue.push([]); // group not found under this lab
    const res = await customerGroupsRouter.request("/5");
    expect(res.status).toBe(404);
  });
});

describe("GET /customer-groups/:id/members", () => {
  it("lists portal-visible members on the group org", async () => {
    dbQueue.push(
      [{ id: 5, authOrganizationId: "group-org-1" }], // resolveLabGroupOrg
      [
        {
          id: "m1",
          userId: "u1",
          role: "client_user",
          createdAt: new Date().toISOString(),
          userName: "QA",
          userEmail: "qa@rede.com",
          userImage: null,
        },
      ], // members
    );

    const res = await customerGroupsRouter.request("/5/members");
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });

  it("returns 404 when the group belongs to another lab", async () => {
    dbQueue.push([]); // resolveLabGroupOrg → null
    const res = await customerGroupsRouter.request("/5/members");
    expect(res.status).toBe(404);
  });

  it("is gated by the customer_group entitlement", async () => {
    featureEnabled = false;
    const res = await customerGroupsRouter.request("/5/members");
    expect(res.status).toBe(403);
  });
});

describe("POST /customer-groups/:id/invitations", () => {
  it("invites a manager on the group's portal org", async () => {
    dbQueue.push([{ id: 5, authOrganizationId: "group-org-1" }]); // resolveLabGroupOrg

    const res = await customerGroupsRouter.request("/5/invitations", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: "qa@rede.com" }),
    });
    expect(res.status).toBe(201);
    expect(enforceClientPortalMembershipBoundary).toHaveBeenCalledWith(
      "group-org-1",
    );
    expect(createPortalInvitationAsService).toHaveBeenCalledOnce();
  });

  it("returns 404 for a cross-lab group (the cross-tenant gate)", async () => {
    dbQueue.push([]); // resolveLabGroupOrg → null

    const res = await customerGroupsRouter.request("/5/invitations", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: "qa@rede.com" }),
    });
    expect(res.status).toBe(404);
    expect(createPortalInvitationAsService).not.toHaveBeenCalled();
  });
});

describe("DELETE /customer-groups/:id/members/:memberId", () => {
  it("removes a manageable portal member", async () => {
    dbQueue.push(
      [{ id: 5, authOrganizationId: "group-org-1" }], // resolveLabGroupOrg
      [{ id: "m1", role: "client_user" }], // member lookup
    );

    const res = await customerGroupsRouter.request("/5/members/m1", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(removePortalMemberAsService).toHaveBeenCalledOnce();
  });

  it("refuses to remove a non-portal (lab) member", async () => {
    dbQueue.push(
      [{ id: 5, authOrganizationId: "group-org-1" }], // resolveLabGroupOrg
      [{ id: "m1", role: "owner" }], // not a portal-manageable role
    );

    const res = await customerGroupsRouter.request("/5/members/m1", {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    expect(removePortalMemberAsService).not.toHaveBeenCalled();
  });
});
