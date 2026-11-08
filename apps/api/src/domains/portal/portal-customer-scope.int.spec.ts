/**
 * portal-customer-scope.int.spec.ts: `resolvePortalCustomerScope` against a real Postgres. The
 * portal's active (CLIENT) organization maps to one branch customer or to a customer group that
 * fans out to its branches; a customer or group of another laboratory than the portal host is
 * never exposed.
 *
 *   REQ-PCS-1  a branch customer resolves to single mode, with or without a host laboratory
 *   REQ-PCS-2  a group resolves to its branches (and only those of its own laboratory)
 *   REQ-PCS-3  another laboratory's customer or group, and an organization that maps to
 *              neither, resolve to null
 */
import { beforeEach, describe, expect, it } from "vitest";
import { truncateAll } from "../../../test/integration/db";
import {
  seedPortalContext,
  seedPortalGroup,
} from "../../../test/integration/seed";
import { resolvePortalCustomerScope } from "./portal-customer-scope";

beforeEach(async () => {
  await truncateAll();
});

describe("resolvePortalCustomerScope", () => {
  it("REQ-PCS-1: resolves a branch customer to single mode, with and without a host laboratory", async () => {
    const ctx = await seedPortalContext({ customerName: "Filial A" });

    const onHost = await resolvePortalCustomerScope({
      activeOrgId: ctx.clientOrgId,
      labScope: ctx.labOrgId,
    });
    expect(onHost).toMatchObject({
      mode: "single",
      groupId: null,
      customerIds: [ctx.customerId],
      labOrganizationId: ctx.labOrgId,
    });
    expect(onHost?.customerById.get(ctx.customerId)?.name).toBe("Filial A");

    const defaultHost = await resolvePortalCustomerScope({
      activeOrgId: ctx.clientOrgId,
      labScope: null,
    });
    expect(defaultHost?.mode).toBe("single");
    expect(defaultHost?.customerIds).toEqual([ctx.customerId]);
  });

  it("REQ-PCS-2: fans a group out to its own laboratory's branches, never a mis-assigned one, and an empty group is an empty scope", async () => {
    const ctx = await seedPortalContext();
    const elsewhere = await seedPortalContext({
      labOrgId: "portal-lab-elsewhere",
      clientOrgId: "portal-client-elsewhere",
    });
    const group = await seedPortalGroup({
      labOrgId: ctx.labOrgId,
      branches: [
        { name: "Unidade Norte" },
        { name: "Unidade Sul" },
        // Assigned to the group, but a customer of another laboratory.
        { name: "Unidade Alheia", labOrgId: elsewhere.labOrgId },
      ],
    });
    const [north, south] = group.branches;

    const scope = await resolvePortalCustomerScope({
      activeOrgId: group.groupOrgId,
      labScope: ctx.labOrgId,
    });

    expect(scope).toMatchObject({
      mode: "group",
      groupId: group.groupId,
      labOrganizationId: ctx.labOrgId,
    });
    expect(scope?.customerIds.toSorted()).toEqual(
      [north?.customerId, south?.customerId].toSorted(),
    );
    expect(scope?.customerById.get(south?.customerId ?? 0)?.name).toBe(
      "Unidade Sul",
    );

    const empty = await seedPortalGroup({
      labOrgId: ctx.labOrgId,
      groupOrgId: "portal-group-empty",
      groupUserId: "portal-group-empty-user",
      branches: [],
    });
    const emptyScope = await resolvePortalCustomerScope({
      activeOrgId: empty.groupOrgId,
      labScope: ctx.labOrgId,
    });
    expect(emptyScope?.mode).toBe("group");
    expect(emptyScope?.customerIds).toEqual([]);
  });

  it("REQ-PCS-3: resolves null for another laboratory's customer or group and for an organization that maps to neither", async () => {
    const ctx = await seedPortalContext();
    const group = await seedPortalGroup({
      labOrgId: ctx.labOrgId,
      branches: [{ name: "Unidade Norte" }],
    });

    expect(
      await resolvePortalCustomerScope({
        activeOrgId: ctx.clientOrgId,
        labScope: "portal-lab-other-host",
      }),
    ).toBeNull();
    expect(
      await resolvePortalCustomerScope({
        activeOrgId: group.groupOrgId,
        labScope: "portal-lab-other-host",
      }),
    ).toBeNull();
    expect(
      await resolvePortalCustomerScope({
        activeOrgId: "unknown-org",
        labScope: ctx.labOrgId,
      }),
    ).toBeNull();
  });
});
