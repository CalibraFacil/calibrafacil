// Pure helpers of the RLS shadow report (roadmap P2-3 / P2-18b): the harness
// (app-role-mode.ts) uses the request-path and call-site attribution, the report
// script (scripts/rls-shadow-report.mjs, run with Node's type stripping) uses
// everything else. No imports and only erasable TypeScript syntax, so both can load
// this file as is; rls-shadow-report-lib.spec.ts covers it.

/** Collapse whitespace so the same statement compares equal wherever it was logged. */
export function normalizeStatement(statement: string): string {
  return statement.replace(/\s+/g, " ").trim();
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
}

/** Pathname of whatever `app.request(...)` was given (string, URL or Request). */
export function requestPathOf(input: unknown): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : stringField(input, "url");
  if (!raw) return "(unknown)";
  try {
    return new URL(raw, "http://localhost").pathname;
  } catch {
    return "(unknown)";
  }
}

/** `/api/assets/42/history` -> `/api/assets`; `/health` -> `/health`. */
export function pathGroupOf(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const depth = segments[0] === "api" ? 2 : 1;
  return `/${segments.slice(0, depth).join("/")}`;
}

const FRAME = /\(?((?:file:\/\/)?\/[^():]+):(\d+):\d+\)?\s*$/;

/** Frames that are plumbing, not the code that decided to issue the statement. */
const PLUMBING =
  /\/node_modules\/|\/drizzle-orm\/|(^|\/)packages\/db\/src\/|(^|\/)apps\/api\/src\/lib\/org-db\.ts$|(^|\/)test\/integration\/|\.(spec|test)\.tsx?$|(^|\/)__tests__\//;

/**
 * The application module (repo-relative file, no line) that obtained the database
 * handle: the innermost stack frame that is not drizzle, the db package, the
 * organization-bound handle wrapper or the test harness. `null` when there is none.
 */
export function sourceModuleFromStack(
  stack: string,
  repoRoot: string,
): string | null {
  for (const line of stack.split("\n").slice(1)) {
    const match = FRAME.exec(line);
    if (!match?.[1]) continue;
    const file = match[1].replace(/^file:\/\//, "");
    const relative = file.startsWith(repoRoot)
      ? file.slice(repoRoot.length)
      : file;
    if (PLUMBING.test(relative)) continue;
    if (!relative.startsWith("apps/") && !relative.startsWith("packages/")) {
      continue;
    }
    return relative;
  }
  return null;
}

/**
 * `apps/api/src/routes/assets.ts` -> `routes`; `apps/api/src/modules/jobs/x.ts` ->
 * `modules/jobs`; anything outside apps/api/src keeps its package directory.
 */
export function layerOf(module: string): string {
  const api = "apps/api/src/";
  if (module.startsWith(api)) {
    const segments = module.slice(api.length).split("/");
    if (segments.length === 1) return "(root)";
    return segments[0] === "modules" && segments.length > 2
      ? `modules/${segments[1]}`
      : (segments[0] ?? "(root)");
  }
  if (module === UNATTRIBUTED) return UNATTRIBUTED;
  return module.split("/").slice(0, 2).join("/");
}

/** vitest names a test `a b c`, the harness records `a > b > c`. */
export function normalizeTestName(name: string): string {
  return name.replace(/ > /g, " ");
}

/** `--group` filter: a spec file matches when it starts with a prefix (`src/` optional). */
export function matchesGroup(
  file: string,
  prefixes: readonly string[],
): boolean {
  if (prefixes.length === 0) return true;
  return prefixes.some((prefix) => {
    const normalized = prefix.replace(/^\.?\//, "");
    return file.startsWith(normalized) || file.startsWith(`src/${normalized}`);
  });
}

export type UnscopedStatement = {
  /** Spec file, relative to apps/api. */
  file: string;
  statement: string;
  count: number;
  tests: string[];
  /** Application module that issued it, or `(unattributed)`. */
  module: string;
  /** `/api/assets`-style request path group, or `(unknown)`. */
  pathGroup: string;
};

export const UNATTRIBUTED = "(unattributed)";
export const UNKNOWN_PATH = "(unknown)";

/** Parse the JSON lines the harness appends; keep `no-organization` entries, de-duplicated. */
export function parseViolations(
  text: string,
  relativeToApi: (file: string) => string,
): UnscopedStatement[] {
  const statements = new Map<string, UnscopedStatement>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const file = stringField(entry, "file");
    const statement = stringField(entry, "statement");
    if (stringField(entry, "type") !== "no-organization") continue;
    if (file === undefined || statement === undefined) continue;
    const spec = relativeToApi(file);
    const sql = normalizeStatement(statement);
    const module = stringField(entry, "source") ?? UNATTRIBUTED;
    const path = stringField(entry, "path");
    const group = path ? pathGroupOf(path) : UNKNOWN_PATH;
    const key = [spec, module, group, sql].join("\u0000");
    const known = statements.get(key) ?? {
      file: spec,
      statement: sql,
      count: 0,
      tests: [],
      module,
      pathGroup: group,
    };
    known.count += 1;
    const test = normalizeTestName(
      stringField(entry, "test") ?? "(outside a test)",
    );
    if (!known.tests.includes(test)) known.tests.push(test);
    statements.set(key, known);
  }
  return [...statements.values()];
}

export type TestResult = { status: string; messages: string[] };
export type SpecResults = {
  tests: ReadonlyMap<string, TestResult>;
  suiteFailure: boolean;
};

export type BrokenTest = { name: string; reason: string };
export type SpecRow = {
  file: string;
  total: number;
  ownerFailing: number;
  appBroken: number;
  broken: BrokenTest[];
  /** The suite failed to load at all in the baseline or the strict pass. */
  suiteFailure: boolean;
  unscopedStatements: number;
  unscopedExecutions: number;
};

function brokenReason(seen: TestResult | undefined): string {
  const message = (seen?.messages ?? []).join(" ");
  if (/row-level security|42501/.test(message)) {
    return "write refused by WITH CHECK";
  }
  if (/Failed query|PostgresError|DrizzleQueryError/.test(message)) {
    return "statement error";
  }
  return seen
    ? "assertion failed (rows missing under RLS)"
    : "test did not run";
}

/** One row per spec: baseline (owner) against strict (calibra_app) plus the audit statements. */
export function buildSpecRows(
  files: readonly string[],
  baseline: ReadonlyMap<string, SpecResults>,
  strict: ReadonlyMap<string, SpecResults>,
  statements: readonly UnscopedStatement[],
): SpecRow[] {
  return files.map((file) => {
    const ownerTests =
      baseline.get(file)?.tests ?? new Map<string, TestResult>();
    const appTests = strict.get(file)?.tests ?? new Map<string, TestResult>();
    let total = 0;
    let ownerFailing = 0;
    const broken: BrokenTest[] = [];
    for (const [name, result] of ownerTests) {
      total += 1;
      if (result.status !== "passed") {
        ownerFailing += 1;
        continue;
      }
      const seen = appTests.get(name);
      if (seen?.status === "passed") continue;
      broken.push({ name, reason: brokenReason(seen) });
    }
    const unscoped = statements.filter((entry) => entry.file === file);
    return {
      file,
      total,
      ownerFailing,
      appBroken: broken.length,
      broken,
      suiteFailure:
        (baseline.get(file)?.suiteFailure ?? false) ||
        (strict.get(file)?.suiteFailure ?? false),
      unscopedStatements: unscoped.length,
      unscopedExecutions: unscoped.reduce((sum, entry) => sum + entry.count, 0),
    };
  });
}

export type GroupCounts = {
  /** Distinct SQL texts of the audit pass in the group. */
  distinctStatements: number;
  /** Executions of those statements. */
  runs: number;
  /** Tests that break under calibra_app AND ran an unscoped statement of this group. */
  testsBroken: number;
};

export type GroupSummary = Record<string, GroupCounts>;

/**
 * Counts per group (`by` picks the group of a statement). A broken test is credited
 * to every group whose unscoped statement it executed; one that fails for another
 * reason (a WITH CHECK refusal on a statement that had an organization set) shows
 * only in its spec's row.
 */
export function summarizeGroups(
  statements: readonly UnscopedStatement[],
  rows: readonly SpecRow[],
  by: (statement: UnscopedStatement) => string,
): GroupSummary {
  const brokenKeys = new Set<string>();
  for (const row of rows) {
    for (const entry of row.broken) {
      brokenKeys.add(`${row.file}\u0000${entry.name}`);
    }
  }
  const texts = new Map<string, Set<string>>();
  const brokenByGroup = new Map<string, Set<string>>();
  const result: GroupSummary = {};
  for (const statement of statements) {
    const group = by(statement);
    const counts = (result[group] ??= {
      distinctStatements: 0,
      runs: 0,
      testsBroken: 0,
    });
    counts.runs += statement.count;
    const seen = texts.get(group) ?? new Set<string>();
    seen.add(statement.statement);
    texts.set(group, seen);
    const tests = brokenByGroup.get(group) ?? new Set<string>();
    for (const test of statement.tests) {
      const key = `${statement.file}\u0000${test}`;
      if (brokenKeys.has(key)) tests.add(key);
    }
    brokenByGroup.set(group, tests);
  }
  for (const [group, counts] of Object.entries(result)) {
    counts.distinctStatements = texts.get(group)?.size ?? 0;
    counts.testsBroken = brokenByGroup.get(group)?.size ?? 0;
  }
  return result;
}

/** Groups as rows sorted by distinct statements, then runs, descending. */
export function sortedGroups(
  summary: GroupSummary,
): Array<[string, GroupCounts]> {
  return Object.entries(summary).toSorted(
    (a, b) =>
      b[1].distinctStatements - a[1].distinctStatements ||
      b[1].runs - a[1].runs ||
      a[0].localeCompare(b[0]),
  );
}

/** GitHub markdown table of a group summary (the docs baseline). */
export function groupTable(summary: GroupSummary, heading: string): string {
  const lines = [
    `| ${heading} | distinct statements | runs | tests broken |`,
    "| --- | ---: | ---: | ---: |",
  ];
  for (const [group, counts] of sortedGroups(summary)) {
    lines.push(
      `| \`${group}\` | ${counts.distinctStatements} | ${counts.runs} | ${counts.testsBroken} |`,
    );
  }
  return lines.join("\n");
}
