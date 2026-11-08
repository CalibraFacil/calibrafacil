/**
 * consolidated-counts.int.spec.ts: the per-unit counts of the consolidated reports against a
 * real Postgres, under the two definitions of "overdue" and "expiring" that exist (the
 * laboratory's reports measure against the window's end, public API v2 by laboratory day).
 * The counts are laboratory-scoped, so another laboratory's rows never reach them.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { referenceStandard } from "@calibra-facil/db/schema";
import { addCalendarDays, labToday } from "@calibra-facil/shared";
import { orgDb } from "../../lib/org-db";
import { truncateAll } from "../../../test/integration/db";
import { seedBillingLab } from "../../../test/integration/billing-fixtures";
import { insertJob } from "../../../test/integration/job-fixtures";
import { seedStandard } from "../../../test/integration/seed";
import { withStatusRepair } from "../../../test/integration/state-fixtures";
import {
  readConsolidatedUnitCounts,
  sumCounts,
  type ConsolidatedCutoffs,
} from "./consolidated-counts";

beforeEach(async () => {
  await truncateAll();
});

async function standardDue(
  lab: Awaited<ReturnType<typeof seedBillingLab>>,
  serial: string,
  daysFromToday: number,
  status: "ACTIVE" | "RETIRED",
) {
  const id = await seedStandard({
    organizationId: lab.orgId,
    unitId: lab.unitId,
    createdBy: lab.userId,
    name: serial,
  });
  await withStatusRepair((tx) =>
    tx
      .update(referenceStandard)
      .set({
        serialNumber: serial,
        nextCalibrationDate: addCalendarDays(labToday(), daysFromToday),
        status,
      })
      .where(eq(referenceStandard.id, id)),
  );
}

describe("readConsolidatedUnitCounts", () => {
  it("counts standards and open jobs under each caller's cut-offs, per unit, for the laboratory only", async () => {
    const lab = await seedBillingLab("lab-counts");
    const other = await seedBillingLab("lab-counts-other");
    // Own laboratory: ACTIVE due in 5 days, ACTIVE lapsed 3 days ago, RETIRED due in 5 days.
    await standardDue(lab, "SN-SOON", 5, "ACTIVE");
    await standardDue(lab, "SN-LAPSED", -3, "ACTIVE");
    await standardDue(lab, "SN-RETIRED", 5, "RETIRED");
    // Another laboratory's expiring standard: never counted.
    await standardDue(other, "SN-OTHER", 5, "ACTIVE");
    // An open job due 3 days ago, and one due in the future.
    for (const [jobId, days] of [
      ["CAL-LATE", -3],
      ["CAL-FUTURE", 10],
    ] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- two sequential inserts.
      await insertJob({
        jobId,
        organizationId: lab.orgId,
        unitId: lab.unitId,
        customerId: lab.customerId,
        assetId: lab.assetId,
        serviceId: lab.serviceId,
        createdBy: lab.userId,
        dueDate: addCalendarDays(labToday(), days),
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
    }

    const now = new Date();
    const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const read = (cutoffs: ConsolidatedCutoffs) =>
      orgDb(lab.orgId).transaction((o) =>
        readConsolidatedUnitCounts(o, {
          organizationId: lab.orgId,
          unitIds: [lab.unitId],
          cutoffs,
        }),
      );

    // The laboratory's reports: ACTIVE standards in the 30 days after the window's end.
    const labReport = await read({
      startDate,
      overdueBefore: now,
      expiring: {
        from: now,
        until: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        activeOnly: true,
      },
    });
    expect(labReport.expiringStandardsSoon.get(lab.unitId)).toBe(1);
    expect(labReport.overdueNow.get(lab.unitId)).toBe(1);

    // Public API v2: by laboratory day, a lapsed standard of any status included.
    const v2 = await read({
      startDate,
      overdueBefore: labToday(),
      expiring: {
        from: null,
        until: addCalendarDays(labToday(), 30),
        activeOnly: false,
      },
    });
    expect(v2.expiringStandardsSoon.get(lab.unitId)).toBe(3);
    expect(v2.overdueNow.get(lab.unitId)).toBe(1);

    // Both see the two open jobs as pending, and nothing created before the window.
    expect(sumCounts(v2.pendingNow)).toBe(2);
    expect(sumCounts(v2.createdInPeriod)).toBe(2);
    expect(sumCounts(v2.approvedInPeriod)).toBe(0);
  });
});
