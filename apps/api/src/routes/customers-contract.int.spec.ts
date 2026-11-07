/**
 * customers-contract.int.spec.ts: the cloud half of the customers endpoint
 * definitions (`packages/contracts/src/endpoints/customers.ts`). Every
 * client-facing customers endpoint is called for real (real handlers, real
 * middleware, real Postgres) and its body is parsed with the response schema of
 * its definition. `mount` also checks each body with that schema in the
 * integration tier (`checkEndpointResponses`), so a drift fails the request
 * itself; the explicit parse here names the drifting path and the status.
 *
 * Not covered: `POST /` (it provisions the CLIENT organization through the
 * better-auth service account) and the invitation writes (same reason); the
 * handlers' bodies are typed at compile time against the same schemas.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { customerEndpoints } from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  customer,
  invitation,
  member,
  service,
  user,
} from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { customersRouter } from "./customers";
import { insertJobs } from "../../test/integration/job-fixtures";
import { seedAssetOotEvent } from "../../test/integration/oot-fixtures";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedCustomer, seedOrg } from "../../test/integration/seed";
import { withStatusRepair } from "../../test/integration/state-fixtures";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

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
  const org = await seedOrg({ orgId: "org-customers-contract", role: "admin" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const clientOrgId = "client-customers-contract";
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    authOrganizationId: clientOrgId,
    name: "Cliente Contrato",
    taxId: "12.345.678/0001-90",
  });

  // A portal user of the CLIENT organization and a pending invitation to it.
  await db.insert(user).values({
    id: "portal-user-customers-contract",
    name: "Usuária do Portal",
    email: "portal@cliente.test",
  });
  await db.insert(member).values({
    id: "member-customers-contract",
    organizationId: clientOrgId,
    userId: "portal-user-customers-contract",
    role: "client_user",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  await db.insert(invitation).values({
    id: "invitation-customers-contract",
    organizationId: clientOrgId,
    email: "convidado@cliente.test",
    role: "client_user",
    status: "pending",
    expiresAt: new Date("2026-12-31T00:00:00.000Z"),
    inviterId: org.userId,
  });
  return { org, customerId, clientOrgId };
}

describe("customers endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("list and get", async () => {
    const { customerId } = await seedLab();

    const list = await parsedBody(
      await customersRouter.request("/?page=1&limit=20"),
      customerEndpoints.list.response,
    );
    expect(list.data.map((row) => row.name)).toEqual(["Cliente Contrato"]);

    const detail = await parsedBody(
      await customersRouter.request(`/${customerId}`),
      customerEndpoints.get.response,
    );
    expect(detail.financialSummary.openBalanceCents).toBe(0);
  });

  it("update and updateCompliance answer the stored row", async () => {
    const { customerId } = await seedLab();

    const updated = await parsedBody(
      await customersRouter.request(`/${customerId}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          tradeName: "Contrato",
          address: { city: "Campinas", state: "SP" },
        }),
      }),
      customerEndpoints.update.response,
    );
    expect(updated.tradeName).toBe("Contrato");

    const compliance = await parsedBody(
      await customersRouter.request(`/${customerId}/compliance`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          compliance: { qualificationStatus: "qualified", notes: "ok" },
          reason: "Auditoria interna",
        }),
      }),
      customerEndpoints.updateCompliance.response,
    );
    expect(compliance.compliance?.qualificationStatus).toBe("qualified");
  });

  it("auditLog lists the entries the writes above leave", async () => {
    const { customerId } = await seedLab();
    await customersRouter.request(`/${customerId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ tradeName: "Auditado" }),
    });

    const log = await parsedBody(
      await customersRouter.request(`/${customerId}/audit-log`),
      customerEndpoints.auditLog.response,
    );

    expect(log.data.map((entry) => entry.action)).toContain("update");
    expect(log.pagination.page).toBe(1);
  });

  it("listMembers and listInvitations answer the portal users and their invitations", async () => {
    const { customerId } = await seedLab();

    const members = await parsedBody(
      await customersRouter.request(`/${customerId}/members`),
      customerEndpoints.listMembers.response,
    );
    expect(members.map((row) => row.userEmail)).toEqual([
      "portal@cliente.test",
    ]);

    const invitations = await parsedBody(
      await customersRouter.request(`/${customerId}/invitations`),
      customerEndpoints.listInvitations.response,
    );
    expect(invitations.map((row) => row.email)).toEqual([
      "convidado@cliente.test",
    ]);
  });

  it("ootEvents lists the customer's out-of-tolerance events with their assessment status", async () => {
    const { org, customerId } = await seedLab();
    const [type] = await db
      .insert(assetType)
      .values({
        name: "Balança",
        slug: "balanca-customers-contract",
        definition: [],
      })
      .returning({ id: assetType.id });
    const [assetRow] = await withStatusRepair((tx) =>
      tx
        .insert(asset)
        .values({
          unitId: org.unitId,
          customerId,
          labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${customerId})`,
          assetTypeId: type?.id ?? 0,
          name: "Balança A",
          serialNumber: "SN-CC",
          tag: "EQ-CC",
          status: "ACTIVE",
        })
        .returning({ id: asset.id }),
    );
    const [serviceRow] = await db
      .insert(service)
      .values({
        organizationId: org.orgId,
        unitId: org.unitId,
        name: "Calibração",
        isActive: true,
      })
      .returning({ id: service.id });
    const [job] = await insertJobs({
      jobId: "CAL-CC-1",
      certificateName: "CAL-CC-1",
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetId: assetRow?.id ?? 0,
      serviceId: serviceRow?.id ?? 0,
      createdBy: org.userId,
      status: "APPROVED",
      approvedAt: new Date("2026-01-10T10:00:00.000Z"),
      performedAt: new Date("2026-01-10T10:00:00.000Z"),
      methodSnapshot: {
        methodId: 1,
        methodName: "Erro de indicação",
        methodVersion: 1,
        dataFields: [],
        variableBindings: [],
        formulas: [],
        measurementModels: [],
        validations: [],
        uncertaintyParams: [],
      },
      results: {},
    });
    await seedAssetOotEvent({
      jobId: job?.id ?? 0,
      assetId: assetRow?.id ?? 0,
      customerId,
      labOrganizationId: org.orgId,
      detectedAt: new Date("2026-01-10T10:00:00.000Z"),
      actorUserId: org.userId,
    });

    const events = await parsedBody(
      await customersRouter.request(`/${customerId}/oot-events`),
      customerEndpoints.ootEvents.response,
    );

    expect(events.data).toHaveLength(1);
    expect(events.data[0]).toMatchObject({
      status: "OPEN",
      assetTag: "EQ-CC",
      jobIdentifier: "CAL-CC-1",
      assessmentDecision: null,
    });
  });

  it("a customer of another laboratory is not served, whichever endpoint asks", async () => {
    await seedLab();
    const other = await seedOrg({
      orgId: "org-customers-other",
      role: "admin",
    });
    const foreignId = await seedCustomer({
      labOrganizationId: other.orgId,
      name: "Cliente Alheio",
    });
    const [foreign] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.id, foreignId));
    expect(foreign?.id).toBe(foreignId);

    const paths = ["", "/members", "/invitations", "/audit-log", "/oot-events"];
    for (const path of paths) {
      const response = await customersRouter.request(`/${foreignId}${path}`);
      // The route id does not resolve in this laboratory: 400 (unreadable id) or 404.
      expect([400, 404], path).toContain(response.status);
    }
  });
});
