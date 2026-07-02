/**
 * Backfill the AS-FOUND reliability verdict (`as_found_conformity` +
 * `as_found_margins`) for calibration jobs approved BEFORE the columns existed
 * (migration 0065 added them nullable; only new approvals populate them).
 *
 * The frozen `results` jsonb of historical jobs already carries the as-found
 * margin key, so this unlocks the ILAC-G24 / NCSL RP-1 interval analysis for
 * past cycles instead of waiting years for ≥3 new ones per asset.
 *
 * The verdict logic MIRRORS apps/api/src/lib/as-found-reliability-verdict.ts
 * exactly: read ONLY `margem_conformidade_antes` (never the as-left `_apos`
 * key), flatten nested point arrays, tolerate comma decimals; zero points →
 * UNKNOWN. Keep the two in lock-step.
 *
 * Idempotent: only touches rows where `as_found_conformity IS NULL` and the
 * job has actually been approved (`approved_at IS NOT NULL`).
 *
 * Dry-run by default. Pass --apply to write.
 *   DATABASE_URL=<env> node packages/db/scripts/backfill-as-found-verdicts.mjs
 *   DATABASE_URL=<env> node packages/db/scripts/backfill-as-found-verdicts.mjs --apply
 */
import "dotenv/config";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const AS_FOUND_MARGIN_KEY = "margem_conformidade_antes";

function numberFromUnknown(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numericValues(value) {
  if (Array.isArray(value)) return value.flatMap((item) => numericValues(item));
  const parsed = numberFromUnknown(value);
  return parsed === null ? [] : [parsed];
}

function buildAsFoundReliabilityVerdict(results) {
  const margins = numericValues((results ?? {})[AS_FOUND_MARGIN_KEY]);
  const pointsTotal = margins.length;
  const pointsWithin = margins.filter((margin) => margin >= 0).length;
  const conformity =
    pointsTotal === 0
      ? "UNKNOWN"
      : pointsWithin === pointsTotal
        ? "CONFORMING"
        : "NON_CONFORMING";
  return { conformity, pointsTotal, pointsWithin, margins };
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });

try {
  const rows = await sql`
    select id, job_id, status, results
    from calibration_job
    where as_found_conformity is null
      and approved_at is not null
    order by id`;

  const tallies = { CONFORMING: 0, NON_CONFORMING: 0, UNKNOWN: 0 };
  let written = 0;

  for (const row of rows) {
    const verdict = buildAsFoundReliabilityVerdict(row.results);
    tallies[verdict.conformity]++;
    console.log(
      `job ${row.id} (${row.job_id}, ${row.status}): ${verdict.conformity}` +
        ` — ${verdict.pointsWithin}/${verdict.pointsTotal} points within`,
    );
    if (APPLY) {
      await sql`
        update calibration_job
        set as_found_conformity = ${verdict.conformity},
            as_found_margins = ${JSON.stringify(verdict.margins)}::jsonb
        where id = ${row.id}
          and as_found_conformity is null`;
      written++;
    }
  }

  console.log(
    `\n${rows.length} approved jobs missing a verdict — ` +
      `CONFORMING ${tallies.CONFORMING} / NON_CONFORMING ${tallies.NON_CONFORMING} / UNKNOWN ${tallies.UNKNOWN}. ` +
      (APPLY ? `${written} rows updated.` : "Dry-run (pass --apply to write)."),
  );
} finally {
  await sql.end();
}
