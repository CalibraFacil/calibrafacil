/**
 * Finish the composition-profile catalog migration: strip the stale
 * `compositionProfiles` array out of every reference_standard.metrology_data.
 *
 * The #416 backfill moved profiles into the normalized `mass_composition_profile`
 * catalog and stripped them from `certified_values`, but it never touched the
 * other per-standard copy in `metrology_data.compositionProfiles`. Those copies
 * are now read by nothing (the composition builder reads the catalog; the detail
 * page, list badge and per-standard editor that used to read them were removed),
 * and they are STALE — their buoyancy is the pre-÷1000-fix value. This removes
 * them.
 *
 * Safety: a standard's embedded profiles are only stripped if every one of them
 * is already covered by an ACTIVE catalog row for the same (org, class,
 * nominal_g). Anything uncovered is reported and that standard is skipped, so no
 * profile is ever lost. Idempotent. Dry-run by default; pass --apply to write.
 *
 *   DATABASE_URL=<conn> node packages/db/scripts/strip-metrology-data-composition-profiles.mjs
 *   DATABASE_URL=<conn> node packages/db/scripts/strip-metrology-data-composition-profiles.mjs --apply
 */
import "dotenv/config";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const UNIT_TO_G = { mg: 1e-3, g: 1, kg: 1e3 };
const toGrams = (value, unit) =>
  Number(value) * (UNIT_TO_G[String(unit ?? "g").toLowerCase()] ?? 1);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });

try {
  const catalog = await sql`
    select organization_id, profile_class, nominal_g
    from mass_composition_profile
    where deleted_at is null and status = 'ACTIVE'`;
  const catalogKeys = new Set(
    catalog.map(
      (r) => `${r.organization_id}|${r.profile_class}|${Number(r.nominal_g)}`,
    ),
  );

  const rows = await sql`
    select id, organization_id, metrology_data
    from reference_standard
    where deleted_at is null
      and metrology_data is not null
      and jsonb_array_length(
        coalesce(metrology_data->'compositionProfiles', '[]'::jsonb)
      ) > 0
    order by id`;

  const toStrip = [];
  const uncovered = [];

  for (const r of rows) {
    const profiles = Array.isArray(r.metrology_data?.compositionProfiles)
      ? r.metrology_data.compositionProfiles
      : [];
    const missing = profiles.filter((p) => {
      const key = `${r.organization_id}|${p.profileClass}|${toGrams(p.value, p.unit)}`;
      return !catalogKeys.has(key);
    });
    if (missing.length) {
      uncovered.push({ standard: r.id, missing });
    } else {
      toStrip.push(r.id);
    }
  }

  console.log(
    `Standards with embedded metrology_data.compositionProfiles: ${rows.length}`,
  );
  console.log(`  covered by catalog (safe to strip): ${toStrip.length}`);
  console.log(`  with uncovered profiles (SKIPPED):  ${uncovered.length}`);
  for (const u of uncovered) {
    const list = u.missing
      .map((m) => `${m.profileKey}(${m.profileClass}/${toGrams(m.value, m.unit)}g)`)
      .join(", ");
    console.log(`   ⚠ standard ${u.standard}: ${list}`);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — no writes. Re-run with --apply.");
  } else {
    await sql.begin(async (tx) => {
      for (const id of toStrip) {
        await tx`
          update reference_standard
          set metrology_data = jsonb_set(
                metrology_data, '{compositionProfiles}', '[]'::jsonb, true
              ),
              updated_at = now()
          where id = ${id}`;
      }
    });
    console.log(
      `\nAPPLIED: cleared compositionProfiles from ${toStrip.length} standards' metrology_data.`,
    );
  }
} finally {
  await sql.end();
}
