/**
 * The routes stamp "now" on everything they create. A laboratory that has been
 * running for a year does not look like it was opened this morning, so the
 * foundations (customers, instruments, standards, methods, qualifications) are
 * given creation dates that precede the calibration history, and the instruments
 * nobody calibrated in this quarter get a calibration history of their own.
 */
import { db } from "@calibra-facil/db";
import { asset } from "@calibra-facil/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

import { LAB_ID } from "./api";
import type { SeededAsset } from "./assets";
import type { SeedContext } from "./context";

const DAY_MS = 86_400_000;

function monthsBefore(date: Date, months: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() - months);
  return copy;
}

function monthsAfter(date: Date, months: number): Date {
  return monthsBefore(date, -months);
}

/**
 * Last/next calibration dates for instruments with no calibration of their own in
 * the history: most are in date, a few are due within a month, a few are overdue.
 */
export async function seedAssetCalibrationDates(
  ctx: SeedContext,
  assets: readonly SeededAsset[],
): Promise<void> {
  const rng = ctx.rng.fork("asset-dates");
  let updated = 0;
  for (const planned of assets) {
    // One generator per instrument: the draw never depends on the others.
    const own = rng.fork(planned.tag);
    const [row] = await db
      .select({ last: asset.lastCalibrationDate })
      .from(asset)
      .where(and(eq(asset.id, planned.id), isNull(asset.lastCalibrationDate)))
      .limit(1);
    if (!row) continue;

    const interval = planned.intervalMonths;
    const bucket = own.weighted(["valid", "soon", "overdue"], [68, 20, 12]);
    let next: Date;
    if (bucket === "valid") {
      next = new Date(
        ctx.now.getTime() + own.int(35, interval * 30 - 20) * DAY_MS,
      );
    } else if (bucket === "soon") {
      next = new Date(ctx.now.getTime() + own.int(2, 30) * DAY_MS);
    } else {
      next = new Date(ctx.now.getTime() - own.int(3, 110) * DAY_MS);
    }
    const last = monthsBefore(next, interval);
    await db
      .update(asset)
      .set({
        lastCalibrationDate: last,
        nextCalibrationDate: monthsAfter(last, interval),
      })
      .where(eq(asset.id, planned.id));
    updated += 1;
  }
  // A "next" that equals `last + interval` is what the portal writes, so it is
  // derived above rather than drawn separately.
  ctx.log(`  instruments: calibration dates for ${updated} without a history`);
}

/** Moves the creation dates of the foundations before the calibration history. */
export async function ageFoundations(ctx: SeedContext): Promise<void> {
  const now = ctx.now.toISOString();
  const org = LAB_ID;
  await db.execute(sql`
    update organization set created_at = ${now}::timestamp - interval '430 days' where id = ${org}
  `);
  await db.execute(sql`
    update customer set created_at = ${now}::timestamp - (interval '1 day' * (270 + (id * 37 % 220)))
    where lab_organization_id = ${org}
  `);
  await db.execute(sql`
    update customer_audit_log l set performed_at = c.created_at
    from customer c where c.id = l.customer_id and c.lab_organization_id = ${org}
  `);
  await db.execute(sql`
    update asset a set created_at = c.created_at + (interval '1 day' * (3 + (a.id * 13 % 60)))
    from customer c where c.id = a.customer_id and a.lab_organization_id = ${org}
  `);
  await db.execute(sql`
    update asset_audit_log l set performed_at = a.created_at
    from asset a where a.id = l.asset_id and a.lab_organization_id = ${org} and l.action = 'create'
  `);
  await db.execute(sql`
    update reference_standard set created_at = calibration_date + interval '3 days'
    where organization_id = ${org}
  `);
  await db.execute(sql`
    update reference_standard_audit_log l set performed_at = s.created_at
    from reference_standard s where s.id = l.standard_id and s.organization_id = ${org}
  `);
  await db.execute(sql`
    update service set created_at = ${now}::timestamp - interval '210 days',
      updated_at = ${now}::timestamp - interval '210 days'
    where organization_id = ${org}
  `);
  await db.execute(sql`
    update service_audit_log l set performed_at = s.created_at
    from service s where s.id = l.service_id and s.organization_id = ${org}
  `);
  // Methods: drafted, reviewed and published over the days before first use.
  await db.execute(sql`
    update calibration_method set
      published_at = ${now}::timestamp - (interval '1 day' * (150 - id * 3)),
      created_at = ${now}::timestamp - (interval '1 day' * (160 - id * 3)),
      method_compiled_at = ${now}::timestamp - (interval '1 day' * (151 - id * 3))
    where organization_id = ${org}
  `);
  await db.execute(sql`
    update method_audit_log l set performed_at = m.published_at - case l.action
      when 'create' then interval '10 days'
      when 'update' then interval '9 days'
      when 'request_approval' then interval '8 days'
      when 'technical_review' then interval '5 days'
      else interval '0 days' end
    from calibration_method m where m.id = l.method_id and m.organization_id = ${org}
  `);
  // Qualifications: requested a few weeks before the evaluation that approved them.
  await db.execute(sql`
    update personnel_competence set created_at = qualified_at - interval '25 days'
    where organization_id = ${org} and qualified_at is not null
  `);
  await db.execute(sql`
    update personnel_competence_audit_log l set performed_at = case when l.action = 'create'
      then c.created_at else c.qualified_at end
    from personnel_competence c where c.id = l.competence_id and c.organization_id = ${org}
      and c.qualified_at is not null
  `);
  await db.execute(sql`
    update training_record set created_at = start_date where organization_id = ${org}
  `);
  await db.execute(sql`
    update training_record_audit_log l set performed_at = t.start_date
    from training_record t where t.id = l.training_record_id and t.organization_id = ${org}
  `);
}
