import { calibrationJob, referenceStandard } from "@calibra-facil/db/schema";
import { OPEN_JOB_STATUSES } from "@calibra-facil/schemas";
import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { OrgDb } from "@calibra-facil/db/for-org";

/**
 * What the consolidated report counts per unit, and the two cut-offs that decide it. The
 * queries live here once; each caller states its own definition of "overdue" and "expiring"
 * because the laboratory's reports and the public API v2 have always answered them
 * differently (see `ConsolidatedCutoffs`).
 */
export type ConsolidatedCutoffs = {
  /** Jobs created, approved or rejected from this instant on. */
  startDate: Date;
  /** An open job whose due date is strictly before this is overdue. */
  overdueBefore: Date;
  /**
   * A standard whose next calibration is on or before `until` (and on or after `from`, when
   * given, and only ACTIVE ones when `activeOnly`) is expiring soon.
   */
  expiring: { from: Date | null; until: Date; activeOnly: boolean };
};

export type ConsolidatedUnitCounts = {
  createdInPeriod: Map<number, number>;
  approvedInPeriod: Map<number, number>;
  rejectedInPeriod: Map<number, number>;
  /** Jobs in an open status now. */
  pendingNow: Map<number, number>;
  overdueNow: Map<number, number>;
  expiringStandardsSoon: Map<number, number>;
};

function countsByUnit(
  rows: Array<{ unitId: number | null; value: number | string }>,
) {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.unitId !== null) counts.set(row.unitId, Number(row.value));
  }
  return counts;
}

/** The sum over the units of one count, which is the laboratory-wide figure. */
export function sumCounts(counts: Map<number, number>): number {
  let total = 0;
  for (const value of counts.values()) total += value;
  return total;
}

/**
 * The per-unit counts of the consolidated reports, one grouped query each, all inside the
 * caller's transaction (`o`) and scoped to the laboratory and to `unitIds`.
 */
export async function readConsolidatedUnitCounts(
  o: OrgDb,
  params: {
    organizationId: string;
    unitIds: number[];
    cutoffs: ConsolidatedCutoffs;
  },
): Promise<ConsolidatedUnitCounts> {
  const { organizationId, unitIds, cutoffs } = params;

  const jobs = (condition: SQL<unknown> | undefined) =>
    o
      .select({
        unitId: calibrationJob.unitId,
        value: sql<number>`count(*)`,
      })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.organizationId, organizationId),
          inArray(calibrationJob.unitId, unitIds),
          condition,
        ),
      )
      .groupBy(calibrationJob.unitId);

  const standards = o
    .select({
      unitId: referenceStandard.unitId,
      value: sql<number>`count(*)`,
    })
    .from(referenceStandard)
    .where(
      and(
        eq(referenceStandard.organizationId, organizationId),
        inArray(referenceStandard.unitId, unitIds),
        cutoffs.expiring.activeOnly
          ? eq(referenceStandard.status, "ACTIVE")
          : undefined,
        lte(referenceStandard.nextCalibrationDate, cutoffs.expiring.until),
        cutoffs.expiring.from
          ? gte(referenceStandard.nextCalibrationDate, cutoffs.expiring.from)
          : undefined,
      ),
    )
    .groupBy(referenceStandard.unitId);

  const [created, approved, rejected, pending, overdue, expiring] =
    await Promise.all([
      jobs(gte(calibrationJob.createdAt, cutoffs.startDate)),
      jobs(
        and(
          eq(calibrationJob.status, "APPROVED"),
          gte(calibrationJob.approvedAt, cutoffs.startDate),
        ),
      ),
      jobs(
        and(
          eq(calibrationJob.status, "REJECTED"),
          gte(calibrationJob.rejectedAt, cutoffs.startDate),
        ),
      ),
      jobs(inArray(calibrationJob.status, OPEN_JOB_STATUSES)),
      jobs(
        and(
          inArray(calibrationJob.status, OPEN_JOB_STATUSES),
          lt(calibrationJob.dueDate, cutoffs.overdueBefore),
        ),
      ),
      standards,
    ]);

  return {
    createdInPeriod: countsByUnit(created),
    approvedInPeriod: countsByUnit(approved),
    rejectedInPeriod: countsByUnit(rejected),
    pendingNow: countsByUnit(pending),
    overdueNow: countsByUnit(overdue),
    expiringStandardsSoon: countsByUnit(expiring),
  };
}
