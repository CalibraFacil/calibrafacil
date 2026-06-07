/**
 * Backfill the normalized mass_composition_profile catalog from the denormalized
 * compositionProfile:true entries currently copied onto every mass
 * reference_standard.certified_values, then strip those entries out of
 * certified_values (each standard keeps only its own real measured pieces).
 *
 * Profile values are copied VERBATIM (value = nominal preserved) so that
 * buildMassCompositionValue totals are unchanged. Idempotent.
 *
 * Dry-run by default. Pass --apply to write.
 *   DATABASE_URL=<dev> node packages/db/scripts/backfill-mass-composition-profile.mjs
 *   DATABASE_URL=<dev> node packages/db/scripts/backfill-mass-composition-profile.mjs --apply
 *
 * Always dumps the deduped catalog candidates to /tmp/orig-mass-profiles.json
 * for the buildMassCompositionValue parity check.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const DUMP_PATH = "/tmp/orig-mass-profiles.json";
const UNIT_TO_G = { mg: 1e-3, g: 1, kg: 1e3 };
const toGrams = (value, unit) =>
  Number(value) * (UNIT_TO_G[String(unit ?? "g").toLowerCase()] ?? 1);
const norm = (x) => (x == null ? null : Number.parseFloat(Number(x).toPrecision(10)));

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });

try {
  const rows = await sql`
    select id, organization_id, certificate_number, certified_values
    from reference_standard
    where deleted_at is null and certified_values is not null
    order by id`;

  const byKey = new Map(); // org|class|nominalG -> candidate
  const divergences = [];
  const skippedNoClass = [];
  let profileEntries = 0;

  for (const r of rows) {
    const cv = Array.isArray(r.certified_values) ? r.certified_values : [];
    for (const e of cv) {
      if (!e || e.compositionProfile !== true) continue;
      profileEntries++;
      const profileClass = e.profileClass ?? null;
      if (!profileClass) {
        skippedNoClass.push({ standard: r.id, nominal: e.nominal });
        continue;
      }
      const nominalG = toGrams(e.value, e.unit);
      const key = `${r.organization_id}|${profileClass}|${nominalG}`;
      const candidate = {
        organizationId: r.organization_id,
        profileKey: e.profileKey ?? e.nominal,
        profileClass,
        nominalG,
        nominal: e.nominal,
        value: e.value,
        uncertainty: e.uncertainty,
        unit: e.unit ?? "g",
        maxError: e.maxError ?? null,
        drift: e.drift ?? null,
        buoyancy: e.buoyancy ?? null,
        coverageFactor: e.coverageFactor ?? null,
        quantityAvailable: e.profileQuantityAvailable ?? null,
        sourceStandardId: r.id,
        sourceCertificate: r.certificate_number,
      };
      const existing = byKey.get(key);
      if (!existing) byKey.set(key, candidate);
      else {
        for (const f of ["value", "uncertainty", "maxError", "drift", "buoyancy", "coverageFactor", "quantityAvailable"]) {
          if (norm(existing[f]) !== norm(candidate[f])) {
            divergences.push({ key, field: f, kept: existing[f], other: candidate[f], otherStandard: r.id });
          }
        }
      }
    }
  }

  const catalog = [...byKey.values()];
  writeFileSync(DUMP_PATH, JSON.stringify(catalog, null, 2));

  console.log(`Scanned ${rows.length} standards; ${profileEntries} compositionProfile entries → ${catalog.length} unique (org, class, nominal_g).`);
  console.log(`Dumped catalog candidates → ${DUMP_PATH}`);
  if (skippedNoClass.length) console.log(`⚠ ${skippedNoClass.length} profile entries skipped (no profileClass).`);
  if (divergences.length) {
    console.log(`⚠ ${divergences.length} cross-standard value divergences for the same key (kept first/lowest-id source):`);
    for (const d of divergences.slice(0, 20)) console.log(`   ${d.key} ${d.field}: ${d.kept} vs ${d.other} (std ${d.otherStandard})`);
  } else {
    console.log("✓ no divergences — every (org, class, nominal_g) was identical across standards (the denormalized copies were in sync).");
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — no writes. Re-run with --apply.");
  } else {
    await sql.begin(async (tx) => {
      for (const c of catalog) {
        await tx`
          insert into mass_composition_profile
            (organization_id, profile_key, profile_class, nominal_g, nominal, value, uncertainty, unit,
             max_error, drift, buoyancy, coverage_factor, quantity_available, source_standard_id, source_certificate, status)
          values
            (${c.organizationId}, ${c.profileKey}, ${c.profileClass}, ${c.nominalG}, ${c.nominal}, ${c.value}, ${c.uncertainty}, ${c.unit},
             ${c.maxError}, ${c.drift}, ${c.buoyancy}, ${c.coverageFactor}, ${c.quantityAvailable}, ${c.sourceStandardId}, ${c.sourceCertificate}, 'ACTIVE')
          on conflict (organization_id, profile_class, nominal_g) do update set
            profile_key = excluded.profile_key, nominal = excluded.nominal, value = excluded.value,
            uncertainty = excluded.uncertainty, unit = excluded.unit, max_error = excluded.max_error,
            drift = excluded.drift, buoyancy = excluded.buoyancy, coverage_factor = excluded.coverage_factor,
            quantity_available = excluded.quantity_available, source_standard_id = excluded.source_standard_id,
            source_certificate = excluded.source_certificate, status = 'ACTIVE', updated_at = now()`;
      }
      let stripped = 0;
      for (const r of rows) {
        const cv = Array.isArray(r.certified_values) ? r.certified_values : [];
        if (!cv.some((e) => e && e.compositionProfile === true)) continue;
        const real = cv.filter((e) => !e || e.compositionProfile !== true);
        await tx`update reference_standard set certified_values = ${tx.json(real)}, updated_at = now() where id = ${r.id}`;
        stripped++;
      }
      console.log(`\nAPPLIED: upserted ${catalog.length} catalog rows; stripped compositionProfile entries from ${stripped} standards.`);
    });
  }
} finally {
  await sql.end();
}
