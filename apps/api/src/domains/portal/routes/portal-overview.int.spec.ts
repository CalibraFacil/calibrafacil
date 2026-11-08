/**
 * portal-overview.int.spec.ts: GET /overview against a real Postgres and the real portal
 * middleware (only the portal session is mocked). The numbers are fleet-wide and exact, not
 * read off a page of a list.
 *
 *   REQ-POV-1  an unrecognized host is refused, and a customer without data gets a zeroed overview
 *   REQ-POV-2  equipment counts by due status (overdue / due soon / scheduled / unscheduled /
 *              in lab), certificates, requests and service orders are counted for the customer
 *              and for nobody else
 *   REQ-POV-3  a group's overview adds up its branches
 */
import { beforeEach, describe, expect, it } from "vitest";
import { addCalendarDays, labToday } from "@calibra-facil/shared";
import { db } from "@calibra-facil/db";
import {
  calibrationRequest,
  service,
  serviceOrder,
} from "@calibra-facil/db/schema";
import { portalRouter } from "./portal";
import { insertJobs } from "../../../../test/integration/job-fixtures";
import { loginAsPortal } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import {
  seedPortalAsset,
  seedPortalContext,
  seedPortalCustomer,
  seedPortalGroup,
} from "../../../../test/integration/seed";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

const LOCAL_ORIGIN = { origin: "http://localhost" };

type Ctx = Awaited<ReturnType<typeof seedPortalContext>>;

async function getOverview() {
  const res = await portalRouter.request("/overview", {
    headers: LOCAL_ORIGIN,
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function seedOrder(
  ctx: Ctx,
  customerId: number,
  assetId: number,
  number: string,
  status: (typeof serviceOrder.$inferInsert)["status"],
) {
  await withStatusRepair((tx) =>
    tx.insert(serviceOrder).values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      customerId,
      assetId,
      openedByUserId: ctx.portalUserId,
      serviceOrderNumber: number,
      status,
      claimedDefect: "Não liga",
      intakeCondition: "Sem avarias",
      intakeType: "counter",
      deliveryMethod: "pickup_at_lab",
      priority: "normal",
      totalQuotedCents: 0,
      totalApprovedCents: 0,
      evaluationFeeCents: 0,
      evaluationFeeApplied: false,
      isExternalService: false,
    }),
  );
}

async function seedApprovedJob(
  ctx: Ctx,
  customerId: number,
  assetId: number,
  serviceId: number,
  jobId: string,
  certificateUrl: string | null,
) {
  await insertJobs({
    jobId,
    organizationId: ctx.labOrgId,
    unitId: ctx.labUnitId,
    customerId,
    assetId,
    serviceId,
    createdBy: ctx.portalUserId,
    status: "APPROVED",
    approvedAt: new Date("2026-05-10T10:00:00.000Z"),
    certificateUrl,
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
}

async function seedService(ctx: Ctx) {
  const [row] = await db
    .insert(service)
    .values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      name: "Calibração",
      isActive: true,
    })
    .returning({ id: service.id });
  return row?.id ?? 0;
}

describe("GET /overview", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-POV-1: refuses an unrecognized host and answers a zeroed overview for a customer without data", async () => {
    const ctx = await seedPortalContext();
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    expect((await portalRouter.request("/overview")).status).toBe(403);

    const body = await getOverview();
    expect(body.equipment).toEqual({
      total: 0,
      overdue: 0,
      dueSoon: 0,
      scheduled: 0,
      unscheduled: 0,
      inLab: 0,
      attention: [],
    });
    expect(body.certificates).toEqual({ available: 0, recent: [] });
    expect(body.serviceOrders.awaitingQuote).toEqual([]);
  });

  it("REQ-POV-2: counts the customer's fleet, certificates, requests and service orders, and nobody else's", async () => {
    const ctx = await seedPortalContext();
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const today = labToday();
    const overdue = await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      tag: "EQ-OVERDUE",
      nextCalibrationDate: addCalendarDays(today, -5),
    });
    await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      tag: "EQ-SOON",
      nextCalibrationDate: addCalendarDays(today, 10),
    });
    const scheduled = await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      tag: "EQ-LATER",
      nextCalibrationDate: addCalendarDays(today, 200),
    });
    await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      tag: "EQ-NONE",
    });
    // The overdue instrument is at the laboratory (open service order); a delivered order
    // does not count as "in lab".
    await seedOrder(
      ctx,
      ctx.customerId,
      overdue,
      "OS-1",
      "awaiting_quote_approval",
    );
    await seedOrder(ctx, ctx.customerId, scheduled, "OS-2", "delivered");
    await seedOrder(ctx, ctx.customerId, overdue, "OS-3", "ready_for_pickup");

    const serviceId = await seedService(ctx);
    await seedApprovedJob(
      ctx,
      ctx.customerId,
      overdue,
      serviceId,
      "CAL-1",
      "https://files/cert-1.pdf",
    );
    await seedApprovedJob(
      ctx,
      ctx.customerId,
      scheduled,
      serviceId,
      "CAL-2",
      null,
    );

    for (const status of ["PENDING", "REJECTED"] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- two sequential inserts.
      await withStatusRepair((tx) =>
        tx.insert(calibrationRequest).values({
          organizationId: ctx.labOrgId,
          unitId: ctx.labUnitId,
          customerId: ctx.customerId,
          authOrganizationId: ctx.clientOrgId,
          submittedBy: ctx.portalUserId,
          status,
        }),
      );
    }

    // Another customer of the same laboratory: none of it may reach the numbers.
    const other = await seedPortalCustomer({
      labOrgId: ctx.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });
    const otherAsset = await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: other,
      tag: "EQ-B",
      nextCalibrationDate: addCalendarDays(today, -30),
    });
    await seedOrder(ctx, other, otherAsset, "OS-B", "awaiting_quote_approval");
    await seedApprovedJob(
      ctx,
      other,
      otherAsset,
      serviceId,
      "CAL-B",
      "https://files/b.pdf",
    );

    const body = await getOverview();

    expect(body.equipment).toMatchObject({
      total: 4,
      overdue: 1,
      dueSoon: 1,
      scheduled: 1,
      unscheduled: 1,
      inLab: 1,
    });
    // The instruments with a next date, soonest first.
    expect(
      body.equipment.attention.map((item: { tag: string }) => item.tag),
    ).toEqual(["EQ-OVERDUE", "EQ-SOON", "EQ-LATER"]);
    expect(body.certificates.available).toBe(2);
    const recent: Array<{ jobId: string; ready: boolean }> =
      body.certificates.recent;
    expect(recent.map((cert) => cert.jobId).toSorted()).toEqual([
      "CAL-1",
      "CAL-2",
    ]);
    expect(recent.find((cert) => cert.jobId === "CAL-1")?.ready).toBe(true);
    expect(recent.find((cert) => cert.jobId === "CAL-2")?.ready).toBe(false);
    expect(body.requests).toMatchObject({ total: 2, open: 1, rejected: 1 });
    expect(body.serviceOrders).toMatchObject({
      total: 3,
      inProgress: 2,
      awaitingQuoteApproval: 1,
      readyForPickup: 1,
    });
    expect(
      body.serviceOrders.awaitingQuote.map(
        (order: { serviceOrderNumber: string }) => order.serviceOrderNumber,
      ),
    ).toEqual(["OS-1"]);
  });

  it("REQ-POV-3: a group's overview adds up its branches", async () => {
    const ctx = await seedPortalContext({ clientOrgId: "portal-client-solo" });
    const group = await seedPortalGroup({
      labOrgId: ctx.labOrgId,
      branches: [{ name: "Norte" }, { name: "Sul" }],
    });
    const [north, south] = group.branches;
    const today = labToday();
    await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: north?.customerId ?? 0,
      tag: "EQ-N",
      nextCalibrationDate: addCalendarDays(today, -2),
    });
    await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: south?.customerId ?? 0,
      tag: "EQ-S1",
      nextCalibrationDate: addCalendarDays(today, -2),
    });
    await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: south?.customerId ?? 0,
      tag: "EQ-S2",
      nextCalibrationDate: addCalendarDays(today, 5),
    });
    loginAsPortal({
      userId: group.groupUserId,
      organizationId: group.groupOrgId,
    });

    const body = await getOverview();

    expect(body.equipment).toMatchObject({ total: 3, overdue: 2, dueSoon: 1 });
  });
});
