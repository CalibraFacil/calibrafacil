/**
 * portal-cross-tenant.int.spec.ts - REQ-ORGDB-4 [HIGH RISK].
 *
 * Two laboratories, each with a portal customer and a full set of records
 * (asset, certificate, request, visit, out-of-tolerance event and notification,
 * audit pack, notification, service order). The portal session of lab A's
 * customer presents lab B's ids / public ids / request ids / tokens on every
 * portal endpoint: the answer is 404 (or an empty / own-data-only list), never
 * lab B's data, and lab B's rows are untouched afterwards.
 *
 * Only the portal session is mocked (test/integration/setup). The tenant SQL
 * guard runs in enforce mode: a statement on a tenant table without an
 * organization predicate fails the test that issued it, which is how the
 * statements decision Q30 names (request-detail visit lookup, request-batch
 * duplicate check, service-order resolvers, out-of-tolerance acknowledge
 * update, publicId asset resolver) are held to the predicate.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetOotAuditLog,
  assetOotEvent,
  assetType,
  calibrationRequest,
  calibrationRequestItem,
  calibrationVisit,
  nonConformance,
  notification,
  notificationPreference,
  ootNotification,
  portalExportJob,
  service,
  serviceOrder,
  serviceOrderQuote,
  visitRescheduleRequest,
} from "@calibra-facil/db/schema";
import { portalRouter } from "./portal";
import { portalRequestsRouter } from "./portal-requests";
import { portalVisitsRouter } from "./portal-visits";
import { portalNotificationsRouter } from "./portal-notifications";
import { portalServiceOrdersRouter } from "./service-orders";
import { seedAssetOotEvent } from "../../test/integration/oot-fixtures";
import { loginAsPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { insertJobs } from "../../test/integration/job-fixtures";
import {
  seedPortalContext,
  seedService,
  seedStandard,
} from "../../test/integration/seed";

const ORIGIN = { origin: "http://localhost" };
const JSON_HEADERS = { ...ORIGIN, "content-type": "application/json" };

type Router = { request: (path: string, init?: RequestInit) => unknown };

async function call(
  router: Router,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const response = await router.request(path, {
    method,
    headers: body === undefined ? ORIGIN : JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!(response instanceof Response)) throw new Error("no response");
  return { status: response.status, text: await response.text() };
}

/** Everything lab B owns carries this marker in a name the API could echo. */
const MARKER = "SECRET-B";

type Lab = Awaited<ReturnType<typeof seedLab>>;

async function seedLab(params: {
  tag: "a" | "b";
  assetTypeId: number;
  // The marker only goes on lab B's records.
  label: string;
}) {
  const { tag, assetTypeId, label } = params;
  const ctx = await seedPortalContext({
    labOrgId: `lab-${tag}`,
    clientOrgId: `client-${tag}`,
    portalUserId: `user-${tag}`,
    customerName: `Customer ${label}`,
  });
  const serviceId = await seedService({
    organizationId: ctx.labOrgId,
    unitId: ctx.labUnitId,
    name: `Servico ${label}`,
  });
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      labOrganizationId: ctx.labOrgId,
      assetTypeId,
      name: `Ativo ${label}`,
      serialNumber: `SN-${label}`,
      tag: `TAG-${label}`,
      status: "ACTIVE",
      nextCalibrationDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: asset.id, publicId: asset.publicId });
  if (!assetRow) throw new Error("asset not seeded");

  const certificateCode = `CERT-${label}`;
  const [job] = await insertJobs({
    jobId: certificateCode,
    certificateName: certificateCode,
    organizationId: ctx.labOrgId,
    unitId: ctx.labUnitId,
    customerId: ctx.customerId,
    assetId: assetRow.id,
    serviceId,
    createdBy: ctx.portalUserId,
    status: "APPROVED",
    approvedAt: new Date("2026-03-10T12:00:00.000Z"),
    performedAt: new Date("2026-03-10T12:00:00.000Z"),
    approvedBy: ctx.portalUserId,
    certificateUrl: `https://certificates.calibrafacil.com/org/test/${certificateCode}.pdf`,
    asFoundConformity: "NON_CONFORMING",
    methodSnapshot: {
      methodId: 0,
      methodName: "Metodo",
      methodVersion: 1,
      accreditedScope: false,
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
    },
  });
  if (!job) throw new Error("job not seeded");

  const standardId = await seedStandard({
    organizationId: ctx.labOrgId,
    unitId: ctx.labUnitId,
    createdBy: ctx.portalUserId,
  });

  const [request] = await db
    .insert(calibrationRequest)
    .values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      authOrganizationId: ctx.clientOrgId,
      submittedBy: ctx.portalUserId,
      status: "PENDING",
      observations: `Pedido ${label}`,
    })
    .returning({ id: calibrationRequest.id });
  if (!request) throw new Error("request not seeded");
  await db.insert(calibrationRequestItem).values({
    organizationId: ctx.labOrgId,
    requestId: request.id,
    assetId: assetRow.id,
  });

  const [visit] = await db
    .insert(calibrationVisit)
    .values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      createdBy: ctx.portalUserId,
      status: "PROPOSED",
      scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      sourceRequestId: request.id,
      address: `Rua ${label}`,
    })
    .returning({ id: calibrationVisit.id });
  if (!visit) throw new Error("visit not seeded");

  const [nc] = await db
    .insert(nonConformance)
    .values({
      ncNumber: `NC-${label}`,
      organizationId: ctx.labOrgId,
      jobId: job.id,
      type: "calibration",
      description: `Desvio ${label}`,
      detectedBy: ctx.portalUserId,
      detectedAt: new Date("2026-03-11T12:00:00.000Z"),
      createdBy: ctx.portalUserId,
    })
    .returning({ id: nonConformance.id });
  if (!nc) throw new Error("nc not seeded");
  const [ootNotice] = await db
    .insert(ootNotification)
    .values({
      organizationId: ctx.labOrgId,
      ncId: nc.id,
      jobId: job.id,
      certificateNumber: certificateCode,
      status: "SENT",
      sentAt: new Date("2026-03-12T12:00:00.000Z"),
      approvedBy: ctx.portalUserId,
    })
    .returning({ id: ootNotification.id, token: ootNotification.ackToken });
  if (!ootNotice) throw new Error("oot notification not seeded");

  const { eventId } = await seedAssetOotEvent({
    jobId: job.id,
    assetId: assetRow.id,
    customerId: ctx.customerId,
    labOrganizationId: ctx.labOrgId,
    detectedAt: new Date("2026-03-10T12:00:00.000Z"),
    actorUserId: ctx.portalUserId,
  });

  const [pack] = await db
    .insert(portalExportJob)
    .values({
      kind: "AUDIT_PACK",
      labOrganizationId: ctx.labOrgId,
      authOrganizationId: ctx.clientOrgId,
      requestedByUserId: ctx.portalUserId,
      params: {
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        unitId: null,
        include: {
          certificates: true,
          fleetReport: true,
          verificationIndex: true,
        },
        customerIds: [ctx.customerId],
      },
      status: "COMPLETED",
      r2Key: `packs/${label}.zip`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      includedJobIds: [job.id],
    })
    .returning({ id: portalExportJob.id });
  if (!pack) throw new Error("pack not seeded");

  const [bell] = await db
    .insert(notification)
    .values({
      recipientUserId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
      type: "CERTIFICATE_READY",
      title: `Aviso ${label}`,
      message: `Mensagem ${label}`,
    })
    .returning({ id: notification.id });
  if (!bell) throw new Error("notification not seeded");

  await db.insert(notificationPreference).values({
    userId: ctx.portalUserId,
    preferences: {},
    digestFrequency: tag === "b" ? "WEEKLY" : "NONE",
  });

  const [order] = await db
    .insert(serviceOrder)
    .values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      serviceOrderNumber: `OS-${label}`,
      customerId: ctx.customerId,
      assetId: assetRow.id,
      openedByUserId: ctx.portalUserId,
      claimedDefect: "Nao liga",
      intakeCondition: "Riscos",
      status: "awaiting_quote_approval",
    })
    .returning({ id: serviceOrder.id, publicId: serviceOrder.publicId });
  if (!order) throw new Error("service order not seeded");
  const [quote] = await db
    .insert(serviceOrderQuote)
    .values({
      organizationId: ctx.labOrgId,
      serviceOrderId: order.id,
      quoteNumber: `ORC-${label}`,
      version: 1,
      createdByUserId: ctx.portalUserId,
    })
    .returning({ id: serviceOrderQuote.id });
  if (!quote) throw new Error("quote not seeded");

  return {
    ctx,
    label,
    assetId: assetRow.id,
    assetPublicId: assetRow.publicId,
    jobId: job.id,
    certificateCode,
    standardId,
    requestId: request.id,
    visitId: visit.id,
    ootToken: ootNotice.token,
    ootEventId: eventId,
    packId: pack.id,
    notificationId: bell.id,
    orderId: order.id,
    orderPublicId: order.publicId,
    quoteId: quote.id,
  };
}

let labA: Lab;
let labB: Lab;

function asLabAPortalUser() {
  loginAsPortal({
    userId: labA.ctx.portalUserId,
    organizationId: labA.ctx.clientOrgId,
  });
}

/** 404, or a 200 that carries none of lab B's records. */
function expectNotFound(result: { status: number; text: string }) {
  expect(result.status).toBe(404);
  expect(result.text).not.toContain(MARKER);
}

function expectNoLabBData(result: { status: number; text: string }) {
  expect(result.status).toBe(200);
  expect(result.text).not.toContain(MARKER);
}

describe("portal: lab B's identifiers in lab A's session (REQ-ORGDB-4)", () => {
  beforeAll(async () => {
    await truncateAll();
    const [type] = await db
      .insert(assetType)
      .values({ name: "Balanca", slug: "balanca", definition: [] })
      .returning({ id: assetType.id });
    if (!type) throw new Error("asset type not seeded");
    labA = await seedLab({ tag: "a", assetTypeId: type.id, label: "A-OWN" });
    labB = await seedLab({ tag: "b", assetTypeId: type.id, label: MARKER });
  }, 120_000);

  beforeEach(() => {
    asLabAPortalUser();
  });

  // ---------------------------------------------------------------- positive
  it("REQ-ORGDB-4: control - lab A's own records resolve in its own session", async () => {
    const own = await call(portalRouter, "GET", `/assets/${labA.assetId}`);
    expect(own.status).toBe(200);
    const byPublicId = await call(
      portalRouter,
      "GET",
      `/assets/${labA.assetPublicId}`,
    );
    expect(byPublicId.status).toBe(200);
    expect((await call(portalRouter, "GET", `/certificates`)).text).toContain(
      labA.certificateCode,
    );
    expect(
      (await call(portalRequestsRouter, "GET", `/${labA.requestId}`)).status,
    ).toBe(200);
    expect(
      (await call(portalServiceOrdersRouter, "GET", `/${labA.orderPublicId}`))
        .status,
    ).toBe(200);
  });

  // ------------------------------------------------------------------ assets
  it("REQ-ORGDB-4: asset detail, interval-insight, report, drift series, by id and by publicId", async () => {
    for (const param of [labB.assetId, labB.assetPublicId]) {
      for (const suffix of [
        "",
        "/interval-insight",
        "/interval-insight/report",
        "/drift-series",
      ]) {
        // eslint-disable-next-line no-await-in-loop -- sequential keeps failures readable
        expectNotFound(
          await call(portalRouter, "GET", `/assets/${param}${suffix}`),
        );
      }
    }
  }, 60_000);

  it("REQ-ORGDB-4: PUT interval on lab B's asset is 404 and changes nothing", async () => {
    const before = await db
      .select({ updatedAt: asset.updatedAt })
      .from(asset)
      .where(eq(asset.id, labB.assetId));
    for (const param of [labB.assetId, labB.assetPublicId]) {
      // eslint-disable-next-line no-await-in-loop -- sequential keeps failures readable
      expectNotFound(
        await call(portalRouter, "PUT", `/assets/${param}/interval`, {
          intervalMonths: 6,
          rationale: "Tentativa de alterar o instrumento de outro laboratorio.",
        }),
      );
    }
    const after = await db
      .select({ updatedAt: asset.updatedAt })
      .from(asset)
      .where(eq(asset.id, labB.assetId));
    expect(after).toEqual(before);
  });

  it("REQ-ORGDB-4: asset list, calendar, units, fleet and overview only carry lab A", async () => {
    const unit = labB.ctx.customerId;
    for (const path of [
      "/assets",
      `/assets?unitId=${unit}`,
      "/calendar?from=2026-06-01&to=2026-06-30",
      `/calendar?from=2026-06-01&to=2026-06-30&unitId=${unit}`,
      "/units",
      "/units/summary",
      "/analytics/fleet",
      "/overview",
    ]) {
      // eslint-disable-next-line no-await-in-loop -- sequential keeps failures readable
      const result = await call(portalRouter, "GET", path);
      expect(result.status, path).toBe(200);
      expect(result.text, path).not.toContain(MARKER);
    }
    // A unit filter naming lab B's customer is not one of lab A's units.
    expectNotFound(
      await call(portalRouter, "GET", `/analytics/fleet?unitId=${unit}`),
    );
    const overview = JSON.parse(
      (await call(portalRouter, "GET", "/overview")).text,
    );
    expect(overview.equipment.total).toBe(1);
    expect(overview.requests.total).toBe(1);
    expect(overview.serviceOrders.total).toBe(1);
  }, 60_000);

  it("REQ-ORGDB-4: GET /organizations lists only the signed-in user's own client organizations", async () => {
    const result = await call(portalRouter, "GET", "/organizations");
    expectNoLabBData(result);
    expect(
      JSON.parse(result.text).map((row: { id: string }) => row.id),
    ).toEqual([labA.ctx.clientOrgId]);
  });

  it("REQ-ORGDB-4: notification preferences are the caller's own", async () => {
    const result = await call(portalRouter, "GET", "/notification-preferences");
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text).digestFrequency).toBe("NONE");
  });

  // ------------------------------------------------------------ certificates
  it("REQ-ORGDB-4: certificate detail/download by id and by number, list filtered by lab B's asset", async () => {
    for (const param of [labB.jobId, labB.certificateCode]) {
      for (const suffix of ["", "/download"]) {
        // eslint-disable-next-line no-await-in-loop -- sequential keeps failures readable
        expectNotFound(
          await call(portalRouter, "GET", `/certificates/${param}${suffix}`),
        );
      }
      // eslint-disable-next-line no-await-in-loop -- sequential keeps failures readable
      expectNotFound(
        await call(
          portalRouter,
          "GET",
          `/certificates/${param}/reference-standards/${labB.standardId}/certificate/download`,
        ),
      );
    }
    const list = await call(
      portalRouter,
      "GET",
      `/certificates?assetId=${labB.assetId}`,
    );
    expectNoLabBData(list);
    expect(JSON.parse(list.text).data).toEqual([]);
    expectNoLabBData(await call(portalRouter, "GET", "/certificates"));
  }, 60_000);

  // ------------------------------------------------------------- audit packs
  it("REQ-ORGDB-4: audit packs - lab B's pack cannot be listed or downloaded, its customer is not a valid unit", async () => {
    expectNotFound(
      await call(portalRouter, "GET", `/audit-packs/${labB.packId}/download`),
    );
    const list = await call(portalRouter, "GET", "/audit-packs");
    expectNoLabBData(list);
    expect(
      JSON.parse(list.text).data.map((row: { id: number }) => row.id),
    ).not.toContain(labB.packId);
    const create = await call(portalRouter, "POST", "/audit-packs", {
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      unitId: labB.ctx.customerId,
      include: {
        certificates: true,
        fleetReport: false,
        verificationIndex: false,
      },
    });
    expect(create.status).toBe(400);
    expect(
      await db
        .select({ id: portalExportJob.id })
        .from(portalExportJob)
        .where(eq(portalExportJob.labOrganizationId, labB.ctx.labOrgId)),
    ).toHaveLength(1);
  });

  // -------------------------------------------------------------- OOT notices
  it("REQ-ORGDB-4: lab B's out-of-tolerance notice cannot be listed or acknowledged with its token", async () => {
    const list = await call(portalRouter, "GET", "/oot-notifications");
    expectNoLabBData(list);
    expect(JSON.parse(list.text).data).toHaveLength(1);

    expectNotFound(
      await call(
        portalRouter,
        "POST",
        `/oot-notifications/${labB.ootToken}/acknowledge`,
      ),
    );
    const [row] = await db
      .select({
        status: ootNotification.status,
        acknowledgedAt: ootNotification.acknowledgedAt,
      })
      .from(ootNotification)
      .where(eq(ootNotification.ackToken, labB.ootToken));
    expect(row).toEqual({ status: "SENT", acknowledgedAt: null });
  });

  it("REQ-ORGDB-4: lab A acknowledges its own notice; the update never reaches lab B's", async () => {
    const [own] = await db
      .select({ token: ootNotification.ackToken })
      .from(ootNotification)
      .where(eq(ootNotification.organizationId, labA.ctx.labOrgId));
    if (!own) throw new Error("lab A notice missing");
    const ack = await call(
      portalRouter,
      "POST",
      `/oot-notifications/${own.token}/acknowledge`,
    );
    expect(ack.status).toBe(200);
    const rows = await db
      .select({
        org: ootNotification.organizationId,
        status: ootNotification.status,
      })
      .from(ootNotification);
    expect(rows.find((row) => row.org === labA.ctx.labOrgId)?.status).toBe(
      "ACKNOWLEDGED",
    );
    expect(rows.find((row) => row.org === labB.ctx.labOrgId)?.status).toBe(
      "SENT",
    );
  });

  // --------------------------------------------------------------- OOT events
  it("REQ-ORGDB-4: lab B's out-of-tolerance event and its assessment are invisible and unwritable", async () => {
    const auditBefore = await db
      .select({ id: assetOotAuditLog.id })
      .from(assetOotAuditLog)
      .where(eq(assetOotAuditLog.eventId, labB.ootEventId));
    const list = await call(portalRouter, "GET", "/oot-events");
    expectNoLabBData(list);
    expect(
      JSON.parse(list.text).data.map((row: { id: number }) => row.id),
    ).not.toContain(labB.ootEventId);
    expectNotFound(
      await call(
        portalRouter,
        "POST",
        `/oot-events/${labB.ootEventId}/assessment`,
        {
          decision: "NO_IMPACT",
          rationale: "Tentativa de avaliar o evento de outro laboratorio.",
        },
      ),
    );
    const [event] = await db
      .select({ status: assetOotEvent.status })
      .from(assetOotEvent)
      .where(eq(assetOotEvent.id, labB.ootEventId));
    expect(event?.status).toBe("OPEN");
    expect(
      await db
        .select({ id: assetOotAuditLog.id })
        .from(assetOotAuditLog)
        .where(eq(assetOotAuditLog.eventId, labB.ootEventId)),
    ).toEqual(auditBefore);
  });

  // ---------------------------------------------------------------- requests
  it("REQ-ORGDB-4: calibration requests - lab B's request id, list, create and batch", async () => {
    expectNotFound(
      await call(portalRequestsRouter, "GET", `/${labB.requestId}`),
    );
    const list = await call(portalRequestsRouter, "GET", "/");
    expectNoLabBData(list);
    expect(JSON.parse(list.text).pagination.total).toBe(1);

    // Own request detail: the visit lookup returns lab A's visit only.
    const own = await call(portalRequestsRouter, "GET", `/${labA.requestId}`);
    expect(own.status).toBe(200);
    expect(own.text).not.toContain(MARKER);

    const before = await db
      .select({ id: calibrationRequest.id })
      .from(calibrationRequest)
      .where(eq(calibrationRequest.organizationId, labB.ctx.labOrgId));
    for (const path of ["/", "/batch"]) {
      // eslint-disable-next-line no-await-in-loop -- sequential keeps failures readable
      const created = await call(portalRequestsRouter, "POST", path, {
        assetIds: [labB.assetId],
        deliveryMethod: "dropoff",
      });
      expect(created.status, path).toBe(400);
    }
    expect(
      await db
        .select({ id: calibrationRequest.id })
        .from(calibrationRequest)
        .where(eq(calibrationRequest.organizationId, labB.ctx.labOrgId)),
    ).toEqual(before);
  }, 60_000);

  it("REQ-ORGDB-4: the request-batch duplicate check only looks at lab A's own requests", async () => {
    // Lab B's asset already has an active request; lab A's asset also has one
    // (seeded above), so a batch for A's asset is a duplicate, never one for a
    // fresh asset that merely shares a number space with lab B's rows.
    const duplicate = await call(portalRequestsRouter, "POST", "/batch", {
      assetIds: [labA.assetId],
      deliveryMethod: "dropoff",
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.text).toContain("ativa");
  });

  // ------------------------------------------------------------------ visits
  it("REQ-ORGDB-4: visits - lab B's visit is not listed, confirmed or rescheduled", async () => {
    const list = await call(portalVisitsRouter, "GET", "/");
    expectNoLabBData(list);
    expect(JSON.parse(list.text).data).toHaveLength(1);

    expectNotFound(
      await call(portalVisitsRouter, "POST", `/${labB.visitId}/confirm`),
    );
    expectNotFound(
      await call(
        portalVisitsRouter,
        "POST",
        `/${labB.visitId}/reschedule-request`,
        {
          reason: "Quero mexer na visita de outro laboratorio",
          preferredWindows: [{ date: "2026-12-01", period: "ANY" }],
        },
      ),
    );
    const [visit] = await db
      .select({ confirmedAt: calibrationVisit.customerConfirmedAt })
      .from(calibrationVisit)
      .where(eq(calibrationVisit.id, labB.visitId));
    expect(visit?.confirmedAt).toBeNull();
    expect(
      await db
        .select({ id: visitRescheduleRequest.id })
        .from(visitRescheduleRequest)
        .where(eq(visitRescheduleRequest.visitId, labB.visitId)),
    ).toEqual([]);
  });

  // ----------------------------------------------------------- notifications
  it("REQ-ORGDB-4: the bell only carries lab A's rows; marking lab B's ids read changes nothing", async () => {
    const list = await call(portalNotificationsRouter, "GET", "/");
    expectNoLabBData(list);
    expect(list.text).toContain("Aviso A-OWN");

    const marked = await call(portalNotificationsRouter, "POST", "/mark-read", {
      notificationIds: [labB.notificationId],
    });
    expect(marked.status).toBe(200);
    expect(JSON.parse(marked.text).updatedIds).toEqual([]);

    const all = await call(portalNotificationsRouter, "POST", "/mark-all-read");
    expect(all.status).toBe(200);
    const [bell] = await db
      .select({ status: notification.status })
      .from(notification)
      .where(eq(notification.id, labB.notificationId));
    expect(bell?.status).toBe("UNREAD");
  });

  // ----------------------------------------------------------- service orders
  it("REQ-ORGDB-4: service orders - lab B's public id and quote resolve to 404, the list is lab A's", async () => {
    const list = await call(portalServiceOrdersRouter, "GET", "/");
    expectNoLabBData(list);
    expect(JSON.parse(list.text).pagination.total).toBe(1);

    for (const path of [
      `/${labB.orderPublicId}`,
      `/${labB.orderPublicId}/financial-summary`,
    ]) {
      // eslint-disable-next-line no-await-in-loop -- sequential keeps failures readable
      expectNotFound(await call(portalServiceOrdersRouter, "GET", path));
    }
    for (const action of ["approve", "reject"]) {
      // eslint-disable-next-line no-await-in-loop -- sequential keeps failures readable
      const result = await call(
        portalServiceOrdersRouter,
        "POST",
        `/${labB.orderPublicId}/quotes/${labB.quoteId}/${action}`,
        action === "reject" ? { rejectionReason: "Nao quero" } : {},
      );
      expect(result.status, action).toBe(404);
    }
    const [quote] = await db
      .select({ status: serviceOrderQuote.status })
      .from(serviceOrderQuote)
      .where(eq(serviceOrderQuote.id, labB.quoteId));
    expect(quote?.status).toBe("draft");
  });

  // ------------------------------------------------------------- raw sanity
  it("REQ-ORGDB-4: the seeded world really has two laboratories with their own rows", async () => {
    const rows = await db
      .select({ org: service.organizationId })
      .from(service)
      .where(
        sql`${service.organizationId} in (${labA.ctx.labOrgId}, ${labB.ctx.labOrgId})`,
      );
    expect(new Set(rows.map((row) => row.org)).size).toBe(2);
  });
});
