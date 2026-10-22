/**
 * portal-engagement-contract.int.spec.ts: P2-15 REQ-TC-3, second half. The REAL
 * responses (real handlers, real portal middleware, real Postgres) of the
 * portal's notification, out-of-tolerance notice, visit, calibration-request and
 * service-order endpoints must parse with the `@calibra-facil/contracts` schemas
 * the portal validates its fetches with.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  portalNotificationCountResponseSchema,
  portalNotificationFeedResponseSchema,
  portalNotificationMarkReadResponseSchema,
  portalOotNotificationsResponseSchema,
  portalRequestsResponseSchema,
  portalVisitConfirmResponseSchema,
  portalVisitRescheduleResponseSchema,
  portalVisitsResponseSchema,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationRequest,
  calibrationRequestItem,
  calibrationVisit,
  nonConformance,
  notification,
  ootNotification,
  service,
} from "@calibra-facil/db/schema";
import { sql } from "drizzle-orm";
import { portalNotificationsRouter } from "./portal-notifications";
import { portalRequestsRouter } from "./portal-requests";
import { portalVisitsRouter } from "./portal-visits";
import { portalRouter } from "./portal";
import { insertJobs } from "../../test/integration/job-fixtures";
import { loginAsPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedPortalContext } from "../../test/integration/seed";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@calibra-facil/notifications")>();
  return {
    ...actual,
    notifyCalibrationRequestSubmitted: vi.fn().mockResolvedValue(undefined),
    notifyVisitCustomerConfirmed: vi.fn().mockResolvedValue(undefined),
    notifyVisitRescheduleRequested: vi.fn().mockResolvedValue(undefined),
    notifyOotAcknowledged: vi.fn().mockResolvedValue(undefined),
  };
});

const LOCAL_ORIGIN = { origin: "http://localhost" };
const JSON_HEADERS = { ...LOCAL_ORIGIN, "content-type": "application/json" };

type Requester = {
  request: (
    path: string,
    init?: RequestInit,
    env?: Record<string, string>,
  ) => Response | Promise<Response>;
};

/** Parses with the contract schema; the issues name the drifting path on failure. */
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

function get(router: Requester, path: string) {
  return router.request(path, { headers: LOCAL_ORIGIN });
}

function send(router: Requester, method: string, path: string, body?: unknown) {
  return router.request(path, {
    method,
    headers: JSON_HEADERS,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function seedLab() {
  const ctx = await seedPortalContext();
  loginAsPortal({ userId: ctx.portalUserId, organizationId: ctx.clientOrgId });
  const [type] = await db
    .insert(assetType)
    .values({ name: "Balança", slug: "balanca-engagement", definition: [] })
    .returning({ id: assetType.id });
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${ctx.customerId})`,
      assetTypeId: type?.id ?? 0,
      name: "Balança A",
      serialNumber: "SN-A1",
      tag: "EQ-A1",
      status: "ACTIVE",
    })
    .returning({ id: asset.id });
  return { ctx, assetId: assetRow?.id ?? 0 };
}

describe("portal engagement endpoints: real responses honor the contract schemas (P2-15 REQ-TC-3)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-TC-3: the notification feed, the unread count and the read marks parse", async () => {
    const { ctx } = await seedLab();
    await db.insert(notification).values({
      recipientUserId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
      type: "CERTIFICATE_READY",
      title: "Certificado disponível",
      message: "O certificado está disponível.",
      status: "UNREAD",
    });

    const feed = await parsedBody(
      await get(portalNotificationsRouter, "/?limit=20"),
      portalNotificationFeedResponseSchema,
    );
    expect(feed.data).toHaveLength(1);
    const unread = await parsedBody(
      await get(portalNotificationsRouter, "/unread-count"),
      portalNotificationCountResponseSchema,
    );
    expect(unread.count).toBe(1);

    const marked = await parsedBody(
      await send(portalNotificationsRouter, "POST", "/mark-read", {
        notificationIds: [feed.data[0]?.id],
      }),
      portalNotificationMarkReadResponseSchema,
    );
    expect(marked.updatedIds).toEqual([feed.data[0]?.id]);
    await parsedBody(
      await send(portalNotificationsRouter, "POST", "/mark-all-read"),
      portalNotificationCountResponseSchema,
    );
  });

  it("REQ-TC-3: the visit list, the confirmation and the reschedule request parse", async () => {
    const { ctx } = await seedLab();
    const [visit] = await db
      .insert(calibrationVisit)
      .values({
        organizationId: ctx.labOrgId,
        unitId: ctx.labUnitId,
        customerId: ctx.customerId,
        createdBy: ctx.portalUserId,
        status: "PROPOSED",
        scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: calibrationVisit.id });

    const list = await parsedBody(
      await get(portalVisitsRouter, "/"),
      portalVisitsResponseSchema,
    );
    expect(list.data.map((row) => row.id)).toEqual([visit?.id]);
    await parsedBody(
      await send(portalVisitsRouter, "POST", `/${visit?.id}/confirm`),
      portalVisitConfirmResponseSchema,
    );
    await parsedBody(
      await send(
        portalVisitsRouter,
        "POST",
        `/${visit?.id}/reschedule-request`,
        {
          reason: "Equipe em treinamento",
          preferredWindows: [{ date: "2099-01-10", period: "MORNING" }],
        },
      ),
      portalVisitRescheduleResponseSchema,
    );
    const after = await parsedBody(
      await get(portalVisitsRouter, "/"),
      portalVisitsResponseSchema,
    );
    expect(after.data[0]?.rescheduleRequest?.status).toBe("PENDING");
  });

  it("REQ-TC-3: the request list parses", async () => {
    const { ctx, assetId } = await seedLab();
    const [request] = await db
      .insert(calibrationRequest)
      .values({
        organizationId: ctx.labOrgId,
        unitId: ctx.labUnitId,
        customerId: ctx.customerId,
        authOrganizationId: ctx.clientOrgId,
        submittedBy: ctx.portalUserId,
        status: "PENDING",
        observations: "Calibração anual",
      })
      .returning({ id: calibrationRequest.id });
    await db.insert(calibrationRequestItem).values({
      organizationId: ctx.labOrgId,
      requestId: request?.id ?? 0,
      assetId,
    });

    const list = await parsedBody(
      await get(portalRequestsRouter, "/?page=1&limit=20"),
      portalRequestsResponseSchema,
    );
    expect(list.data[0]?.itemCount).toBe(1);
    // The detail, the batch create and the service-order endpoints are checked
    // at compile time (`satisfies` at the handlers): their success paths run
    // customer-scoped statements the tenant SQL guard of this tier refuses
    // (see the findings in the P2-15 report).
  });

  it("REQ-TC-3: the out-of-tolerance notices list parses", async () => {
    const { ctx, assetId } = await seedLab();
    const [service_] = await db
      .insert(service)
      .values({
        organizationId: ctx.labOrgId,
        unitId: ctx.labUnitId,
        name: "Calibração",
        isActive: true,
      })
      .returning({ id: service.id });
    const [job] = await insertJobs({
      jobId: "CAL-OOT-1",
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetId,
      serviceId: service_?.id ?? 0,
      createdBy: ctx.portalUserId,
      status: "APPROVED",
      methodSnapshot: {
        methodId: 1,
        methodName: "Método",
        methodVersion: 1,
        dataFields: [],
        variableBindings: [],
        formulas: [],
        measurementModels: [],
        validations: [],
        uncertaintyParams: [],
      },
    });
    const [nc] = await db
      .insert(nonConformance)
      .values({
        ncNumber: "NC-2026-0001",
        organizationId: ctx.labOrgId,
        jobId: job?.id ?? null,
        type: "out_of_tolerance",
        description: "Fora de tolerância",
        detectedBy: ctx.portalUserId,
        detectedAt: new Date(),
        createdBy: ctx.portalUserId,
      })
      .returning({ id: nonConformance.id });
    const [notice] = await db
      .insert(ootNotification)
      .values({
        organizationId: ctx.labOrgId,
        ncId: nc?.id ?? 0,
        jobId: job?.id ?? 0,
        certificateNumber: "CAL-OOT-1",
        status: "SENT",
        approvedBy: ctx.portalUserId,
        sentAt: new Date(),
      })
      .returning({ ackToken: ootNotification.ackToken });

    const list = await parsedBody(
      await get(portalRouter, "/oot-notifications"),
      portalOotNotificationsResponseSchema,
    );
    expect(list.counts).toEqual({ total: 1, pending: 1 });
    expect(list.data[0]?.id).toBe(notice?.ackToken);
  });
});
