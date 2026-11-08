import type { OrgDb } from "@calibra-facil/db/for-org";
import { asset, calibrationJob, serviceOrder } from "@calibra-facil/db/schema";
import { IN_FLIGHT_JOB_STATUSES } from "@calibra-facil/schemas";
import { LAB_TODAY_SQL } from "@calibra-facil/shared";
import { FLEET_DUE_SOON_DAYS } from "@calibra-facil/shared/fleet-due";
import {
  and,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";

/**
 * When an instrument's next calibration falls, in one place: overdue (before
 * the laboratory's today), due soon (today through `FLEET_DUE_SOON_DAYS` ahead),
 * scheduled (later), unscheduled (no date) and "in lab" (an open job or service
 * order). The portal's overview and lists and the customer-group summary read it
 * from here, so a changed window or rule changes them together.
 *
 * `next_calibration_date` is a calendar day: it is compared with the
 * laboratory's today, derived from the database clock in SQL (the UTC clock is
 * already tomorrow from 21:00 in Sao Paulo, and binding a JS Date inside a
 * `sql` template fails under postgres.js).
 */
function dueWindow() {
  const today = sql.raw(LAB_TODAY_SQL);
  const soon = sql`(${today} + ${sql.raw(String(FLEET_DUE_SOON_DAYS))})`;
  return { today, soon };
}

/**
 * An instrument is "in lab" while it has an open calibration job or an open
 * service order, i.e. it is physically at the laboratory right now. Open job
 * statuses are every non-terminal JobStatus; open service orders are anything
 * not yet returned to the client.
 */
export function assetInLab(o: Pick<OrgDb, "select">) {
  const openJob = o
    .select({ one: sql`1` })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.assetId, asset.id),
        inArray(calibrationJob.status, IN_FLIGHT_JOB_STATUSES),
      ),
    );
  const openServiceOrder = o
    .select({ one: sql`1` })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.assetId, asset.id),
        notInArray(serviceOrder.status, ["delivered", "closed", "canceled"]),
      ),
    );

  return sql<boolean>`(${exists(openJob)} or ${exists(openServiceOrder)})`;
}

export type FleetDueStatus =
  | "overdue"
  | "due_soon"
  | "scheduled"
  | "unscheduled"
  | "in_lab";

/** The `where` condition of the assets in one due status (undefined: no filter). */
export function fleetDueStatusCondition(
  dueStatus: FleetDueStatus | undefined,
  o: Pick<OrgDb, "select">,
) {
  if (!dueStatus) return undefined;
  const { today, soon } = dueWindow();

  switch (dueStatus) {
    case "overdue":
      return lt(asset.nextCalibrationDate, today);
    case "due_soon":
      return and(
        gte(asset.nextCalibrationDate, today),
        lte(asset.nextCalibrationDate, soon),
      );
    case "scheduled":
      return gt(asset.nextCalibrationDate, soon);
    case "unscheduled":
      return isNull(asset.nextCalibrationDate);
    case "in_lab":
      return assetInLab(o);
  }
}

export type FleetDueCounts = {
  total: number;
  overdue: number;
  dueSoon: number;
  scheduled: number;
  unscheduled: number;
  inLab: number;
};

/**
 * The active instruments of the given customers counted by due status, one row
 * per customer (a customer without instruments has no row). `inLab` is counted
 * only when asked for (it adds a correlated lookup per instrument) and is 0
 * otherwise.
 */
export async function fleetDueCountsByCustomer(
  o: OrgDb,
  customerIds: readonly number[],
  options: { inLab?: boolean } = {},
): Promise<Map<number, FleetDueCounts>> {
  if (customerIds.length === 0) return new Map();
  const { today, soon } = dueWindow();
  const rows = await o
    .select({
      customerId: asset.customerId,
      total: sql<number>`cast(count(*) as int)`,
      overdue: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} < ${today}) as int)`,
      dueSoon: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} >= ${today} and ${asset.nextCalibrationDate} <= ${soon}) as int)`,
      scheduled: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} > ${soon}) as int)`,
      unscheduled: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} is null) as int)`,
      inLab: options.inLab
        ? sql<number>`cast(count(*) filter (where ${assetInLab(o)}) as int)`
        : sql<number>`0`,
    })
    .from(asset)
    .where(
      and(
        inArray(asset.customerId, [...customerIds]),
        eq(asset.status, "ACTIVE"),
        isNull(asset.deletedAt),
      ),
    )
    .groupBy(asset.customerId);

  return new Map(
    rows.map(({ customerId, ...counts }) => [customerId, counts] as const),
  );
}
