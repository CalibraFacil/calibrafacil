// RLS shadow report (roadmap P2-3, P2-18b, kept after the P2-18k cutover as a diagnosis
// tool): which application statements reach a tenant table without an organization.
//
//   pnpm --filter @calibra-facil/api rls:shadow-report \
//     [--files src/routes/a.int.spec.ts,src/routes/b.int.spec.ts] \
//     [--group src/routes/jobs,modules/sync] [--json out.json] [--markdown]
//
// It runs every API integration spec (`apps/api/**/*.int.spec.ts`; the include of
// apps/api/vitest.integration.config.ts is `src/**`, nothing lives elsewhere) three
// times against the ephemeral Postgres of the integration tier:
//   1. with the requests as the owner (CALIBRA_API_DB_ROLE=owner): the baseline,
//      what passes without row-level security;
//   2. with CALIBRA_RLS_REPORT=1 ("strict"): every HTTP request's database
//      access runs as `calibra_app` under the `tenant_isolation` policies (the
//      default of the integration tier since P2-18k, test/integration/
//      app-role-mode.ts, plus the probing policies of report mode), the specs'
//      seeding and assertions stay on the owner;
//   3. the same with CALIBRA_RLS_REPORT_MODE=audit: a statement with no
//      organization set is let through and recorded, so the run reaches every
//      such statement instead of stopping at the first one of each request.
// and prints, by spec file: tests that pass as the owner but fail as calibra_app
// (a read that matched nothing, a write refused by WITH CHECK), and every distinct
// statement that reached a tenant table with no organization set in its
// transaction (the raw-`db` and non-transaction paths the cutover has to move to
// `orgDb(...).transaction`). The statements are also grouped by the application
// module that issued them (the innermost source file that obtained the database
// handle, outside drizzle, packages/db, lib/org-db.ts and the harness) and by layer
// (`routes`, `lib`, `middleware`, `modules/jobs`). The request path is recorded too
// (`--json-full`), but specs mount a router at `/`, so it is no usable group. It
// changes nothing: it only reads test output.
//
// Narrowing: `--files` lists exact spec paths (relative to apps/api); `--group` keeps
// the specs whose path starts with one of the comma-separated prefixes (`src/` is
// optional: `routes/jobs`, `modules`, `lib/org-db`). Both given: `--files` wins.
//
// `--json <file>` writes the summary a later slice diffs against
// docs/architecture/rls-shadow-baseline.json: counts per spec / module / layer
// (distinct statements, runs, tests broken), no statement text. `--json-full <file>`
// adds the per-spec rows and the full statement list; `--from-full <file>` re-slices
// such a file (with --files/--group) without running vitest. `--markdown` also prints
// the module and layer tables as markdown. The default set leaves out the self-tests
// of the tenant SQL guard (they need the guard the shadow passes switch off).
//
// Runtime: three vitest runs with --maxWorkers=2 over ~140 specs, about 35 minutes
// per pass on a 16-core machine (the figure of the last full run is in
// docs/architecture/org-bound-db.md, "Final report"); a spec group takes the time
// of its slowest specs plus about 40 seconds of container and schema start-up per
// pass. Use --group for a slice.
//
// apps/worker integration tier: not included. Its handlers are invoked directly
// rather than through `app.request(...)`, so the request-scoped routing of the
// harness does not apply; the tier instead builds every handler's env as
// `calibra_app` (apps/worker/test/integration/env.ts), so a statement without an
// organization fails its spec in the normal run.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSpecRows,
  groupTable,
  layerOf,
  matchesGroup,
  parseViolations,
  sortedGroups,
  summarizeGroups,
} from "../test/integration/rls-shadow-report-lib.ts";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function listSpecs(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listSpecs(full));
    else if (entry.name.endsWith(".int.spec.ts")) {
      found.push(path.relative(apiDir, full));
    }
  }
  return found;
}

// Self-tests of the harness: the tenant SQL guard's (they need the guard on, which
// the shadow passes switch off: it would fail every request first) and the
// application-role routing's (it issues a deliberately unscoped statement to prove
// that one sees nothing). They only produce noise here. `--files` can still name
// them.
const HARNESS_SELF_TESTS = [
  "src/lib/__tests__/tenant-sql-guard.int.spec.ts",
  "src/lib/app-role-harness.int.spec.ts",
];

function selectedFiles() {
  const explicit = argument("files");
  if (explicit) return explicit.split(",").filter(Boolean);
  const prefixes = (argument("group") ?? "").split(",").filter(Boolean);
  return listSpecs(path.join(apiDir, "src"))
    .filter(
      (file) =>
        matchesGroup(file, prefixes) && !HARNESS_SELF_TESTS.includes(file),
    )
    .toSorted();
}

const files = selectedFiles();
if (files.length === 0) {
  throw new Error("[rls-shadow] no integration spec matches --files/--group");
}
const work = mkdtempSync(path.join(tmpdir(), "rls-shadow-"));
const startedAt = Date.now();
const reuseFull = argument("from-full");

function runVitest(label, extraEnv, outputFile) {
  const passStart = Date.now();
  console.error(`[rls-shadow] ${label}: ${files.length} spec files`);
  spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "--reporter=json",
      `--outputFile=${outputFile}`,
      "--maxWorkers=2",
      "--testTimeout=240000",
      ...files,
    ],
    {
      cwd: apiDir,
      // oxlint-disable-next-line calibra/no-process-env -- a dev script that hands its own environment to the vitest it spawns
      env: { ...process.env, TZ: "UTC", ...extraEnv },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  if (!existsSync(outputFile)) {
    throw new Error(`[rls-shadow] ${label}: vitest wrote no result`);
  }
  console.error(
    `[rls-shadow] ${label}: done in ${Math.round((Date.now() - passStart) / 1000)}s`,
  );
  return JSON.parse(readFileSync(outputFile, "utf8"));
}

/** `file -> test -> { status, messages }` of a vitest JSON report. */
function indexResults(report) {
  const byFile = new Map();
  for (const result of report.testResults ?? []) {
    const file = path.relative(apiDir, result.name);
    const tests = new Map();
    for (const test of result.assertionResults ?? []) {
      tests.set(test.fullName, {
        status: test.status,
        messages: test.failureMessages ?? [],
      });
    }
    byFile.set(file, {
      tests,
      suiteFailure: result.status === "failed" && tests.size === 0,
    });
  }
  return byFile;
}

function runPasses() {
  const baseline = indexResults(
    runVitest(
      "baseline (owner)",
      { CALIBRA_API_DB_ROLE: "owner" },
      path.join(work, "owner.json"),
    ),
  );
  const shadow = indexResults(
    runVitest(
      "strict (calibra_app, fail closed)",
      { CALIBRA_RLS_REPORT: "1", TENANT_SQL_GUARD: "off" },
      path.join(work, "strict.json"),
    ),
  );
  // The strict run stops every request at its first unscoped statement; the audit
  // run lets such statements through (still warned about), so it sees all of them.
  const violationsFile = path.join(work, "violations.jsonl");
  writeFileSync(violationsFile, "");
  runVitest(
    "audit (calibra_app, unscoped statements allowed and recorded)",
    {
      CALIBRA_RLS_REPORT: "1",
      CALIBRA_RLS_REPORT_MODE: "audit",
      CALIBRA_RLS_REPORT_FILE: violationsFile,
      TENANT_SQL_GUARD: "off",
    },
    path.join(work, "audit.json"),
  );
  const parsed = parseViolations(readFileSync(violationsFile, "utf8"), (file) =>
    path.relative(apiDir, file),
  );
  return { rows: buildSpecRows(files, baseline, shadow, parsed), parsed };
}

/** Re-slice a previous `--json-full` (to the selected specs) without running vitest. */
function reuseResults(file) {
  const previous = JSON.parse(readFileSync(file, "utf8"));
  const wanted = new Set(files);
  return {
    rows: previous.rows.filter((row) => wanted.has(row.file)),
    parsed: previous.statements.filter((entry) => wanted.has(entry.file)),
  };
}

const { rows, parsed: statements } = reuseFull
  ? reuseResults(reuseFull)
  : runPasses();
const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
const byModule = summarizeGroups(statements, rows, (entry) => entry.module);
const byLayer = summarizeGroups(statements, rows, (entry) =>
  layerOf(entry.module),
);
const bySpec = summarizeGroups(statements, rows, (entry) => entry.file);

const pad = (value, width) => String(value).padEnd(width);
console.log(
  "RLS shadow report: specs run as calibra_app (strict) vs as the owner\n",
);
console.log(
  `${pad("spec file", 58)}${pad("tests", 7)}${pad("owner-fail", 12)}${pad("break under RLS", 17)}unscoped statements (audit, distinct/runs)`,
);
let totals = { total: 0, ownerFailing: 0, appBroken: 0, distinct: 0, runs: 0 };
for (const row of rows) {
  console.log(
    `${pad(row.file, 58)}${pad(row.total, 7)}${pad(row.ownerFailing, 12)}${pad(row.appBroken, 17)}${row.unscopedStatements}/${row.unscopedExecutions}${row.suiteFailure ? "  [suite failed to load]" : ""}`,
  );
  totals = {
    total: totals.total + row.total,
    ownerFailing: totals.ownerFailing + row.ownerFailing,
    appBroken: totals.appBroken + row.appBroken,
    distinct: totals.distinct + row.unscopedStatements,
    runs: totals.runs + row.unscopedExecutions,
  };
}
console.log(
  `${pad("TOTAL", 58)}${pad(totals.total, 7)}${pad(totals.ownerFailing, 12)}${pad(totals.appBroken, 17)}${totals.distinct}/${totals.runs}`,
);

console.log(
  "\nUnscoped statements by application module (distinct/runs/tests broken):",
);
for (const [group, counts] of sortedGroups(byModule)) {
  console.log(
    `  ${pad(group, 70)}${counts.distinctStatements}/${counts.runs}/${counts.testsBroken}`,
  );
}
console.log("\nUnscoped statements by layer (distinct/runs/tests broken):");
for (const [group, counts] of sortedGroups(byLayer)) {
  console.log(
    `  ${pad(group, 40)}${counts.distinctStatements}/${counts.runs}/${counts.testsBroken}`,
  );
}

console.log("\nTests that pass as the owner and fail as calibra_app:");
for (const row of rows) {
  for (const entry of row.broken) {
    console.log(`  ${row.file} :: ${entry.name} [${entry.reason}]`);
  }
}

console.log(
  "\nStatements that reached a tenant table with no organization set (by spec file, module):",
);
for (const entry of statements.toSorted(
  (a, b) => a.file.localeCompare(b.file) || b.count - a.count,
)) {
  console.log(
    `  ${entry.file} [${entry.module}] x${entry.count}: ${entry.statement.slice(0, 220)}`,
  );
}

console.error(`[rls-shadow] total ${elapsedSeconds}s`);

function summary() {
  return {
    generatedBy: "pnpm --filter @calibra-facil/api rls:shadow-report --json",
    specFiles: files.length,
    totals: {
      tests: totals.total,
      ownerFailing: totals.ownerFailing,
      testsBroken: totals.appBroken,
      distinctStatements: totals.distinct,
      runs: totals.runs,
    },
    bySpec: Object.fromEntries(sortedGroups(bySpec)),
    byModule: Object.fromEntries(sortedGroups(byModule)),
    byLayer: Object.fromEntries(sortedGroups(byLayer)),
    brokenTests: rows.flatMap((row) =>
      row.broken.map((entry) => ({ file: row.file, ...entry })),
    ),
  };
}

const jsonPath = argument("json");
if (jsonPath) {
  writeFileSync(jsonPath, `${JSON.stringify(summary(), null, 2)}\n`);
}
const fullPath = argument("json-full");
if (fullPath) {
  writeFileSync(
    fullPath,
    `${JSON.stringify({ ...summary(), rows, statements }, null, 2)}\n`,
  );
}
// Markdown tables for docs/architecture/org-bound-db.md.
if (process.argv.includes("--markdown")) {
  console.log(`\n${groupTable(byModule, "application module")}`);
  console.log(`\n${groupTable(byLayer, "layer")}`);
}
