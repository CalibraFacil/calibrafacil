/**
 * units-contract.int.spec.ts: the cloud half of the units endpoint definitions
 * (`packages/contracts/src/endpoints/units.ts`). Every client-facing units
 * endpoint is called for real (real handlers, real middleware, real Postgres)
 * and its body is parsed with the response schema of its definition. `mount`
 * also checks each body with that schema in the integration tier
 * (`checkEndpointResponses`), so a drift fails the request itself; the explicit
 * parse here names the drifting path and the status.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { unitEndpoints } from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { member, organizationEventLog, user } from "@calibra-facil/db/schema";
import { unitsRouter } from "./units";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

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

async function seedLab() {
  const org = await seedOrg({ orgId: "org-units-contract", role: "admin" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const headers = { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) };

  // A second member to assign and to change the role of.
  await db.insert(user).values({
    id: "user-units-contract-tech",
    name: "Técnica",
    email: "tecnica@lab.test",
  });
  await db.insert(member).values({
    id: "member-units-contract-tech",
    organizationId: org.orgId,
    userId: "user-units-contract-tech",
    role: "technician",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  return { org, headers, techMemberId: "member-units-contract-tech" };
}

describe("units endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("getDashboardUnits answers the unit context of the session", async () => {
    const { headers } = await seedLab();

    const context = await parsedBody(
      await unitsRouter.request("/", { headers }),
      unitEndpoints.getDashboardUnits.response,
    );

    expect(context.data.map((unit) => unit.name)).toEqual(["Matriz"]);
    expect(context.viewer.isGlobalManager).toBe(true);
  });

  it("listAdminUnits, create and update answer the unit rows", async () => {
    const { headers } = await seedLab();

    const created = await parsedBody(
      await unitsRouter.request("/admin/units", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Filial Centro" }),
      }),
      unitEndpoints.createAdminUnit.response,
      201,
    );
    expect(created.slug).toBe("filial-centro");

    const updated = await parsedBody(
      await unitsRouter.request(`/admin/units/${created.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          name: "Filial Centro II",
          calibratingBody: { city: "Campinas", state: "SP" },
        }),
      }),
      unitEndpoints.updateAdminUnit.response,
    );
    expect(updated).toMatchObject({
      name: "Filial Centro II",
      city: "Campinas",
    });

    // A patch that changes nothing answers the stored row.
    await parsedBody(
      await unitsRouter.request(`/admin/units/${created.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({}),
      }),
      unitEndpoints.updateAdminUnit.response,
    );

    const list = await parsedBody(
      await unitsRouter.request("/admin/units", { headers }),
      unitEndpoints.listAdminUnits.response,
    );
    expect(list.data.map((unit) => unit.name)).toEqual([
      "Filial Centro II",
      "Matriz",
    ]);
  });

  it("assignments and role writes answer success, and members and activity list their effects", async () => {
    const { org, headers, techMemberId } = await seedLab();

    await parsedBody(
      await unitsRouter.request(`/admin/members/${techMemberId}/assignments`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          assignments: [{ unitId: org.unitId, role: "technician" }],
        }),
      }),
      unitEndpoints.updateMemberAssignments.response,
    );
    await parsedBody(
      await unitsRouter.request(`/admin/members/${techMemberId}/role`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ role: "member" }),
      }),
      unitEndpoints.updateMemberRole.response,
    );

    const members = await parsedBody(
      await unitsRouter.request("/admin/members", { headers }),
      unitEndpoints.listAdminMembers.response,
    );
    const tech = members.data.find((row) => row.id === techMemberId);
    expect(tech).toMatchObject({
      role: "member",
      assignments: [{ unitId: org.unitId, role: "technician" }],
    });

    const activity = await parsedBody(
      await unitsRouter.request("/admin/activity", { headers }),
      unitEndpoints.listAdminActivity.response,
    );
    expect(activity.data.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "unit.assignments.updated",
        "member.role.updated",
      ]),
    );
    // An event without an actor or unit still parses (system events).
    await db.insert(organizationEventLog).values({
      organizationId: org.orgId,
      action: "unit.system",
      entityType: "organization_unit",
    });
    await parsedBody(
      await unitsRouter.request("/admin/activity", { headers }),
      unitEndpoints.listAdminActivity.response,
    );
  });

  it("a member without governance access is refused by the reads (the client answers it with an empty result)", async () => {
    const lab = await seedOrg({
      orgId: "org-units-contract-member",
      role: "member",
    });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const response = await unitsRouter.request("/admin/units", {
      headers: { "x-active-unit-id": String(lab.unitId) },
    });

    expect(response.status).toBe(403);
  });
});
