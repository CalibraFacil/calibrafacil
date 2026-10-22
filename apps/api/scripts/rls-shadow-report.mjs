// RLS shadow report (roadmap P2-3): which application statements would break if
// the API connected as `calibra_app` today.
//
//   pnpm --filter @calibra-facil/api rls:shadow-report [--files a.int.spec.ts,b.int.spec.ts] [--json out.json]
//
// It runs the portal and jobs integration specs three times against the ephemeral
// Postgres of the integration tier (apps/api/vitest.integration.config.ts):
//   1. as the owner (CALIBRA_RLS_SHADOW unset): the baseline, what passes today;
//   2. with CALIBRA_RLS_SHADOW=1 ("strict"): every HTTP request's database
//      access runs as `calibra_app` under the `tenant_isolation` policies
//      (test/integration/rls-shadow-mode.ts), the specs' seeding and assertions
//      stay on the owner;
//   3. the same with CALIBRA_RLS_SHADOW_MODE=audit: a statement with no
//      organization set is let through and recorded, so the run reaches every
//      such statement instead of stopping at the first one of each request.
// and prints, by spec file: tests that pass as the owner but fail as calibra_app
// (a read that matched nothing, a write refused by WITH CHECK), and every distinct
// statement that reached a tenant table with no organization set in its
// transaction (the raw-`db` and non-transaction paths the cutover has to move to
// `orgDb(...).transaction`). It changes nothing: it only reads test output.
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

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function defaultFiles() {
  const routes = path.join(apiDir, "src/routes");
  return readdirSync(routes)
    .filter(
      (name) =>
        name.endsWith(".int.spec.ts") &&
        (name.startsWith("portal") || name.startsWith("jobs")),
    )
    .toSorted()
    .map((name) => `src/routes/${name}`);
}

const files = argument("files")?.split(",") ?? defaultFiles();
const work = mkdtempSync(path.join(tmpdir(), "rls-shadow-"));

function runVitest(label, extraEnv, outputFile) {
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

const baseline = indexResults(
  runVitest("baseline (owner)", {}, path.join(work, "owner.json")),
);
const shadow = indexResults(
  runVitest(
    "strict (calibra_app, fail closed)",
    { CALIBRA_RLS_SHADOW: "1", TENANT_SQL_GUARD: "off" },
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
    CALIBRA_RLS_SHADOW: "1",
    CALIBRA_RLS_SHADOW_MODE: "audit",
    CALIBRA_RLS_SHADOW_REPORT: violationsFile,
    TENANT_SQL_GUARD: "off",
  },
  path.join(work, "audit.json"),
);

const statements = new Map();
for (const line of readFileSync(violationsFile, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const entry = JSON.parse(line);
  if (entry.type !== "no-organization") continue;
  const file = path.relative(apiDir, entry.file);
  const statement = entry.statement.replace(/\s+/g, " ").trim();
  const key = `${file}\u0000${statement}`;
  const known = statements.get(key) ?? { file, statement, count: 0, tests: [] };
  known.count += 1;
  if (!known.tests.includes(entry.test)) known.tests.push(entry.test);
  statements.set(key, known);
}

const rows = [];
for (const file of files) {
  const owner = baseline.get(file);
  const app = shadow.get(file);
  const ownerTests = owner?.tests ?? new Map();
  const appTests = app?.tests ?? new Map();
  let total = 0;
  let ownerFailing = 0;
  let appBroken = 0;
  const broken = [];
  for (const [name, result] of ownerTests) {
    total += 1;
    if (result.status !== "passed") {
      ownerFailing += 1;
      continue;
    }
    const seen = appTests.get(name);
    if (seen && seen.status === "passed") continue;
    appBroken += 1;
    const message = (seen?.messages ?? []).join(" ");
    const reason = /row-level security|42501/.test(message)
      ? "write refused by WITH CHECK"
      : /Failed query|PostgresError|DrizzleQueryError/.test(message)
        ? "statement error"
        : seen
          ? "assertion failed (rows missing under RLS)"
          : "test did not run";
    broken.push({ name, reason });
  }
  const unscoped = [...statements.values()].filter(
    (entry) => entry.file === file,
  );
  rows.push({
    file,
    total,
    ownerFailing,
    appBroken,
    broken,
    unscopedStatements: unscoped.length,
    unscopedExecutions: unscoped.reduce((sum, entry) => sum + entry.count, 0),
  });
}

const pad = (value, width) => String(value).padEnd(width);
console.log(
  "RLS shadow report: specs run as calibra_app (strict) vs as the owner\n",
);
console.log(
  `${pad("spec file", 52)}${pad("tests", 7)}${pad("owner-fail", 12)}${pad("break under RLS", 17)}unscoped statements (audit, distinct/runs)`,
);
let totals = { total: 0, ownerFailing: 0, appBroken: 0, distinct: 0, runs: 0 };
for (const row of rows) {
  console.log(
    `${pad(row.file, 52)}${pad(row.total, 7)}${pad(row.ownerFailing, 12)}${pad(row.appBroken, 17)}${row.unscopedStatements}/${row.unscopedExecutions}`,
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
  `${pad("TOTAL", 52)}${pad(totals.total, 7)}${pad(totals.ownerFailing, 12)}${pad(totals.appBroken, 17)}${totals.distinct}/${totals.runs}`,
);

console.log("\nTests that pass as the owner and fail as calibra_app:");
for (const row of rows) {
  for (const entry of row.broken) {
    console.log(`  ${row.file} :: ${entry.name} [${entry.reason}]`);
  }
}

console.log(
  "\nStatements that reached a tenant table with no organization set (distinct, by spec file):",
);
for (const entry of [...statements.values()].toSorted(
  (a, b) => a.file.localeCompare(b.file) || b.count - a.count,
)) {
  console.log(
    `  ${entry.file} x${entry.count}: ${entry.statement.slice(0, 220)}`,
  );
}

const jsonPath = argument("json");
if (jsonPath) {
  writeFileSync(
    jsonPath,
    JSON.stringify({ rows, statements: [...statements.values()] }, null, 2),
  );
}
