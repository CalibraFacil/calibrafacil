/**
 * visits-requests-contract.int.spec.ts: the cloud half of the visits,
 * calibration-requests and signatures endpoint definitions
 * (`packages/contracts/src/endpoints/{visits,calibration-requests,signatures}.ts`).
 * Each client-facing endpoint is called for real (real handlers, real
 * middleware, real Postgres) and its body is parsed with the response schema of
 * its definition. `mount` also checks each body with that schema in the
 * integration tier (`checkEndpointResponses`), so a drift fails the request
 * itself; the explicit parse here names the drifting path and the status.
 *
 * Not covered here: `POST /api/visits/:id/jobs` and `DELETE /api/visits/:id/jobs/:jobId`
 * and `POST /api/calibration-requests/:id/convert` (they need a published
 * method to create jobs); `visits.int.spec.ts` and `calibration-requests.int.spec.ts`
 * call them for real and `mount` checks those bodies against the definitions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  calibrationRequestEndpoints,
  signatureEndpoints,
  visitEndpoints,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationRequest,
  calibrationRequestItem,
  calibrationVisit,
  visitRescheduleRequest,
} from "@calibra-facil/db/schema";
import { sql } from "drizzle-orm";
import { calibrationRequestsRouter } from "./calibration-requests";
import { signaturesRouter } from "../../../routes/signatures";
import {
  visitJobsRouter,
  visitRescheduleRequestsRouter,
  visitsRouter,
} from "./visits";
import { organizationOf } from "../../../../test/integration/organization-of";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedCustomer, seedOrg } from "../../../../test/integration/seed";
import { seedExtraMember } from "../../../../test/integration/tenant-refs";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

vi.mock("@calibra-facil/notifications", () => ({
  notifyCalibrationRequestApproved: vi.fn().mockResolvedValue(undefined),
  notifyCalibrationRequestConverted: vi.fn().mockResolvedValue(undefined),
  notifyCalibrationRequestRejected: vi.fn().mockResolvedValue(undefined),
  notifyCalibrationRequestUnderReview: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyVisitScheduled: vi.fn().mockResolvedValue(undefined),
  notifyVisitConfirmed: vi.fn().mockResolvedValue(undefined),
  notifyVisitCancelled: vi.fn().mockResolvedValue(undefined),
  notifyVisitRescheduled: vi.fn().mockResolvedValue(undefined),
  notifyVisitRescheduleDeclined: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/storage", () => ({
  createR2Client: () => ({}),
  uploadToR2: () => Promise.resolve(),
  deleteFromR2: () => Promise.resolve(),
  generatePresignedUrl: () => Promise.resolve("https://r2.test/signed"),
  resolveBucketName: () => "media-test",
  resolveReadBucketName: () => Promise.resolve("media-test"),
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

function post(body: unknown = {}) {
  return { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) };
}

async function seedLab() {
  const org = await seedOrg({ orgId: "org-visits-contract", role: "admin" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    authOrganizationId: "client-visits-contract",
    name: "Cliente Visitas",
  });
  const technician = await seedExtraMember({
    orgId: org.orgId,
    userId: "tech-visits-contract",
    role: "technician",
    unitId: org.unitId,
    unitRole: "technician",
  });
  return { org, customerId, technician };
}

async function seedVisit(
  org: { orgId: string; unitId: number; userId: string },
  customerId: number,
  scheduledAt: Date | null = null,
) {
  const [row] = await withStatusRepair((tx) =>
    tx
      .insert(calibrationVisit)
      .values({
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId,
        createdBy: org.userId,
        status: "PROPOSED",
        scheduledAt,
        address: { city: "Campinas", state: "SP" },
      })
      .returning({ id: calibrationVisit.id }),
  );
  if (!row) throw new Error("seedVisit: insert failed");
  return row.id;
}

async function seedPendingReschedule(
  org: { orgId: string; userId: string },
  customerId: number,
  visitId: number,
) {
  const [row] = await withStatusRepair((tx) =>
    tx
      .insert(visitRescheduleRequest)
      .values({
        visitId,
        organizationId: org.orgId,
        customerId,
        requestedBy: org.userId,
        reason: "Equipe indisponível",
        preferredWindows: [{ date: "2026-09-10", period: "MORNING" }],
      })
      .returning({ id: visitRescheduleRequest.id }),
  );
  if (!row) throw new Error("seedPendingReschedule: insert failed");
  return row.id;
}

describe("visits endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("list, get with a pending reschedule request, then decline it", async () => {
    const { org, customerId } = await seedLab();
    const visitId = await seedVisit(org, customerId);
    const requestId = await seedPendingReschedule(org, customerId, visitId);

    const list = await parsedBody(
      await visitsRouter.request("/?page=1&limit=20"),
      visitEndpoints.list.response,
    );
    expect(list.data).toMatchObject([
      {
        id: visitId,
        customerName: "Cliente Visitas",
        rescheduleRequested: true,
      },
    ]);

    const detail = await parsedBody(
      await visitsRouter.request(`/${visitId}`),
      visitEndpoints.get.response,
    );
    expect(detail.pendingRescheduleRequest?.id).toBe(requestId);

    const declined = await parsedBody(
      await visitRescheduleRequestsRouter.request(
        `/${visitId}/reschedule-requests/${requestId}/decline`,
        post({ resolutionNote: "Sem agenda" }),
      ),
      visitEndpoints.declineRescheduleRequest.response,
    );
    expect(declined.map((row) => row.status)).toEqual(["DECLINED"]);
  });

  it("assign, accept a reschedule request, confirm, reschedule and complete", async () => {
    const { org, customerId, technician } = await seedLab();
    const visitId = await seedVisit(org, customerId);

    const assigned = await parsedBody(
      await visitsRouter.request(
        `/${visitId}/assign`,
        post({ technicianId: technician.userId }),
      ),
      visitEndpoints.assign.response,
    );
    expect(assigned.technicianId).toBe(technician.userId);

    const requestId = await seedPendingReschedule(org, customerId, visitId);
    const accepted = await parsedBody(
      await visitRescheduleRequestsRouter.request(
        `/${visitId}/reschedule-requests/${requestId}/accept`,
        post({ scheduledAt: "2026-09-10T15:00:00.000Z" }),
      ),
      visitEndpoints.acceptRescheduleRequest.response,
    );
    expect(accepted.scheduledAt).toBe("2026-09-10T15:00:00.000Z");

    const confirmed = await parsedBody(
      await visitsRouter.request(`/${visitId}/confirm`, post({})),
      visitEndpoints.confirm.response,
    );
    expect(confirmed.status).toBe("CONFIRMED");

    const rescheduled = await parsedBody(
      await visitsRouter.request(`/${visitId}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          scheduledAt: "2026-09-12T15:00:00.000Z",
          notes: "Levar padrões",
        }),
      }),
      visitEndpoints.reschedule.response,
    );
    expect(rescheduled.notes).toBe("Levar padrões");

    const completed = await parsedBody(
      await visitsRouter.request(`/${visitId}/complete`, post()),
      visitEndpoints.complete.response,
    );
    expect(completed.status).toBe("COMPLETED");
  });

  it("cancel answers the cancelled row", async () => {
    const { org, customerId } = await seedLab();
    const visitId = await seedVisit(org, customerId);

    const cancelled = await parsedBody(
      await visitsRouter.request(
        `/${visitId}/cancel`,
        post({ reason: "Cliente desistiu" }),
      ),
      visitEndpoints.cancel.response,
    );
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      cancelReason: "Cliente desistiu",
    });
  });

  it("the jobs router is mounted at the same prefix as the definitions", async () => {
    const { org, customerId } = await seedLab();
    const visitId = await seedVisit(org, customerId);

    // An unknown asset is refused by the handler (400): the route is served.
    const response = await visitJobsRouter.request(
      `/${visitId}/jobs`,
      post({ assetId: 999999, serviceId: 999999 }),
    );
    expect(response.status).toBe(400);
  });
});

describe("calibration-requests endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function seedRequest() {
    const org = await seedOrg({
      orgId: "org-requests-contract",
      role: "admin",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const customerId = await seedCustomer({
      labOrganizationId: org.orgId,
      authOrganizationId: "client-requests-contract",
      name: "Cliente Solicitações",
    });
    const [type] = await db
      .insert(assetType)
      .values({ name: "Balança", slug: "balanca-requests", definition: [] })
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
          serialNumber: "SN-REQ",
          tag: "EQ-REQ",
        })
        .returning({ id: asset.id }),
    );
    const [request] = await withStatusRepair((tx) =>
      tx
        .insert(calibrationRequest)
        .values({
          organizationId: org.orgId,
          unitId: org.unitId,
          customerId,
          authOrganizationId: "client-requests-contract",
          status: "PENDING",
          deliveryMethod: "dropoff",
          submittedBy: org.userId,
          observations: "Urgente",
          submittedAt: new Date("2026-01-15T10:00:00.000Z"),
        })
        .returning({ id: calibrationRequest.id }),
    );
    if (!request) throw new Error("seedRequest: insert failed");
    await db.insert(calibrationRequestItem).values({
      organizationId: organizationOf("calibration_request", request.id),
      requestId: request.id,
      assetId: assetRow?.id ?? 0,
      convertedJobId: null,
    });
    return request.id;
  }

  it("list and get", async () => {
    const requestId = await seedRequest();

    const list = await parsedBody(
      await calibrationRequestsRouter.request("/?page=1&limit=20"),
      calibrationRequestEndpoints.list.response,
    );
    expect(list.data).toMatchObject([
      { id: requestId, itemCount: 1, customerName: "Cliente Solicitações" },
    ]);

    const detail = await parsedBody(
      await calibrationRequestsRouter.request(`/${requestId}`),
      calibrationRequestEndpoints.get.response,
    );
    expect(detail.items.map((item) => item.assetTag)).toEqual(["EQ-REQ"]);
  });

  it("review, approve and reject answer success", async () => {
    const requestId = await seedRequest();

    await parsedBody(
      await calibrationRequestsRouter.request(
        `/${requestId}/review`,
        post({ internalNotes: "Em análise" }),
      ),
      calibrationRequestEndpoints.review.response,
    );
    await parsedBody(
      await calibrationRequestsRouter.request(
        `/${requestId}/approve`,
        post({}),
      ),
      calibrationRequestEndpoints.approve.response,
    );

    const other = await seedRequestOf(requestId);
    await parsedBody(
      await calibrationRequestsRouter.request(
        `/${other}/reject`,
        post({ reason: "Fora do escopo" }),
      ),
      calibrationRequestEndpoints.reject.response,
    );
  });

  /** A second PENDING request on the same asset and customer as `requestId`. */
  async function seedRequestOf(requestId: number) {
    const [source] = await db
      .select()
      .from(calibrationRequest)
      .where(sql`${calibrationRequest.id} = ${requestId}`);
    if (!source) throw new Error("source request missing");
    const [row] = await withStatusRepair((tx) =>
      tx
        .insert(calibrationRequest)
        .values({
          organizationId: source.organizationId,
          unitId: source.unitId,
          customerId: source.customerId,
          authOrganizationId: source.authOrganizationId,
          status: "PENDING",
          deliveryMethod: "dropoff",
          submittedBy: source.submittedBy,
        })
        .returning({ id: calibrationRequest.id }),
    );
    if (!row) throw new Error("seedRequestOf: insert failed");
    return row.id;
  }
});

describe("signatures endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  /** A PNG header of 200x100 pixels: the handler reads only the magic and the IHDR size. */
  function pngForm() {
    const buf = Buffer.alloc(25);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    buf.writeUInt32BE(200, 16);
    buf.writeUInt32BE(100, 20);
    const form = new FormData();
    form.append("signature", new File([buf], "sig.png", { type: "image/png" }));
    return form;
  }

  it("getMine answers absent, then present after the upload, then absent after the delete", async () => {
    const org = await seedOrg({
      orgId: "org-signatures-contract",
      role: "admin",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const absent = await parsedBody(
      await signaturesRouter.request("/my-signature"),
      signatureEndpoints.getMine.response,
    );
    expect(absent.hasSignature).toBe(false);

    const uploaded = await parsedBody(
      await signaturesRouter.request("/my-signature", {
        method: "POST",
        body: pngForm(),
      }),
      signatureEndpoints.uploadMine.response,
    );
    expect(uploaded.dimensions).toEqual({ width: 200, height: 100 });

    const present = await parsedBody(
      await signaturesRouter.request("/my-signature"),
      signatureEndpoints.getMine.response,
    );
    expect(present).toMatchObject({
      hasSignature: true,
      dimensions: { width: 200, height: 100 },
    });

    await parsedBody(
      await signaturesRouter.request("/my-signature", { method: "DELETE" }),
      signatureEndpoints.deleteMine.response,
    );
  });
});
