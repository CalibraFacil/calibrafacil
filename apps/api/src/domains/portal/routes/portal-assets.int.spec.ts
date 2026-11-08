/**
 * portal-assets.int.spec.ts: GET /units, /units/summary and /assets against a real Postgres and
 * the real portal middleware (only the portal session is mocked).
 *
 *   REQ-PAS-1  /units: the single customer is one unit, a group lists its branches by name
 *   REQ-PAS-2  /units/summary: per-unit counts, worst first, zero for a unit without instruments
 *   REQ-PAS-3  /assets: host and query validation, an empty page for no customer or another
 *              laboratory's host, the exact-id lookup, the in-lab filter, in-lab state and the
 *              latest approved certificate per instrument, the sort, pagination, and the group
 *              aggregate
 */
import { beforeEach, describe, expect, it } from "vitest";
import { addCalendarDays, labToday } from "@calibra-facil/shared";
import { db } from "@calibra-facil/db";
import {
  organization,
  organizationCustomDomain,
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
  seedPortalGroup,
} from "../../../../test/integration/seed";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

const LOCAL_ORIGIN = { origin: "http://localhost" };

type Ctx = Awaited<ReturnType<typeof seedPortalContext>>;

function get(path: string, headers: Record<string, string> = LOCAL_ORIGIN) {
  return portalRouter.request(path, { headers });
}

async function json(path: string) {
  const res = await get(path);
  expect(res.status).toBe(200);
  return res.json();
}

function login(ctx: Ctx) {
  loginAsPortal({ userId: ctx.portalUserId, organizationId: ctx.clientOrgId });
}

async function openServiceOrder(ctx: Ctx, assetId: number, number: string) {
  await withStatusRepair((tx) =>
    tx.insert(serviceOrder).values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetId,
      openedByUserId: ctx.portalUserId,
      serviceOrderNumber: number,
      status: "in_progress",
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

async function approvedJob(
  ctx: Ctx,
  assetId: number,
  jobId: string,
  approvedAt: string,
) {
  const [serviceRow] = await db
    .insert(service)
    .values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      name: `Calibração ${jobId}`,
      isActive: true,
    })
    .returning({ id: service.id });
  await insertJobs({
    jobId,
    organizationId: ctx.labOrgId,
    unitId: ctx.labUnitId,
    customerId: ctx.customerId,
    assetId,
    serviceId: serviceRow?.id ?? 0,
    createdBy: ctx.portalUserId,
    status: "APPROVED",
    approvedAt: new Date(approvedAt),
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

beforeEach(async () => {
  await truncateAll();
});

describe("portal GET /units and /units/summary", () => {
  it("REQ-PAS-1: refuses an unrecognized host; the single customer is one unit", async () => {
    const ctx = await seedPortalContext({ customerName: "Cliente" });
    login(ctx);

    expect((await portalRouter.request("/units")).status).toBe(403);

    const body = await json("/units");
    expect(body.mode).toBe("single");
    expect(body.units).toEqual([{ id: ctx.customerId, name: "Cliente" }]);
  });

  it("REQ-PAS-1: a group lists its branches sorted by name", async () => {
    const ctx = await seedPortalContext({ clientOrgId: "portal-client-solo" });
    const group = await seedPortalGroup({
      labOrgId: ctx.labOrgId,
      branches: [{ name: "Unidade Sul" }, { name: "Unidade Norte" }],
    });
    loginAsPortal({
      userId: group.groupUserId,
      organizationId: group.groupOrgId,
    });

    const body = await json("/units");

    expect(body.mode).toBe("group");
    expect(body.units.map((unit: { name: string }) => unit.name)).toEqual([
      "Unidade Norte",
      "Unidade Sul",
    ]);
  });

  it("REQ-PAS-2: summarizes per unit worst first, with zeros for a unit without instruments", async () => {
    const ctx = await seedPortalContext({ clientOrgId: "portal-client-solo" });
    const group = await seedPortalGroup({
      labOrgId: ctx.labOrgId,
      branches: [{ name: "Norte" }, { name: "Sul" }, { name: "Vazia" }],
    });
    const [north, south] = group.branches;
    const today = labToday();
    const seed = (customerId: number | undefined, tag: string, days: number) =>
      seedPortalAsset({
        labUnitId: ctx.labUnitId,
        customerId: customerId ?? 0,
        tag,
        nextCalibrationDate: addCalendarDays(today, days),
      });
    await seed(north?.customerId, "N1", -3);
    await seed(north?.customerId, "N2", 5);
    await seed(north?.customerId, "N3", 400);
    await seed(south?.customerId, "S1", -3);
    await seed(south?.customerId, "S2", -9);
    loginAsPortal({
      userId: group.groupUserId,
      organizationId: group.groupOrgId,
    });

    const body = await json("/units/summary");

    // Sul (2 overdue) outranks Norte (1 overdue); the empty unit is last.
    expect(body.units.map((unit: { name: string }) => unit.name)).toEqual([
      "Sul",
      "Norte",
      "Vazia",
    ]);
    expect(body.units[0]).toMatchObject({ total: 2, overdue: 2, dueSoon: 0 });
    expect(body.units[1]).toMatchObject({ total: 3, overdue: 1, dueSoon: 1 });
    expect(body.units[2]).toMatchObject({ total: 0, overdue: 0, dueSoon: 0 });
  });
});

describe("portal GET /assets", () => {
  it("REQ-PAS-3: validates the host and the query", async () => {
    const ctx = await seedPortalContext();
    login(ctx);

    expect((await portalRouter.request("/assets")).status).toBe(403);
    expect((await get("/assets?sortBy=serialNumber")).status).toBe(400);
    expect((await get("/assets?ids=1,abc")).status).toBe(400);
  });

  it("REQ-PAS-3: answers an empty page for a customer without instruments and for another laboratory's host", async () => {
    const ctx = await seedPortalContext();
    login(ctx);
    await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      tag: "EQ-1",
    });

    await withStatusRepair((tx) =>
      tx.insert(organization).values({
        id: "lab-other",
        name: "Outro laboratório",
        slug: "lab-other",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        type: "LAB",
        status: "ACTIVE",
      }),
    );
    await db.insert(organizationCustomDomain).values({
      id: "domain-other",
      organizationId: "lab-other",
      hostname: "portal.outro.example",
      verificationToken: "token",
      verifiedAt: new Date("2026-01-02T00:00:00.000Z"),
      isActive: true,
      createdBy: ctx.portalUserId,
    });

    const res = await get("/assets", {
      origin: "https://portal.outro.example",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it("REQ-PAS-3: looks instruments up by id, filters the ones in the laboratory, and sorts", async () => {
    const ctx = await seedPortalContext();
    login(ctx);
    const today = labToday();
    const first = await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      tag: "EQ-1",
      nextCalibrationDate: addCalendarDays(today, 30),
    });
    const second = await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      tag: "EQ-2",
      nextCalibrationDate: addCalendarDays(today, 90),
    });
    await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      tag: "EQ-3",
    });
    await openServiceOrder(ctx, first, "OS-1");

    const byIds = await json(`/assets?ids=${second},999999`);
    expect(byIds.data.map((row: { tag: string }) => row.tag)).toEqual(["EQ-2"]);

    const inLab = await json("/assets?dueStatus=in_lab");
    expect(inLab.data.map((row: { tag: string }) => row.tag)).toEqual(["EQ-1"]);
    expect(inLab.pagination.total).toBe(1);

    // Descending by next calibration; the unscheduled instrument is last.
    const sorted = await json(
      "/assets?sortBy=nextCalibrationDate&sortDir=desc",
    );
    expect(sorted.data.map((row: { tag: string }) => row.tag)).toEqual([
      "EQ-2",
      "EQ-1",
      "EQ-3",
    ]);

    const paged = await json("/assets?limit=2&page=2&sortBy=tag");
    expect(paged.data.map((row: { tag: string }) => row.tag)).toEqual(["EQ-3"]);
    expect(paged.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
  });

  it("REQ-PAS-3: merges the in-lab state and the latest approved certificate per instrument", async () => {
    const ctx = await seedPortalContext();
    login(ctx);
    const certified = await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      tag: "EQ-1",
    });
    await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: ctx.customerId,
      tag: "EQ-2",
    });
    await openServiceOrder(ctx, certified, "OS-1");
    await approvedJob(ctx, certified, "CAL-OLD", "2025-06-02T00:00:00.000Z");
    await approvedJob(ctx, certified, "CAL-NEW", "2025-12-02T00:00:00.000Z");

    const body = await json("/assets?sortBy=tag");

    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      tag: "EQ-1",
      inLab: true,
      lastCertificate: { jobId: "CAL-NEW" },
    });
    expect(body.data[1]).toMatchObject({
      tag: "EQ-2",
      inLab: false,
      lastCertificate: null,
    });
  });

  it("REQ-PAS-3: a group's list aggregates its branches, and unitId narrows it to one", async () => {
    const ctx = await seedPortalContext({ clientOrgId: "portal-client-solo" });
    const group = await seedPortalGroup({
      labOrgId: ctx.labOrgId,
      branches: [{ name: "Unidade Norte" }, { name: "Unidade Sul" }],
    });
    const [north, south] = group.branches;
    await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: north?.customerId ?? 0,
      tag: "EQ-1",
    });
    await seedPortalAsset({
      labUnitId: ctx.labUnitId,
      customerId: south?.customerId ?? 0,
      tag: "EQ-2",
    });
    loginAsPortal({
      userId: group.groupUserId,
      organizationId: group.groupOrgId,
    });

    const all = await json("/assets?sortBy=tag");
    expect(
      all.data.map((row: { customerName: string }) => row.customerName),
    ).toEqual(["Unidade Norte", "Unidade Sul"]);

    const narrowed = await json(`/assets?unitId=${south?.customerId}`);
    expect(narrowed.data.map((row: { tag: string }) => row.tag)).toEqual([
      "EQ-2",
    ]);
  });
});
