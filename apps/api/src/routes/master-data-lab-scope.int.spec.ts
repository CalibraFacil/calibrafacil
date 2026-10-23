/**
 * master-data-lab-scope.int.spec.ts — success paths of the master-data routes
 * (P2-18c) that the per-router specs do not reach, each with a cross-laboratory
 * negative: laboratory B's id used in laboratory A's session answers 404/400,
 * with nothing read or written.
 *
 * Real DB + real RBAC (only the better-auth session is mocked, see
 * test/integration/setup.ts). The handlers run their statements in
 * `orgDb(lab).transaction`, so this file is what the RLS shadow report
 * (`pnpm --filter @calibra-facil/api rls:shadow-report --files ...`) replays as
 * `calibra_app` to prove the handlers carry the laboratory in every statement.
 *
 *   REQ-MD-SVC     services: GET /:id, /:id/label, /:id/audit-log, PUT, DELETE
 *   REQ-MD-MAT     materials: GET /:id, PUT
 *   REQ-MD-ASSET   assets: GET /:id, /:id/label, /:id/audit-log, DELETE
 *   REQ-MD-CUST    customers: GET /:id, /:id/label, /:id/audit-log, /:id/oot-events,
 *                  /:id/members, /:id/invitations, PUT /:id/compliance
 *   REQ-MD-GROUP   customer groups: members, invitations, branch detach
 *   REQ-MD-CREQ    calibration requests: GET /:id, review, reject
 *   REQ-MD-UNIT    units: GET /admin/members, /admin/activity, PATCH member role
 *   REQ-MD-VISIT   visits: POST /:id/jobs (job creation inside the lab transaction)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  assetType,
  calibrationJob,
  calibrationMethod,
  calibrationRequest,
  calibrationRequestAuditLog,
  calibrationRequestItem,
  calibrationVisit,
  customer,
  customerAuditLog,
  customerGroup,
  invitation,
  material,
  member,
  organization,
  organizationEventLog,
  service,
  serviceAuditLog,
  user,
} from "@calibra-facil/db/schema";
import { ENGINE_VERSION } from "@calibra-facil/math-engine";
import { eq, sql } from "drizzle-orm";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { organizationOf } from "../../test/integration/organization-of";
import { seedOrg } from "../../test/integration/seed";
import { seedExtraMember } from "../../test/integration/tenant-refs";
import { assetsRouter } from "./assets";
import { calibrationRequestsRouter } from "./calibration-requests";
import { customerGroupsRouter } from "./customer-groups";
import { customersRouter } from "./customers";
import { materialsRouter } from "./materials";
import { servicesRouter } from "./services";
import { unitsRouter } from "./units";
import { visitJobsRouter } from "./visits";

// The request-state notifications read what the transaction wrote and send
// e-mail; they are not under test here.
vi.mock("@calibra-facil/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/notifications")>()),
  notifyCalibrationRequestUnderReview: vi.fn().mockResolvedValue(undefined),
  notifyCalibrationRequestRejected: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const NOW = new Date("2026-01-01T00:00:00.000Z");

type Lab = Awaited<ReturnType<typeof seedLab>>;

type Requester = {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
};
type Probe = { path: string; method?: string; body?: unknown };

/** Sends every probe at once and returns each answer's status and JSON body. */
async function probeAll(router: Requester, probes: readonly Probe[]) {
  return Promise.all(
    probes.map(async ({ path, method, body }) => {
      const res = await router.request(path, {
        method,
        headers: JSON_HEADERS,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: await res.json() };
    }),
  );
}

/** A laboratory with a customer (and its CLIENT org), an asset and a service. */
async function seedLab(
  orgId: string,
  role: "owner" | "admin" | "technician" | "operator" | "member" = "admin",
) {
  const org = await seedOrg({ orgId, role });
  const clientOrgId = `client-${orgId}`;
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: NOW,
  });
  const [customerRow] = await db
    .insert(customer)
    .values({
      name: `Customer ${orgId}`,
      authOrganizationId: clientOrgId,
      labOrganizationId: orgId,
    })
    .returning({ id: customer.id });
  const [typeRow] = await db
    .insert(assetType)
    .values({ name: `Type ${orgId}`, slug: `type-${orgId}`, definition: [] })
    .returning({ id: assetType.id });
  if (!customerRow || !typeRow) throw new Error("seedLab: insert failed");
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: org.unitId,
      customerId: customerRow.id,
      labOrganizationId: orgId,
      assetTypeId: typeRow.id,
      name: `Instrument ${orgId}`,
      serialNumber: `SN-${orgId}`,
      tag: `TAG-${orgId}`,
    })
    .returning({ id: asset.id });
  const [serviceRow] = await db
    .insert(service)
    .values({
      organizationId: orgId,
      unitId: org.unitId,
      name: `Service ${orgId}`,
    })
    .returning({ id: service.id });
  if (!assetRow || !serviceRow) throw new Error("seedLab: insert failed");
  return {
    ...org,
    clientOrgId,
    customerId: customerRow.id,
    assetTypeId: typeRow.id,
    assetId: assetRow.id,
    serviceId: serviceRow.id,
  };
}

async function seedTwoLabs(): Promise<{ a: Lab; b: Lab }> {
  const a = await seedLab("org-a");
  const b = await seedLab("org-b");
  loginAs({ userId: a.userId, organizationId: a.orgId });
  return { a, b };
}

async function seedMaterial(lab: Lab, name: string): Promise<number> {
  const [row] = await db
    .insert(material)
    .values({
      organizationId: lab.orgId,
      unitId: lab.unitId,
      name,
      sku: `SKU-${lab.orgId}`,
    })
    .returning({ id: material.id });
  if (!row) throw new Error("seedMaterial: insert failed");
  return row.id;
}

async function seedRequest(lab: Lab) {
  const [request] = await db
    .insert(calibrationRequest)
    .values({
      organizationId: lab.orgId,
      unitId: lab.unitId,
      customerId: lab.customerId,
      authOrganizationId: lab.clientOrgId,
      status: "PENDING",
      deliveryMethod: "dropoff",
      submittedBy: lab.userId,
      submittedAt: new Date("2026-01-15T10:00:00.000Z"),
    })
    .returning({ id: calibrationRequest.id });
  if (!request) throw new Error("seedRequest: insert failed");
  await db.insert(calibrationRequestItem).values({
    organizationId: organizationOf("calibration_request", request.id),
    requestId: request.id,
    assetId: lab.assetId,
  });
  return request.id;
}

async function seedPublishedService(lab: Lab): Promise<number> {
  const [method] = await db
    .insert(calibrationMethod)
    .values({
      organizationId: lab.orgId,
      assetTypeId: lab.assetTypeId,
      name: `Method ${lab.orgId}`,
      version: 1,
      status: "PUBLISHED",
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
      methodFingerprint: "test-fp-0000000000000001",
      compiledMethod: {
        methodFingerprint: "test-fp-0000000000000001",
        normalizedMethodJson: "{}",
        engine: {
          version: ENGINE_VERSION,
          optionsFingerprint: "test-opts-fp-00000001",
        },
      },
      methodEngine: {
        version: ENGINE_VERSION,
        optionsFingerprint: "test-opts-fp-00000001",
      },
      publicationEvidence: { publishedAt: "2026-01-01T00:00:00.000Z" },
      createdBy: lab.userId,
    })
    .returning({ id: calibrationMethod.id });
  if (!method) throw new Error("seedPublishedService: method failed");
  const [row] = await db
    .update(service)
    .set({ methodId: method.id })
    .where(eq(service.id, lab.serviceId))
    .returning({ id: service.id });
  if (!row) throw new Error("seedPublishedService: service failed");
  return row.id;
}

async function seedVisit(lab: Lab): Promise<number> {
  const [row] = await db
    .insert(calibrationVisit)
    .values({
      organizationId: lab.orgId,
      unitId: lab.unitId,
      customerId: lab.customerId,
      createdBy: lab.userId,
      status: "PROPOSED",
    })
    .returning({ id: calibrationVisit.id });
  if (!row) throw new Error("seedVisit: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------

describe("master data — success paths and the laboratory boundary (P2-18c)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe("services", () => {
    it("REQ-MD-SVC-1: GET /:id, /:id/label read the lab's service; another lab's id answers 400 and leaks nothing", async () => {
      const { a, b } = await seedTwoLabs();

      const detail = await servicesRouter.request(`/${a.serviceId}`, {
        headers: JSON_HEADERS,
      });
      expect(detail.status).toBe(200);
      expect((await detail.json()).name).toBe("Service org-a");

      const label = await servicesRouter.request(`/${a.serviceId}/label`, {
        headers: JSON_HEADERS,
      });
      expect(label.status).toBe(200);
      expect(await label.json()).toEqual({
        id: a.serviceId,
        label: "Service org-a",
      });

      const refused = await probeAll(servicesRouter, [
        { path: `/${b.serviceId}` },
        { path: `/${b.serviceId}/label` },
      ]);
      for (const result of refused) {
        expect(result.status).toBe(400);
        expect(result.body).not.toHaveProperty("name");
      }
    });

    it("REQ-MD-SVC-2: PUT /:id renames the lab's service with an audit row; another lab's service is untouched", async () => {
      const { a, b } = await seedTwoLabs();

      const res = await servicesRouter.request(`/${a.serviceId}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Renamed" }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).name).toBe("Renamed");

      const [row] = await db
        .select()
        .from(service)
        .where(eq(service.id, a.serviceId));
      expect(row?.name).toBe("Renamed");
      const audit = await db
        .select()
        .from(serviceAuditLog)
        .where(eq(serviceAuditLog.serviceId, a.serviceId));
      expect(audit.map((entry) => entry.action)).toEqual(["update"]);

      const cross = await servicesRouter.request(`/${b.serviceId}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Hijacked" }),
      });
      expect(cross.status).toBe(400);
      const [other] = await db
        .select()
        .from(service)
        .where(eq(service.id, b.serviceId));
      expect(other?.name).toBe("Service org-b");
      expect(
        await db
          .select()
          .from(serviceAuditLog)
          .where(eq(serviceAuditLog.serviceId, b.serviceId)),
      ).toHaveLength(0);
    });

    it("REQ-MD-SVC-3: DELETE /:id deactivates the lab's service; GET /:id/audit-log lists it; another lab's id is refused", async () => {
      const { a, b } = await seedTwoLabs();

      const res = await servicesRouter.request(`/${a.serviceId}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
      });
      expect(res.status).toBe(200);
      const [row] = await db
        .select()
        .from(service)
        .where(eq(service.id, a.serviceId));
      expect(row?.isActive).toBe(false);

      const log = await servicesRouter.request(`/${a.serviceId}/audit-log`, {
        headers: JSON_HEADERS,
      });
      expect(log.status).toBe(200);
      const body = await log.json();
      expect(
        body.data.map((entry: { action: string }) => entry.action),
      ).toEqual(["deactivate"]);
      expect(body.data[0].performerName).toBe(`User ${a.userId}`);

      const refused = await probeAll(servicesRouter, [
        { path: `/${b.serviceId}`, method: "DELETE" },
        { path: `/${b.serviceId}/audit-log`, method: "GET" },
      ]);
      for (const result of refused) {
        expect(result.status).toBe(400);
      }
      const [other] = await db
        .select()
        .from(service)
        .where(eq(service.id, b.serviceId));
      expect(other?.isActive).toBe(true);
    });
  });

  describe("materials", () => {
    it("REQ-MD-MAT-1: GET /:id and PUT /:id work on the lab's material; another lab's id answers 404 and is untouched", async () => {
      const { a, b } = await seedTwoLabs();
      const aMaterial = await seedMaterial(a, "Cell A");
      const bMaterial = await seedMaterial(b, "Cell B");

      const detail = await materialsRouter.request(`/${aMaterial}`, {
        headers: JSON_HEADERS,
      });
      expect(detail.status).toBe(200);
      expect((await detail.json()).name).toBe("Cell A");

      const update = await materialsRouter.request(`/${aMaterial}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Cell A2" }),
      });
      expect(update.status).toBe(200);
      const [row] = await db
        .select()
        .from(material)
        .where(eq(material.id, aMaterial));
      expect(row?.name).toBe("Cell A2");

      const readCross = await materialsRouter.request(`/${bMaterial}`, {
        headers: JSON_HEADERS,
      });
      expect(readCross.status).toBe(404);
      const writeCross = await materialsRouter.request(`/${bMaterial}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Hijacked" }),
      });
      expect(writeCross.status).toBe(404);
      const [other] = await db
        .select()
        .from(material)
        .where(eq(material.id, bMaterial));
      expect(other?.name).toBe("Cell B");
    });
  });

  describe("assets", () => {
    it("REQ-MD-ASSET-1: GET /:id and /:id/label read the lab's asset; another lab's id answers 400", async () => {
      const { a, b } = await seedTwoLabs();

      const detail = await assetsRouter.request(`/${a.assetId}`, {
        headers: JSON_HEADERS,
      });
      expect(detail.status).toBe(200);
      const body = await detail.json();
      expect(body.tag).toBe("TAG-org-a");
      expect(body.customerName).toBe("Customer org-a");
      expect(body.assetTypeName).toBe("Type org-a");

      const label = await assetsRouter.request(`/${a.assetId}/label`, {
        headers: JSON_HEADERS,
      });
      expect(label.status).toBe(200);
      expect(await label.json()).toEqual({
        id: a.assetId,
        label: "Instrument org-a",
      });

      const refused = await probeAll(assetsRouter, [
        { path: `/${b.assetId}` },
        { path: `/${b.assetId}/label` },
      ]);
      for (const result of refused) {
        expect(result.status).toBe(400);
      }
    });

    it("REQ-MD-ASSET-2: GET /:id/audit-log lists the lab's trail after an update; another lab's asset has no trail to read", async () => {
      const { a, b } = await seedTwoLabs();

      const update = await assetsRouter.request(`/${a.assetId}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Renamed instrument" }),
      });
      expect(update.status).toBe(200);

      const log = await assetsRouter.request(`/${a.assetId}/audit-log`, {
        headers: JSON_HEADERS,
      });
      expect(log.status).toBe(200);
      const body = await log.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].action).toBe("update");
      expect(body.data[0].performerName).toBe(`User ${a.userId}`);

      const cross = await assetsRouter.request(`/${b.assetId}/audit-log`, {
        headers: JSON_HEADERS,
      });
      expect(cross.status).toBe(400);
    });

    it("REQ-MD-ASSET-3: DELETE /:id soft-deletes the lab's asset with an audit row; another lab's asset is untouched", async () => {
      const { a, b } = await seedTwoLabs();

      const res = await assetsRouter.request(`/${a.assetId}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
      });
      expect(res.status).toBe(200);
      const [row] = await db
        .select()
        .from(asset)
        .where(eq(asset.id, a.assetId));
      expect(row?.deletedAt).not.toBeNull();
      const audit = await db
        .select()
        .from(assetAuditLog)
        .where(eq(assetAuditLog.assetId, a.assetId));
      expect(audit.map((entry) => entry.action)).toEqual(["delete"]);

      const cross = await assetsRouter.request(`/${b.assetId}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
      });
      expect(cross.status).toBe(400);
      const [other] = await db
        .select()
        .from(asset)
        .where(eq(asset.id, b.assetId));
      expect(other?.deletedAt).toBeNull();
    });
  });

  describe("customers", () => {
    it("REQ-MD-CUST-1: GET /:id, /:id/label, /:id/oot-events read the lab's customer; another lab's id answers 400", async () => {
      const { a, b } = await seedTwoLabs();

      const detail = await customersRouter.request(`/${a.customerId}`, {
        headers: JSON_HEADERS,
      });
      expect(detail.status).toBe(200);
      const body = await detail.json();
      expect(body.name).toBe("Customer org-a");
      expect(body.group).toBeNull();
      expect(body.financialSummary.openDocumentsCount).toBe(0);

      const label = await customersRouter.request(`/${a.customerId}/label`, {
        headers: JSON_HEADERS,
      });
      expect(label.status).toBe(200);
      expect(await label.json()).toEqual({
        id: a.customerId,
        label: "Customer org-a",
      });

      const oot = await customersRouter.request(`/${a.customerId}/oot-events`, {
        headers: JSON_HEADERS,
      });
      expect(oot.status).toBe(200);
      expect(await oot.json()).toEqual({ data: [] });

      const refused = await probeAll(customersRouter, [
        { path: `/${b.customerId}` },
        { path: `/${b.customerId}/label` },
        { path: `/${b.customerId}/oot-events` },
      ]);
      for (const result of refused) {
        expect(result.status).toBe(400);
        expect(result.body).not.toHaveProperty("name");
      }
    });

    it("REQ-MD-CUST-2: PUT /:id/compliance records the change with its reason; GET /:id/audit-log lists it; another lab's customer is refused", async () => {
      const { a, b } = await seedTwoLabs();

      const res = await customersRouter.request(`/${a.customerId}/compliance`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          compliance: { qualificationStatus: "qualified" },
          reason: "Auditoria de qualificacao",
        }),
      });
      expect(res.status).toBe(200);
      const [row] = await db
        .select()
        .from(customer)
        .where(eq(customer.id, a.customerId));
      expect(row?.compliance?.qualificationStatus).toBe("qualified");

      const log = await customersRouter.request(`/${a.customerId}/audit-log`, {
        headers: JSON_HEADERS,
      });
      expect(log.status).toBe(200);
      const body = await log.json();
      expect(body.pagination.total).toBe(1);
      expect(body.data[0].action).toBe("compliance_change");
      expect(body.data[0].reason).toBe("Auditoria de qualificacao");

      const cross = await customersRouter.request(
        `/${b.customerId}/compliance`,
        {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            compliance: { qualificationStatus: "suspended" },
            reason: "x",
          }),
        },
      );
      expect(cross.status).toBe(400);
      const crossLog = await customersRouter.request(
        `/${b.customerId}/audit-log`,
        { headers: JSON_HEADERS },
      );
      expect(crossLog.status).toBe(400);
      expect(
        await db
          .select()
          .from(customerAuditLog)
          .where(eq(customerAuditLog.customerId, b.customerId)),
      ).toHaveLength(0);
    });

    it("REQ-MD-CUST-3: GET /:id/members and /:id/invitations read the CLIENT organization's rows of the lab's customer; another lab's customer answers 400", async () => {
      const { a, b } = await seedTwoLabs();
      await Promise.all(
        [a, b].map(async (lab) => {
          const portalUserId = `portal-${lab.orgId}`;
          await db.insert(user).values({
            id: portalUserId,
            name: `Portal ${lab.orgId}`,
            email: `${portalUserId}@client.test`,
          });
          await db.insert(member).values({
            id: `member-${portalUserId}`,
            organizationId: lab.clientOrgId,
            userId: portalUserId,
            role: "client_user",
            createdAt: NOW,
          });
          await db.insert(invitation).values({
            id: `invite-${lab.orgId}`,
            organizationId: lab.clientOrgId,
            email: `invited-${lab.orgId}@client.test`,
            role: "client_user",
            status: "pending",
            expiresAt: new Date("2030-01-01T00:00:00.000Z"),
            inviterId: lab.userId,
          });
        }),
      );

      const members = await customersRouter.request(
        `/${a.customerId}/members`,
        { headers: JSON_HEADERS },
      );
      expect(members.status).toBe(200);
      const memberRows = await members.json();
      expect(memberRows.map((row: { userId: string }) => row.userId)).toEqual([
        "portal-org-a",
      ]);

      const invitations = await customersRouter.request(
        `/${a.customerId}/invitations`,
        { headers: JSON_HEADERS },
      );
      expect(invitations.status).toBe(200);
      const inviteRows = await invitations.json();
      expect(inviteRows.map((row: { email: string }) => row.email)).toEqual([
        "invited-org-a@client.test",
      ]);

      const refused = await probeAll(customersRouter, [
        { path: `/${b.customerId}/members` },
        { path: `/${b.customerId}/invitations` },
      ]);
      for (const result of refused) {
        expect(result.status).toBe(400);
      }
    });
  });

  describe("customer groups", () => {
    async function seedGroup(lab: Lab) {
      const groupOrgId = `group-${lab.orgId}`;
      await db.insert(organization).values({
        id: groupOrgId,
        name: `Group ${groupOrgId}`,
        slug: groupOrgId,
        type: "CLIENT",
        status: "ACTIVE",
        createdAt: NOW,
      });
      const [group] = await db
        .insert(customerGroup)
        .values({
          name: `Rede ${lab.orgId}`,
          authOrganizationId: groupOrgId,
          labOrganizationId: lab.orgId,
        })
        .returning({ id: customerGroup.id });
      if (!group) throw new Error("seedGroup: insert failed");
      await db
        .update(customer)
        .set({ groupId: group.id })
        .where(eq(customer.id, lab.customerId));
      const portalUserId = `group-user-${lab.orgId}`;
      await db.insert(user).values({
        id: portalUserId,
        name: `Gestor ${lab.orgId}`,
        email: `${portalUserId}@client.test`,
      });
      await db.insert(member).values({
        id: `member-${portalUserId}`,
        organizationId: groupOrgId,
        userId: portalUserId,
        role: "client_user",
        createdAt: NOW,
      });
      await db.insert(invitation).values({
        id: `invite-${groupOrgId}`,
        organizationId: groupOrgId,
        email: `invited-${lab.orgId}@group.test`,
        role: "client_user",
        status: "pending",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        inviterId: lab.userId,
      });
      return { groupId: group.id, groupOrgId, portalUserId };
    }

    it("REQ-MD-GROUP-1: GET /:id/members and /:id/invitations read the group's CLIENT organization; another lab's group answers 404", async () => {
      const { a, b } = await seedTwoLabs();
      const groupA = await seedGroup(a);
      const groupB = await seedGroup(b);

      const members = await customerGroupsRouter.request(
        `/${groupA.groupId}/members`,
        { headers: JSON_HEADERS },
      );
      expect(members.status).toBe(200);
      expect(
        (await members.json()).map((row: { userId: string }) => row.userId),
      ).toEqual([groupA.portalUserId]);

      const invitations = await customerGroupsRouter.request(
        `/${groupA.groupId}/invitations`,
        { headers: JSON_HEADERS },
      );
      expect(invitations.status).toBe(200);
      expect(
        (await invitations.json()).map((row: { email: string }) => row.email),
      ).toEqual(["invited-org-a@group.test"]);

      const refused = await probeAll(customerGroupsRouter, [
        { path: `/${groupB.groupId}/members` },
        { path: `/${groupB.groupId}/invitations` },
      ]);
      for (const result of refused) {
        expect(result.status).toBe(404);
      }
    });

    it("REQ-MD-GROUP-2: DELETE /:id/branches/:customerId detaches the lab's branch with an audit row; another lab's group is refused and untouched", async () => {
      const { a, b } = await seedTwoLabs();
      const groupA = await seedGroup(a);
      const groupB = await seedGroup(b);

      const cross = await customerGroupsRouter.request(
        `/${groupB.groupId}/branches/${b.customerId}`,
        { method: "DELETE", headers: JSON_HEADERS },
      );
      expect(cross.status).toBe(404);
      const [stillInGroup] = await db
        .select()
        .from(customer)
        .where(eq(customer.id, b.customerId));
      expect(stillInGroup?.groupId).toBe(groupB.groupId);

      const res = await customerGroupsRouter.request(
        `/${groupA.groupId}/branches/${a.customerId}`,
        { method: "DELETE", headers: JSON_HEADERS },
      );
      expect(res.status).toBe(200);
      const [detached] = await db
        .select()
        .from(customer)
        .where(eq(customer.id, a.customerId));
      expect(detached?.groupId).toBeNull();
      const audit = await db
        .select()
        .from(customerAuditLog)
        .where(eq(customerAuditLog.customerId, a.customerId));
      expect(audit.map((entry) => entry.action)).toEqual(["group_removal"]);
    });
  });

  describe("calibration requests", () => {
    it("REQ-MD-CREQ-1: GET /:id returns the lab's request with its items; another lab's request answers 404", async () => {
      const { a, b } = await seedTwoLabs();
      const aRequest = await seedRequest(a);
      const bRequest = await seedRequest(b);

      const res = await calibrationRequestsRouter.request(`/${aRequest}`, {
        headers: JSON_HEADERS,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.customerName).toBe("Customer org-a");
      expect(body.items).toHaveLength(1);
      expect(body.items[0].assetTag).toBe("TAG-org-a");

      const cross = await calibrationRequestsRouter.request(`/${bRequest}`, {
        headers: JSON_HEADERS,
      });
      expect(cross.status).toBe(404);
    });

    it("REQ-MD-CREQ-2: POST /:id/review and /:id/reject move the lab's request with audit rows; another lab's request is untouched", async () => {
      const { a, b } = await seedTwoLabs();
      const aRequest = await seedRequest(a);
      const bRequest = await seedRequest(b);

      const review = await calibrationRequestsRouter.request(
        `/${aRequest}/review`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ internalNotes: "Em analise" }),
        },
      );
      expect(review.status).toBe(200);
      const [reviewed] = await db
        .select()
        .from(calibrationRequest)
        .where(eq(calibrationRequest.id, aRequest));
      expect(reviewed?.status).toBe("UNDER_REVIEW");
      expect(reviewed?.reviewedBy).toBe(a.userId);

      const reject = await calibrationRequestsRouter.request(
        `/${aRequest}/reject`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ reason: "Fora do escopo" }),
        },
      );
      expect(reject.status).toBe(200);
      const [rejected] = await db
        .select()
        .from(calibrationRequest)
        .where(eq(calibrationRequest.id, aRequest));
      expect(rejected?.status).toBe("REJECTED");
      expect(rejected?.rejectionReason).toBe("Fora do escopo");
      const audit = await db
        .select()
        .from(calibrationRequestAuditLog)
        .where(eq(calibrationRequestAuditLog.requestId, aRequest));
      expect(audit.map((entry) => entry.action).toSorted()).toEqual([
        "reject",
        "review",
      ]);

      const refused = await probeAll(
        calibrationRequestsRouter,
        [`/${bRequest}/review`, `/${bRequest}/reject`].map((path) => ({
          path,
          method: "POST",
          body: { reason: "Hijacked", internalNotes: "x" },
        })),
      );
      for (const result of refused) {
        expect(result.status).toBe(404);
      }
      const [other] = await db
        .select()
        .from(calibrationRequest)
        .where(eq(calibrationRequest.id, bRequest));
      expect(other?.status).toBe("PENDING");
      expect(
        await db
          .select()
          .from(calibrationRequestAuditLog)
          .where(eq(calibrationRequestAuditLog.requestId, bRequest)),
      ).toHaveLength(0);
    });
  });

  describe("units", () => {
    it("REQ-MD-UNIT-1: GET /admin/members and /admin/activity list only the lab's own members and events", async () => {
      const { a, b } = await seedTwoLabs();
      await db.insert(organizationEventLog).values({
        organizationId: b.orgId,
        action: "unit.created",
        entityType: "organization_unit",
        entityId: "foreign",
      });

      const created = await unitsRouter.request("/admin/units", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Filial Sul" }),
      });
      expect(created.status).toBe(201);

      const members = await unitsRouter.request("/admin/members", {
        headers: JSON_HEADERS,
      });
      expect(members.status).toBe(200);
      const memberBody = await members.json();
      expect(memberBody.data.map((row: { id: string }) => row.id)).toEqual([
        a.memberId,
      ]);

      const activity = await unitsRouter.request("/admin/activity", {
        headers: JSON_HEADERS,
      });
      expect(activity.status).toBe(200);
      const activityBody = await activity.json();
      expect(activityBody.data).toHaveLength(1);
      expect(activityBody.data[0].action).toBe("unit.created");
      expect(activityBody.data[0].entityId).not.toBe("foreign");
    });

    it("REQ-MD-UNIT-2: PATCH /admin/members/:id/role changes the lab's member with an event; another lab's member answers 404 and is untouched", async () => {
      const { a, b } = await seedTwoLabs();
      const colleague = await seedExtraMember({
        orgId: a.orgId,
        userId: "tech-a",
        role: "technician",
      });
      const foreign = await seedExtraMember({
        orgId: b.orgId,
        userId: "tech-b",
        role: "technician",
      });

      const res = await unitsRouter.request(
        `/admin/members/${colleague.memberId}/role`,
        {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ role: "operator" }),
        },
      );
      expect(res.status).toBe(200);
      const [row] = await db
        .select()
        .from(member)
        .where(eq(member.id, colleague.memberId));
      expect(row?.role).toBe("operator");
      const events = await db
        .select()
        .from(organizationEventLog)
        .where(eq(organizationEventLog.organizationId, a.orgId));
      expect(events.map((event) => event.action)).toEqual([
        "member.role.updated",
      ]);

      const cross = await unitsRouter.request(
        `/admin/members/${foreign.memberId}/role`,
        {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ role: "operator" }),
        },
      );
      expect(cross.status).toBe(404);
      const [other] = await db
        .select()
        .from(member)
        .where(eq(member.id, foreign.memberId));
      expect(other?.role).toBe("technician");
    });
  });

  describe("visits", () => {
    it("REQ-MD-VISIT-1: POST /:id/jobs creates the job on the lab's visit; another lab's visit or asset creates nothing", async () => {
      const { a, b } = await seedTwoLabs();
      const serviceA = await seedPublishedService(a);
      await seedPublishedService(b);
      const visitA = await seedVisit(a);
      const visitB = await seedVisit(b);

      const res = await visitJobsRouter.request(`/${visitA}/jobs`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ assetId: a.assetId, serviceId: serviceA }),
      });
      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created.visitId).toBe(visitA);
      expect(created.organizationId).toBe(a.orgId);
      const [persisted] = await db
        .select()
        .from(calibrationJob)
        .where(eq(calibrationJob.id, created.id));
      expect(persisted?.assetId).toBe(a.assetId);

      // Another lab's visit: 404. Another lab's asset on this lab's visit: 400.
      const foreignVisit = await visitJobsRouter.request(`/${visitB}/jobs`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ assetId: b.assetId, serviceId: serviceA }),
      });
      expect(foreignVisit.status).toBe(404);
      const foreignAsset = await visitJobsRouter.request(`/${visitA}/jobs`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ assetId: b.assetId, serviceId: serviceA }),
      });
      expect(foreignAsset.status).toBe(400);

      const jobs = await db
        .select({ id: calibrationJob.id, org: calibrationJob.organizationId })
        .from(calibrationJob)
        .where(sql`true`);
      expect(jobs).toEqual([{ id: created.id, org: a.orgId }]);
    });
  });
});
