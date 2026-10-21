/**
 * calendar-day-comparisons.int.spec.ts: real-Postgres proof that a column which
 * names a calendar day (a job's due_date, a standard's next_calibration_date)
 * is compared with "today" by CALENDAR DAYS in America/Sao_Paulo, including in
 * the 21:00-24:00 window where the UTC clock is already tomorrow.
 *
 *   REQ-CAL-003  overdue / due-today / due-soon / expired judged by lab days
 *   REQ-CAL-001  a Date written at any hour of the due day is that day
 *
 * D = 2026-10-15. "23:30 on D" is 02:30Z on the 16th; "00:10 on D+1" is 03:10Z.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  referenceStandard,
  service,
} from "@calibra-facil/db/schema";
import {
  LAB_TODAY_SQL,
  addCalendarDays,
  labToday,
} from "@calibra-facil/shared";
import { loginAs, loginAsPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import {
  seedCustomer,
  seedOrg,
  seedPortalContext,
} from "../../test/integration/seed";
import { dashboardRouter } from "./dashboard";
import { jobsRouter } from "./jobs";
import { portalRouter } from "./portal";
import { standardsRouter } from "./standards";

const JSON_HEADERS = { "content-type": "application/json" };
// The portal resolves the host lab from the request Origin; a local host is the
// clean path (scope comes from the customer's auth organization).
const LOCAL_ORIGIN = { origin: "http://localhost" };

const LAST_EVENING = new Date("2026-10-15T23:30:00-03:00"); // 02:30Z on the 16th
const NEXT_MORNING = new Date("2026-10-16T00:10:00-03:00"); // 03:10Z on the 16th

const METHOD_SNAPSHOT = {
  methodId: 1,
  methodName: "Metodo",
  methodVersion: 1,
  dataFields: [],
  variableBindings: [],
  formulas: [],
  measurementModels: [],
  validations: [],
  uncertaintyParams: [],
} satisfies Record<string, unknown>;

async function seedFixture() {
  const org = await seedOrg({ orgId: "org-cal", userId: "user-cal" });
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    name: "Cliente",
  });
  const [type] = await db
    .insert(assetType)
    .values({ name: "AT", slug: "at-cal", definition: [] })
    .returning({ id: assetType.id });
  const [instrument] = await db
    .insert(asset)
    .values({
      labOrganizationId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetTypeId: type?.id ?? 0,
      name: "Instrumento",
      serialNumber: "SN-CAL",
      tag: "TAG-CAL",
    })
    .returning({ id: asset.id });
  const [svc] = await db
    .insert(service)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      name: "Calibracao",
      isActive: true,
    })
    .returning({ id: service.id });
  return {
    ...org,
    customerId,
    assetId: instrument?.id ?? 0,
    serviceId: svc?.id ?? 0,
  };
}

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

async function seedJobs(fixture: Fixture) {
  const base = {
    organizationId: fixture.orgId,
    unitId: fixture.unitId,
    customerId: fixture.customerId,
    assetId: fixture.assetId,
    serviceId: fixture.serviceId,
    createdBy: fixture.userId,
    status: "DRAFT" as const,
    methodSnapshot: METHOD_SNAPSHOT,
  };
  // Three different ways the same day D arrives, and the day before.
  await db.insert(calibrationJob).values([
    {
      ...base,
      jobId: "DUE-D-MIDNIGHT",
      certificateName: "a",
      dueDate: new Date("2026-10-15T00:00:00.000Z"),
    },
    {
      ...base,
      jobId: "DUE-D-NOON",
      certificateName: "b",
      dueDate: new Date("2026-10-15T15:00:00.000Z"),
    },
    {
      ...base,
      jobId: "DUE-D-EVENING",
      certificateName: "c",
      dueDate: new Date("2026-10-15T23:30:00-03:00"),
    },
    {
      ...base,
      jobId: "DUE-D-MINUS-1",
      certificateName: "d",
      dueDate: new Date("2026-10-14T15:00:00.000Z"),
    },
  ]);
}

async function listJobIds(query: string): Promise<string[]> {
  const res = await jobsRouter.request(`/?${query}`, { headers: JSON_HEADERS });
  expect(res.status).toBe(200);
  const body: { data: Array<{ jobId: string }> } = await res.json();
  return body.data.map((job) => job.jobId).sort();
}

describe("calendar-day comparisons (REQ-CAL-003)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("jobs due dates", () => {
    it("REQ-CAL-003: at 23:30 on the due day a job due that day is not overdue; the day before is", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(LAST_EVENING);
      const fixture = await seedFixture();
      await seedJobs(fixture);
      loginAs({ userId: fixture.userId, organizationId: fixture.orgId });

      expect(await listJobIds("overdue=true")).toEqual(["DUE-D-MINUS-1"]);
      expect(await listJobIds("dueSoon=true")).toEqual([
        "DUE-D-EVENING",
        "DUE-D-MIDNIGHT",
        "DUE-D-NOON",
      ]);

      const res = await dashboardRouter.request("/stats", {
        headers: JSON_HEADERS,
      });
      const stats = await res.json();
      expect(stats.overdueJobs).toBe(1);
      expect(stats.dueToday).toBe(4); // today's three plus the overdue one
      expect(stats.dueNextSevenDays).toBe(3);
    });

    it("REQ-CAL-003: at 00:10 the next day, every job due the day before is overdue", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NEXT_MORNING);
      const fixture = await seedFixture();
      await seedJobs(fixture);
      loginAs({ userId: fixture.userId, organizationId: fixture.orgId });

      expect(await listJobIds("overdue=true")).toEqual([
        "DUE-D-EVENING",
        "DUE-D-MIDNIGHT",
        "DUE-D-MINUS-1",
        "DUE-D-NOON",
      ]);
      expect(await listJobIds("dueSoon=true")).toEqual([]);

      const res = await dashboardRouter.request("/stats", {
        headers: JSON_HEADERS,
      });
      const stats = await res.json();
      expect(stats.overdueJobs).toBe(4);
      expect(stats.dueNextSevenDays).toBe(0);
    });

    it("REQ-CAL-003: isOverdue and daysUntilDue count laboratory days", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(LAST_EVENING);
      const fixture = await seedFixture();
      await seedJobs(fixture);
      loginAs({ userId: fixture.userId, organizationId: fixture.orgId });

      const res = await jobsRouter.request("/", { headers: JSON_HEADERS });
      const body: {
        data: Array<{
          jobId: string;
          isOverdue: boolean;
          daysUntilDue: number | null;
        }>;
      } = await res.json();
      const byId = new Map(body.data.map((job) => [job.jobId, job]));

      // 23:30 on the due day: due today, zero days left, not overdue (UTC is
      // already the 16th: reading it by instants would say overdue).
      expect(byId.get("DUE-D-MIDNIGHT")).toMatchObject({
        isOverdue: false,
        daysUntilDue: 0,
      });
      expect(byId.get("DUE-D-NOON")).toMatchObject({
        isOverdue: false,
        daysUntilDue: 0,
      });
      expect(byId.get("DUE-D-MINUS-1")).toMatchObject({
        isOverdue: true,
        daysUntilDue: -1,
      });
    });
  });

  describe("reference standards", () => {
    async function seedStandardValidThrough(
      fixture: Fixture,
      nextCalibrationDate: Date,
    ) {
      await db.insert(referenceStandard).values({
        organizationId: fixture.orgId,
        unitId: fixture.unitId,
        createdBy: fixture.userId,
        name: "Padrao",
        kind: "generic_scalar",
        serialNumber: "SN-STD",
        certificateNumber: "CERT-STD",
        calibrationDate: new Date("2026-01-10T15:00:00.000Z"),
        nextCalibrationDate,
        coverageFactor: 2,
        distribution: "normal",
        status: "ACTIVE",
        referenceValue: 1,
        uncertainty: 0.01,
      });
    }

    async function listStandards() {
      const res = await standardsRouter.request("/?expiringWithinDays=30", {
        headers: JSON_HEADERS,
      });
      expect(res.status).toBe(200);
      const body: {
        data: Array<{ isExpired: boolean; daysUntilExpiry: number }>;
      } = await res.json();
      return body.data;
    }

    it("REQ-CAL-003: a standard is still valid, and expiring, at 23:30 on its last day", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(LAST_EVENING);
      const fixture = await seedFixture();
      await seedStandardValidThrough(
        fixture,
        new Date("2026-10-15T00:00:00.000Z"),
      );
      loginAs({ userId: fixture.userId, organizationId: fixture.orgId });

      expect(await listStandards()).toEqual([
        expect.objectContaining({ isExpired: false, daysUntilExpiry: 0 }),
      ]);
      const stats = await (
        await dashboardRouter.request("/stats", { headers: JSON_HEADERS })
      ).json();
      expect(stats.expiringStandards).toBe(1);
    });

    it("REQ-CAL-003: from 00:10 the next day it is expired and no longer 'expiring'", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NEXT_MORNING);
      const fixture = await seedFixture();
      await seedStandardValidThrough(
        fixture,
        new Date("2026-10-15T15:00:00.000Z"),
      );
      loginAs({ userId: fixture.userId, organizationId: fixture.orgId });

      expect(await listStandards()).toEqual([]);
      const res = await standardsRouter.request("/", {
        headers: JSON_HEADERS,
      });
      const body: {
        data: Array<{ isExpired: boolean; daysUntilExpiry: number }>;
      } = await res.json();
      expect(body.data).toEqual([
        expect.objectContaining({ isExpired: true, daysUntilExpiry: -1 }),
      ]);
    });
  });

  describe("raw SQL 'today'", () => {
    // The database clock is UTC: between 21:00 and 24:00 in Sao Paulo
    // `now()`, `CURRENT_DATE` and `now() at time zone 'utc'` all name tomorrow.
    // LAB_TODAY_SQL is the one expression raw queries use instead; here its
    // `now()` is replaced by fixed instants to prove the window.
    async function labTodayAt(instant: string): Promise<string> {
      const expression = LAB_TODAY_SQL.replace(
        "now()",
        `TIMESTAMPTZ '${instant}'`,
      );
      expect(expression).not.toBe(LAB_TODAY_SQL);
      const rows = await db.execute<{ day: string }>(
        sql.raw(`select (${expression})::text as day`),
      );
      const [row] = Array.from(rows);
      return row?.day ?? "";
    }

    it("REQ-CAL-003: names the Sao Paulo day at 23:30, at 00:10 and across a month end", async () => {
      expect(await labTodayAt("2026-10-16T02:30:00Z")).toBe("2026-10-15");
      expect(await labTodayAt("2026-10-16T03:10:00Z")).toBe("2026-10-16");
      expect(await labTodayAt("2026-11-01T01:00:00Z")).toBe("2026-10-31");
    });

    it("REQ-CAL-003: the portal counts an instrument due today as due soon, not overdue, whatever the hour", async () => {
      // Seeded relative to the laboratory's own today, so it holds at any hour;
      // in the 21:00-24:00 window it is exactly the case the UTC clock got
      // wrong (the overview counts through LAB_TODAY_SQL, the list filters
      // through labToday()).
      const ctx = await seedPortalContext();
      const [type] = await db
        .insert(assetType)
        .values({ name: "AT", slug: "at-portal", definition: [] })
        .returning({ id: assetType.id });
      const today = labToday();
      for (const [index, offset] of [-1, 0, 30, 31].entries()) {
        await db.insert(asset).values({
          unitId: ctx.labUnitId,
          customerId: ctx.customerId,
          labOrganizationId: ctx.labOrgId,
          assetTypeId: type?.id ?? 0,
          name: `Instrumento ${offset}`,
          serialNumber: `SN-P-${index}`,
          tag: `TAG-P-${index}`,
          status: "ACTIVE",
          nextCalibrationDate: addCalendarDays(today, offset),
        });
      }
      loginAsPortal({
        userId: ctx.portalUserId,
        organizationId: ctx.clientOrgId,
      });

      const overview = await (
        await portalRouter.request("/overview", { headers: LOCAL_ORIGIN })
      ).json();
      expect(overview.equipment).toMatchObject({
        total: 4,
        overdue: 1, // yesterday
        dueSoon: 2, // today and today + 30
        scheduled: 1, // today + 31
      });

      const overdueList: { data: Array<{ name: string }> } = await (
        await portalRouter.request("/assets?dueStatus=overdue", {
          headers: LOCAL_ORIGIN,
        })
      ).json();
      expect(overdueList.data.map((row) => row.name)).toEqual([
        "Instrumento -1",
      ]);
    });
  });
});
