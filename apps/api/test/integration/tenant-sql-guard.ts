import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, expect } from "vitest";
import { setQueryObserver } from "@calibra-facil/db";
import {
  TENANT_SQL_ALLOWLIST,
  type AllowCategory,
  type AllowEntry,
} from "./tenant-sql-allowlist";
import {
  analyzeStatement,
  deriveTenantTables,
  normalizeSql,
  type StatementFinding,
} from "./tenant-sql-analyzer";
import { deriveForeignKeys, ScopedRowTracker } from "./tenant-sql-provenance";

// Test-time tenancy guard for the integration tier.
//
// Every SQL statement the app issues against a tenant-scoped table (any table
// in schema.ts with an organization_id / lab_organization_id column) must carry
// an organization predicate (SELECT/UPDATE/DELETE) or column (INSERT), or match
// an entry in tenant-sql-allowlist.ts. A violation fails the test that issued it.
//
// How statements are observed: packages/db exposes setQueryObserver (a no-op
// unless set; installed only here). onQuery sees each statement's SQL text.
// onAccess runs synchronously whenever code obtains the db (`db.x` / getDb()),
// while the caller's stack is live: we classify the caller as HARNESS (specs,
// seeds, truncation under test/) or APP, and tag the async context so the
// statements that follow are attributed to it. Harness statements are skipped.
//
// Modes (env TENANT_SQL_GUARD): "enforce" (default) fails the test, "report"
// only records (set TENANT_SQL_GUARD_REPORT=<file> for JSON lines), "off".

export type GuardMode = "off" | "report" | "enforce";

export function resolveGuardMode(
  raw = process.env.TENANT_SQL_GUARD,
): GuardMode {
  if (raw === "off" || raw === "report") return raw;
  return "enforce";
}

type Origin = "app" | "harness";
type Label = { origin: Origin; frames: string[]; sites: string[] };

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const FRAME = /\(?((?:file:\/\/)?\/[^():]+|node:[^():]+):(\d+):\d+\)?\s*$/;

/** Repo-relative `path:line` of every non-node frame, innermost first. */
function frameSites(stack: string): string[] {
  const files: string[] = [];
  for (const line of stack.split("\n").slice(1)) {
    const match = FRAME.exec(line);
    if (!match?.[1]) continue;
    const file = match[1].replace(/^file:\/\//, "");
    if (file.startsWith("node:")) continue;
    const relative = file.startsWith(REPO_ROOT)
      ? file.slice(REPO_ROOT.length)
      : file;
    files.push(`${relative}:${match[2]}`);
  }
  return files;
}

const SKIPPED_FRAMES = [
  "packages/db/src/db.ts",
  "apps/api/test/integration/tenant-sql-guard.ts",
];

const HARNESS_PATH =
  /(^|\/)test\/integration\/|\.(spec|test)\.tsx?$|(^|\/)__tests__\//;

function classify(stack: string): Label {
  const sites = frameSites(stack).filter(
    (site) =>
      !SKIPPED_FRAMES.some((skipped) => site.includes(skipped)) &&
      // drizzle re-enters the db proxy from its own builders (`this.session`).
      !site.includes("/drizzle-orm/"),
  );
  const frames = sites.map((site) => site.replace(/:\d+$/, ""));
  const caller = frames[0] ?? "";
  return {
    origin: HARNESS_PATH.test(caller) ? "harness" : "app",
    frames: frames.slice(0, 4),
    sites: sites.slice(0, 4),
  };
}

function matchesAllowlist(
  entry: AllowEntry,
  finding: StatementFinding,
  caller: string,
  sql: string,
): boolean {
  return (
    caller.endsWith(entry.file) &&
    finding.tables.every((table) => entry.tables.includes(table)) &&
    (entry.kinds === undefined || entry.kinds.includes(finding.kind)) &&
    (entry.sql === undefined || entry.sql.test(sql))
  );
}

type Violation = {
  finding: StatementFinding;
  caller: string;
  frames: string[];
  sites: string[];
  sql: string;
  test: string;
};

type Counters = {
  harness: number;
  untagged: number;
  appStatements: number;
  tenantStatements: number;
  clean: number;
  viaScopedRead: number;
  findings: number;
  allowlisted: Partial<Record<AllowCategory, number>>;
  /** Hits per allowlist entry (`file#index`) — spots stale entries. */
  allowHits: Record<string, number>;
};

function emptyCounters(): Counters {
  return {
    harness: 0,
    untagged: 0,
    appStatements: 0,
    tenantStatements: 0,
    clean: 0,
    viaScopedRead: 0,
    findings: 0,
    allowlisted: {},
    allowHits: {},
  };
}

type GuardHandle = {
  runAsApp: <T>(fn: () => Promise<T>) => Promise<T>;
  drain: () => Violation[];
};

let activeGuard: GuardHandle | null = null;

/**
 * Self-test hooks (tenant-sql-guard.int.spec.ts): run `fn` as if its statements
 * were issued by application code, and take the violations it produced so the
 * enforcing afterEach does not fail the self-test itself.
 */
export function tenantSqlGuardForTests(): GuardHandle {
  if (!activeGuard) throw new Error("tenant SQL guard is not installed");
  return activeGuard;
}

export function installTenantSqlGuard(): void {
  const mode = resolveGuardMode();
  if (mode === "off") return;

  const reportFile = process.env.TENANT_SQL_GUARD_REPORT;
  const { tenant } = deriveTenantTables();
  const tracker = new ScopedRowTracker(deriveForeignKeys(), tenant);
  const context = new AsyncLocalStorage<Label>();
  let forced: Label | null = null;
  const counters = emptyCounters();
  let violations: Violation[] = [];
  const reported = new Set<string>();

  function record(entry: Record<string, unknown>) {
    if (reportFile) appendFileSync(reportFile, `${JSON.stringify(entry)}\n`);
  }

  setQueryObserver({
    onAccess() {
      const holder: { stack?: string } = {};
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 12;
      Error.captureStackTrace(holder);
      Error.stackTraceLimit = limit;
      const label = forced ?? classify(holder.stack ?? "");
      // Drizzle re-enters the proxy from microtasks (`this.session`) with no
      // user frame on the stack: keep the tag set by the original call site.
      if (label.frames.length > 0) context.enterWith(label);
    },
    onQuery(query, params) {
      const label = context.getStore();
      if (label?.origin === "harness") {
        counters.harness += 1;
        return;
      }
      if (!label) counters.untagged += 1;
      counters.appStatements += 1;

      const analysis = analyzeStatement(query, tenant);
      if (analysis.tenantTables.length === 0) return;
      counters.tenantStatements += 1;
      if (analysis.findings.length === 0) {
        counters.clean += 1;
        tracker.record(query, params, analysis.tenantTables);
        return;
      }

      const sql = normalizeSql(query);
      const caller = label?.frames[0] ?? "(untagged)";
      for (const finding of analysis.findings) {
        // By-PK / by-FK access to a row an org-scoped read returned earlier in
        // this test (see tenant-sql-provenance.ts).
        if (
          finding.reason === "no-org-predicate" &&
          tracker.covers(query, params, finding.tables)
        ) {
          counters.viaScopedRead += 1;
          // Rows reached through a scoped parent are themselves in scope
          // (a child fetched by id, then updated by id).
          tracker.record(query, params, finding.tables);
          continue;
        }
        const allowed = TENANT_SQL_ALLOWLIST.find((entry) =>
          matchesAllowlist(entry, finding, caller, sql),
        );
        if (allowed) {
          const entryKey = `${allowed.file}#${TENANT_SQL_ALLOWLIST.indexOf(allowed)}`;
          counters.allowHits[entryKey] =
            (counters.allowHits[entryKey] ?? 0) + 1;
          counters.allowlisted[allowed.category] =
            (counters.allowlisted[allowed.category] ?? 0) + 1;
          continue;
        }
        counters.findings += 1;
        const violation: Violation = {
          finding,
          caller,
          frames: label?.frames ?? [],
          sites: label?.sites ?? [],
          sql,
          test: expect.getState().currentTestName ?? "(outside a test)",
        };
        violations.push(violation);
        const key = `${caller}|${finding.kind}|${finding.tables.join(",")}|${sql}`;
        if (!reported.has(key)) {
          reported.add(key);
          record({ type: "finding", ...violation });
        }
      }
    },
  });

  function flush() {
    if (violations.length === 0) return;
    const pending = violations;
    violations = [];
    if (mode !== "enforce") return;

    const unique = new Map<string, Violation>();
    for (const violation of pending) {
      const key = `${violation.caller}|${violation.finding.kind}|${violation.sql}`;
      if (!unique.has(key)) unique.set(key, violation);
    }
    const lines = [...unique.values()].map(
      (v) =>
        `  - ${v.finding.reason} (${v.finding.kind} on ${v.finding.tables.join(", ")}) from ${v.sites.join(" <- ") || v.caller}\n    ${v.sql.slice(0, 400)}`,
    );
    throw new Error(
      [
        `[tenant-sql-guard] ${unique.size} statement(s) touch a tenant table without an organization predicate:`,
        ...lines,
        "Add the organization_id/lab_organization_id predicate, or (only if the access is legitimately cross-tenant) add an entry with a reason to apps/api/test/integration/tenant-sql-allowlist.ts. Set TENANT_SQL_GUARD=report to debug without failing.",
      ].join("\n"),
    );
  }

  beforeEach(() => tracker.reset());
  activeGuard = {
    async runAsApp(fn) {
      forced = { origin: "app", frames: ["self-test"], sites: ["self-test:0"] };
      try {
        return await context.run(forced, fn);
      } finally {
        forced = null;
      }
    },
    drain() {
      const taken = violations;
      violations = [];
      return taken;
    },
  };

  afterEach(flush);
  afterAll(() => {
    record({
      type: "summary",
      file: expect.getState().testPath,
      ...counters,
    });
    flush();
  });
}
