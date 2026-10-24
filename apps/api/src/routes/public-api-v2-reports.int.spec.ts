/**
 * public-api-v2-reports.int.spec.ts - Q37.
 *
 * `GET /api/v2/reports/consolidated/*` built raw `sql` fragments that handed a
 * `Date` straight to postgres-js, which rejects it: every call answered 500.
 * The period bounds now go through the typed column comparison, as the lab-side
 * consolidated report does. Each endpoint is covered with seeded data, and with
 * the cross-laboratory negative: laboratory A's key never sees laboratory B's
 * numbers, and cannot name B's unit to read it.
 *
 *   REQ-Q37-1  executive-overview answers 200 with the counts of the key's
 *              laboratory (pending, approved, rejected, overdue, expiring
 *              standards, units, at-risk units) and the per-unit highlights.
 *   REQ-Q37-2  comparison answers 200 with one row per unit, each with its own
 *              counts, rate and health.
 *   REQ-Q37-3  Another laboratory's jobs and standards never reach the numbers,
 *              and a `unitIds` filter naming another laboratory's unit selects
 *              nothing.
 *   REQ-Q37-4  Every period (7d, 30d, 90d, month) answers 200.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  organizationUnit,
  referenceStandard,
  type JobStatus,
} from "@calibra-facil/db/schema";
import { addCalendarDays, labToday } from "@calibra-facil/shared";
import { ALL_PUBLIC_API_SCOPES } from "../lib/api-keys";
import { truncateAll } from "../../test/integration/db";
import {
  seedBillingLab,
  type BillingLab,
} from "../../test/integration/billing-fixtures";
import { insertJob, setJobStatus } from "../../test/integration/job-fixtures";
import { seedApiKey, seedStandard } from "../../test/integration/seed";
import { publicApiV2Router } from "./public-api-v2";

const ENV = { PUBLIC_API_MASTER_KEY: Buffer.alloc(32).toString("base64") };

async function get(rawKey: string, path: string) {
  return publicApiV2Router.request(
    path,
    { method: "GET", headers: { "x-api-key": rawKey } },
    ENV,
  );
}

function objectOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a JSON object");
  }
  return Object.fromEntries(Object.entries(value));
}

async function dataOf(response: Response) {
  const body = objectOf(await response.json());
  return body.data;
}

async function seedJob(
  lab: BillingLab,
  unitId: number,
  jobId: string,
  status: JobStatus,
  columns: { dueDate?: Date } = {},
) {
  const row = await insertJob({
    jobId,
    organizationId: lab.orgId,
    unitId,
    customerId: lab.customerId,
    assetId: lab.assetId,
    serviceId: lab.serviceId,
    createdBy: lab.userId,
    dueDate: columns.dueDate ?? null,
    methodSnapshot: {
      methodId: 1,
      methodName: "Test",
      methodVersion: 1,
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
    },
    certificateName: jobId,
  });
  if (status === "DRAFT") return row;
  return setJobStatus(row.id, status, {
    ...(status === "APPROVED" ? { approvedAt: new Date() } : {}),
    ...(status === "REJECTED" ? { rejectedAt: new Date() } : {}),
  });
}

async function seedSecondUnit(lab: BillingLab, name: string) {
  const [unit] = await db
    .insert(organizationUnit)
    .values({
      organizationId: lab.orgId,
      name,
      slug: name.toLowerCase(),
      status: "ACTIVE",
      createdBy: lab.userId,
    })
    .returning({ id: organizationUnit.id });
  if (!unit) throw new Error("seedSecondUnit: insert failed");
  return unit.id;
}

type World = {
  a: BillingLab;
  b: BillingLab;
  keyA: string;
  filialId: number;
  bUnitId: number;
};

/**
 * Laboratory A, unit Matriz: an approved job, a rejected job, a draft job past
 * its due date, and a standard whose calibration expires in 5 days. Unit
 * Filial: one approved job. Laboratory B: five approved jobs and an expiring
 * standard, which must never show up for A's key.
 */
async function seedWorld(): Promise<World> {
  const a = await seedBillingLab("lab-a");
  const b = await seedBillingLab("lab-b");
  const keyA = await seedApiKey({
    organizationId: a.orgId,
    createdBy: a.userId,
    scopes: [...ALL_PUBLIC_API_SCOPES],
    keyId: "key-a",
  });
  const filialId = await seedSecondUnit(a, "Filial");

  await seedJob(a, a.unitId, "CAL-A-0001", "APPROVED");
  await seedJob(a, a.unitId, "CAL-A-0002", "REJECTED");
  await seedJob(a, a.unitId, "CAL-A-0003", "DRAFT", {
    dueDate: addCalendarDays(labToday(), -3),
  });
  await seedJob(a, filialId, "CAL-A-0004", "APPROVED");

  const expiringA = await seedStandard({
    organizationId: a.orgId,
    unitId: a.unitId,
    createdBy: a.userId,
  });
  await db
    .update(referenceStandard)
    .set({ nextCalibrationDate: addCalendarDays(labToday(), 5) })
    .where(eq(referenceStandard.id, expiringA));

  for (const n of [1, 2, 3, 4, 5]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- few sequential inserts.
    await seedJob(b, b.unitId, `CAL-B-000${n}`, "APPROVED");
  }
  const expiringB = await seedStandard({
    organizationId: b.orgId,
    unitId: b.unitId,
    createdBy: b.userId,
  });
  await db
    .update(referenceStandard)
    .set({ nextCalibrationDate: addCalendarDays(labToday(), 2) })
    .where(eq(referenceStandard.id, expiringB));

  return { a, b, keyA: keyA.rawKey, filialId, bUnitId: b.unitId };
}

describe("public API v2: consolidated reports (Q37)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-Q37-1: executive-overview answers 200 with the key's laboratory numbers", async () => {
    const w = await seedWorld();

    const response = await get(
      w.keyA,
      "/reports/consolidated/executive-overview",
    );
    expect(response.status).toBe(200);

    const data = objectOf(await dataOf(response));
    expect(data.period).toBe("30d");
    expect(data.metrics).toEqual({
      pendingCalibrations: 1,
      approvedInPeriod: 2,
      rejectedInPeriod: 1,
      approvalRate: 67,
      overdueJobs: 1,
      expiringStandards: 1,
      unitsIncluded: 2,
      atRiskUnitsCount: 1,
    });

    const highlights = objectOf(data.highlights);
    expect(objectOf(objectOf(highlights.highestVolumeUnit).unit).id).toBe(
      w.a.unitId,
    );
    expect(objectOf(objectOf(highlights.bestApprovalUnit).unit).id).toBe(
      w.filialId,
    );
    expect(objectOf(objectOf(highlights.attentionUnit).unit).id).toBe(
      w.a.unitId,
    );
    const selected = data.selectedUnits;
    expect(Array.isArray(selected) ? selected.length : -1).toBe(2);
  });

  it("REQ-Q37-2: comparison answers 200 with one row per unit", async () => {
    const w = await seedWorld();

    const response = await get(w.keyA, "/reports/consolidated/comparison");
    expect(response.status).toBe(200);

    const rows = await dataOf(response);
    if (!Array.isArray(rows)) throw new Error("expected a list");
    const byUnit = new Map(
      rows.map((row) => {
        const record = objectOf(row);
        return [objectOf(record.unit).id, record];
      }),
    );
    expect([...byUnit.keys()].sort()).toEqual([w.a.unitId, w.filialId].sort());

    expect(byUnit.get(w.a.unitId)).toMatchObject({
      createdInPeriod: 3,
      approvedInPeriod: 1,
      rejectedInPeriod: 1,
      approvalRate: 33,
      overdueNow: 1,
      expiringStandardsSoon: 1,
      healthStatus: "critical",
    });
    expect(byUnit.get(w.filialId)).toMatchObject({
      createdInPeriod: 1,
      approvedInPeriod: 1,
      rejectedInPeriod: 0,
      approvalRate: 100,
      overdueNow: 0,
      expiringStandardsSoon: 0,
      healthStatus: "healthy",
    });
  });

  it("REQ-Q37-3: another laboratory's numbers never reach the key, and its unit id selects nothing", async () => {
    const w = await seedWorld();

    // B has five approved jobs and an expiring standard: none of it is A's.
    const overview = objectOf(
      await dataOf(
        await get(w.keyA, "/reports/consolidated/executive-overview"),
      ),
    );
    expect(objectOf(overview.metrics).approvedInPeriod).toBe(2);
    expect(objectOf(overview.metrics).expiringStandards).toBe(1);

    // Naming B's unit narrows A's selection to nothing.
    const foreign = await get(
      w.keyA,
      `/reports/consolidated/executive-overview?unitIds=${w.bUnitId}`,
    );
    expect(foreign.status).toBe(200);
    const foreignData = objectOf(await dataOf(foreign));
    expect(foreignData.selectedUnits).toEqual([]);
    expect(foreignData.metrics).toMatchObject({
      pendingCalibrations: 0,
      approvedInPeriod: 0,
      unitsIncluded: 0,
    });

    const foreignComparison = await get(
      w.keyA,
      `/reports/consolidated/comparison?unitIds=${w.bUnitId}`,
    );
    expect(foreignComparison.status).toBe(200);
    expect(await dataOf(foreignComparison)).toEqual([]);

    // A's own unit filter still works.
    const own = objectOf(
      await dataOf(
        await get(
          w.keyA,
          `/reports/consolidated/executive-overview?unitIds=${w.filialId}`,
        ),
      ),
    );
    expect(objectOf(own.metrics)).toMatchObject({
      approvedInPeriod: 1,
      rejectedInPeriod: 0,
      unitsIncluded: 1,
    });
  });

  it("REQ-Q37-4: every period answers 200 on both endpoints", async () => {
    const w = await seedWorld();
    for (const period of ["7d", "30d", "90d", "month"]) {
      for (const endpoint of ["executive-overview", "comparison"]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- eight sequential requests.
        const response = await get(
          w.keyA,
          `/reports/consolidated/${endpoint}?period=${period}`,
        );
        expect(response.status, `${endpoint} ${period}`).toBe(200);
      }
    }
  });
});
