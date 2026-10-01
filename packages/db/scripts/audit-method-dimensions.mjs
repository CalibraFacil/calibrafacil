/**
 * READ-ONLY audit of every stored calibration method against the DOM-10
 * publish-time dimensional lint (`@calibra-facil/method-definition`).
 *
 * This is the operator's pre-flight before the "hard error everywhere" gate is
 * turned on for pre-existing methods (issue #663 §2 cleanup pass — lab method
 * id=6, demo id=3, humidity templates): it reconstructs the checker input from each
 * method's stored `data_fields` / `formulas` / `measurement_models` /
 * `variable_bindings` and reports, grouped by status, which methods carry a
 * dimensional incoherence.
 *
 * ZERO WRITES. This script only ever issues a single `SELECT`; there is no
 * insert/update/delete anywhere (statically asserted by the co-located test).
 *
 * Usage:
 *   DATABASE_URL=<env> pnpm --dir packages/db db:audit:method-dimensions
 *   DATABASE_URL=<env> tsx packages/db/scripts/audit-method-dimensions.mjs
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { checkMethodRecordDimensions } from "@calibra-facil/method-definition";

/**
 * Run the dimensional checker over a single method record (camelCased row).
 * Pure: takes a row, returns its verdict — never touches the database.
 */
export function auditMethodRow(row) {
  const diagnostics = checkMethodRecordDimensions({
    dataFields: row.dataFields,
    variableBindings: row.variableBindings,
    formulas: row.formulas,
    measurementModels: row.measurementModels,
  });
  return {
    id: row.id,
    name: row.name,
    organizationId: row.organizationId,
    status: row.status,
    ok: diagnostics.length === 0,
    diagnostics,
  };
}

/**
 * Build the full audit report from already-loaded method rows. Pure — has no
 * database handle, so it cannot write. The `.mjs` runner does the read-only
 * `SELECT` and hands the rows here.
 */
export function buildMethodDimensionAuditReport(rows) {
  const results = rows.map(auditMethodRow);
  const byStatus = {};
  for (const result of results) {
    (byStatus[result.status] ??= []).push(result);
  }
  return {
    total: results.length,
    okCount: results.filter((result) => result.ok).length,
    failCount: results.filter((result) => !result.ok).length,
    byStatus,
    results,
  };
}

/** Format the report as human-readable, grouped-by-status text. */
export function formatMethodDimensionAuditReport(report) {
  const lines = [];
  lines.push(
    `Dimensional audit — ${report.total} method(s): ` +
      `${report.okCount} OK, ${report.failCount} with dimensional errors.\n`,
  );
  for (const status of Object.keys(report.byStatus).sort()) {
    const group = report.byStatus[status];
    lines.push(`=== ${status} (${group.length}) ===`);
    for (const result of group) {
      if (result.ok) {
        lines.push(
          `  [OK]   #${result.id} "${result.name}" (org ${result.organizationId})`,
        );
      } else {
        lines.push(
          `  [FAIL] #${result.id} "${result.name}" (org ${result.organizationId})`,
        );
        for (const diagnostic of result.diagnostics) {
          lines.push(
            `           • fórmula '${diagnostic.formulaId}' [${diagnostic.code}]: ${diagnostic.message}`,
          );
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });
  try {
    const rows = await sql`
      select
        id,
        name,
        organization_id as "organizationId",
        status,
        data_fields as "dataFields",
        variable_bindings as "variableBindings",
        formulas,
        measurement_models as "measurementModels"
      from calibration_method
      order by status, id`;
    const report = buildMethodDimensionAuditReport(rows);
    console.log(formatMethodDimensionAuditReport(report));
    if (report.failCount > 0) {
      console.log(
        `${report.failCount} method(s) would be REJECTED by the DOM-10 gate — ` +
          `clean these up before enabling the gate for pre-existing methods.`,
      );
    }
  } finally {
    await sql.end();
  }
}

// Run only when executed directly (not when imported by the test).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
