import { beforeEach, describe, expect, it, vi } from "vitest";

// FIFO queue of canned drizzle results (mirrors the portal route specs). The
// resolver issues: (1) direct-customer lookup; if empty (2) group lookup then
// (3) branches lookup.
const dbQueue: Array<unknown> = [];

vi.mock("@calibra-facil/db", () => {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "limit"]) {
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

const { resolvePortalCustomerScope, applyUnitFilter } =
  await import("../portal-customer-scope");

beforeEach(() => {
  dbQueue.length = 0;
});

describe("resolvePortalCustomerScope", () => {
  it("resolves a branch customer to single mode", async () => {
    dbQueue.push([{ id: 7, name: "Filial A", labOrganizationId: "lab-1" }]);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: "client-org-7",
      labScope: "lab-1",
    });

    expect(scope).toMatchObject({
      mode: "single",
      groupId: null,
      customerIds: [7],
      labOrganizationId: "lab-1",
    });
    expect(scope?.customerById.get(7)?.name).toBe("Filial A");
  });

  it("resolves single mode without a lab scope (default host)", async () => {
    dbQueue.push([{ id: 7, name: "Filial A", labOrganizationId: "lab-1" }]);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: "client-org-7",
      labScope: null,
    });

    expect(scope?.mode).toBe("single");
    expect(scope?.customerIds).toEqual([7]);
  });

  it("returns null when the branch customer belongs to another lab", async () => {
    dbQueue.push([{ id: 7, name: "Filial A", labOrganizationId: "lab-OTHER" }]);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: "client-org-7",
      labScope: "lab-1",
    });

    expect(scope).toBeNull();
  });

  it("fans a group org out to its branches", async () => {
    dbQueue.push(
      [], // no direct customer
      [{ id: 3, labOrganizationId: "lab-1" }], // group
      [
        { id: 10, name: "Unidade Norte", labOrganizationId: "lab-1" },
        { id: 11, name: "Unidade Sul", labOrganizationId: "lab-1" },
      ], // branches
    );

    const scope = await resolvePortalCustomerScope({
      activeOrgId: "group-org-3",
      labScope: "lab-1",
    });

    expect(scope).toMatchObject({
      mode: "group",
      groupId: 3,
      customerIds: [10, 11],
      labOrganizationId: "lab-1",
    });
    expect(scope?.customerById.get(11)?.name).toBe("Unidade Sul");
  });

  it("returns a group with no branches as an empty scope", async () => {
    dbQueue.push(
      [], // no direct customer
      [{ id: 3, labOrganizationId: "lab-1" }], // group
      [], // no branches
    );

    const scope = await resolvePortalCustomerScope({
      activeOrgId: "group-org-3",
      labScope: "lab-1",
    });

    expect(scope?.mode).toBe("group");
    expect(scope?.customerIds).toEqual([]);
  });

  it("returns null when the group belongs to another lab", async () => {
    dbQueue.push(
      [], // no direct customer
      [{ id: 3, labOrganizationId: "lab-OTHER" }], // group
    );

    const scope = await resolvePortalCustomerScope({
      activeOrgId: "group-org-3",
      labScope: "lab-1",
    });

    expect(scope).toBeNull();
  });

  it("returns null when the org maps to neither a customer nor a group", async () => {
    dbQueue.push([], []);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: "unknown-org",
      labScope: "lab-1",
    });

    expect(scope).toBeNull();
  });
});

describe("applyUnitFilter", () => {
  const groupScope = {
    mode: "group" as const,
    groupId: 3,
    customerIds: [10, 11],
    customerById: new Map(),
    labOrganizationId: "lab-1",
  };

  it("returns all customers when no unit is requested", () => {
    expect(applyUnitFilter(groupScope, undefined)).toEqual([10, 11]);
  });

  it("narrows to a single in-scope unit", () => {
    expect(applyUnitFilter(groupScope, 11)).toEqual([11]);
  });

  it("returns empty for an out-of-scope unit", () => {
    expect(applyUnitFilter(groupScope, 999)).toEqual([]);
  });
});
