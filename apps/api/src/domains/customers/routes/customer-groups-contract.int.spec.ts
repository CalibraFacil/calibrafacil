/**
 * customer-groups-contract.int.spec.ts: the cloud half of the customer-groups
 * endpoint definitions (`packages/contracts/src/endpoints/customer-groups.ts`).
 * The client-facing endpoints that do not provision a CLIENT organization
 * through the better-auth service account are called for real (real handlers,
 * real middleware, real Postgres) and their bodies are parsed with the response
 * schemas of the definitions. `mount` also checks each body in the integration
 * tier (`checkEndpointResponses`).
 *
 * Not covered: `POST /` and the invitation writes (they go through the
 * better-auth service account); their bodies are typed at compile time against
 * the same schemas.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { customerGroupEndpoints } from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import {
  customer,
  customerGroup,
  invitation,
  member,
  organization,
  user,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { customerGroupsRouter } from "./customer-groups";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedCustomer, seedOrg } from "../../../../test/integration/seed";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

const JSON_HEADERS = { "content-type": "application/json" };

/** Parses with the definition's response schema; the issues name the drifting path on failure. */
async function parsedBody<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  expectedStatus = 200,
): Promise<z.output<TSchema>> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  const result = schema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return schema.parse(body);
}

/** The CLIENT organization a group (or a customer) is the portal tenant of. */
async function seedClientOrg(id: string) {
  await withStatusRepair((tx) =>
    tx.insert(organization).values({
      id,
      name: `Client ${id}`,
      slug: id,
      type: "CLIENT",
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  );
}

async function seedLab() {
  const org = await seedOrg({ orgId: "org-groups-contract", role: "admin" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const groupOrgId = "client-group-contract";
  await seedClientOrg(groupOrgId);
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    authOrganizationId: "client-groups-contract-branch",
    name: "Filial Um",
    taxId: "12.345.678/0001-90",
  });
  const [group] = await db
    .insert(customerGroup)
    .values({
      name: "Rede Contrato",
      authOrganizationId: groupOrgId,
      labOrganizationId: org.orgId,
    })
    .returning({ id: customerGroup.id });
  if (!group) throw new Error("seedLab: group insert failed");

  // A portal manager of the group's CLIENT organization and a pending invitation to it.
  await db.insert(user).values({
    id: "portal-user-groups-contract",
    name: "Gestora",
    email: "gestora@rede.test",
  });
  await db.insert(member).values({
    id: "member-groups-contract",
    organizationId: groupOrgId,
    userId: "portal-user-groups-contract",
    role: "client_user",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  await db.insert(invitation).values({
    id: "invitation-groups-contract",
    organizationId: groupOrgId,
    email: "convidado@rede.test",
    role: "client_user",
    status: "pending",
    expiresAt: new Date("2026-12-31T00:00:00.000Z"),
    inviterId: org.userId,
  });
  return { org, groupId: group.id, customerId };
}

describe("customer-groups endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("list and get", async () => {
    const { groupId } = await seedLab();

    const list = await parsedBody(
      await customerGroupsRouter.request("/"),
      customerGroupEndpoints.list.response,
    );
    expect(list.data).toMatchObject([
      { name: "Rede Contrato", branchCount: 0 },
    ]);

    const detail = await parsedBody(
      await customerGroupsRouter.request(`/${groupId}`),
      customerGroupEndpoints.get.response,
    );
    expect(detail.branches).toEqual([]);
  });

  it("addBranch and removeBranch answer success and move the customer in and out of the group", async () => {
    const { groupId, customerId } = await seedLab();

    await parsedBody(
      await customerGroupsRouter.request(`/${groupId}/branches`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ customerId }),
      }),
      customerGroupEndpoints.addBranch.response,
    );

    const detail = await parsedBody(
      await customerGroupsRouter.request(`/${groupId}`),
      customerGroupEndpoints.get.response,
    );
    expect(detail.branches).toMatchObject([
      { id: customerId, name: "Filial Um", total: 0, overdue: 0, dueSoon: 0 },
    ]);

    await parsedBody(
      await customerGroupsRouter.request(`/${groupId}/branches/${customerId}`, {
        method: "DELETE",
      }),
      customerGroupEndpoints.removeBranch.response,
    );
    const [row] = await db
      .select({ groupId: customer.groupId })
      .from(customer)
      .where(eq(customer.id, customerId));
    expect(row?.groupId).toBeNull();
  });

  it("listMembers and listInvitations answer the group's portal managers and invitations", async () => {
    const { groupId } = await seedLab();

    const members = await parsedBody(
      await customerGroupsRouter.request(`/${groupId}/members`),
      customerGroupEndpoints.listMembers.response,
    );
    expect(members.map((row) => row.userEmail)).toEqual(["gestora@rede.test"]);

    const invitations = await parsedBody(
      await customerGroupsRouter.request(`/${groupId}/invitations`),
      customerGroupEndpoints.listInvitations.response,
    );
    expect(invitations.map((row) => row.email)).toEqual([
      "convidado@rede.test",
    ]);
  });

  it("a group of another laboratory is not served, whichever endpoint asks", async () => {
    await seedLab();
    const other = await seedOrg({ orgId: "org-groups-other", role: "admin" });
    await seedClientOrg("client-group-other");
    const [foreign] = await db
      .insert(customerGroup)
      .values({
        name: "Rede Alheia",
        authOrganizationId: "client-group-other",
        labOrganizationId: other.orgId,
      })
      .returning({ id: customerGroup.id });
    if (!foreign) throw new Error("foreign group insert failed");

    for (const path of ["", "/members", "/invitations"]) {
      const response = await customerGroupsRouter.request(
        `/${foreign.id}${path}`,
      );
      expect([400, 404], path).toContain(response.status);
    }
  });
});
