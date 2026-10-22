import {
  isTestFile,
  normalizedFilename,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// job_audit_log is the ISO/IEC 17025 §7.5 / §8.4 record trail of a calibration
// job. Its rows are written by ONE function, `appendJobEvent(tx, event)` in
// packages/db/src/job-events.ts: a discriminated union keyed by action, so a
// stored action string and its `changes` shape are typed in one place, and the
// row always carries organizationId (migration 0118) and the actor.
//
// Everywhere else, `insert(jobAuditLog)` or an `INSERT INTO job_audit_log` SQL
// string is a new, unreviewed writer. There is no legacy baseline: every
// production writer (the job commands, createCalibrationJob, the render
// backstop and the worker) already goes through appendJobEvent. Tests and the
// integration helpers (apps/<app>/test/...) may seed rows directly.

const OWNER_PATTERN = /(^|\/)packages\/db\/src\/job-events\.ts$/;

// Test helpers that are not *.spec.ts (apps/api/test/integration/...).
const TEST_DIRECTORY_PATTERN = /(^|\/)apps\/[^/]+\/test\//;

const RAW_INSERT_PATTERN =
  /insert\s+into\s+(?:"?public"?\.)?"?job_audit_log\b/i;

const MESSAGE =
  "job_audit_log rows are written only by appendJobEvent (packages/db/src/job-events.ts), so every action keeps its typed `changes` shape, its organizationId and its actor. Add or reuse a member of the JobEvent union and call appendJobEvent(tx, event) inside the transaction of the state change.";

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? Object(value) : null;
}

/** `jobAuditLog` or `<anything>.jobAuditLog`. */
function isJobAuditLogTable(node: unknown): boolean {
  const record = toRecord(node);
  if (record?.type === "Identifier") return record.name === "jobAuditLog";
  if (record?.type === "MemberExpression" && record.computed !== true) {
    return toRecord(record.property)?.name === "jobAuditLog";
  }
  return false;
}

/** `<anything>.insert(jobAuditLog)` */
function isJobAuditLogInsert(node: unknown): boolean {
  const call = toRecord(node);
  const callee = toRecord(call?.callee);
  if (callee?.type !== "MemberExpression" || callee.computed === true) {
    return false;
  }
  if (toRecord(callee.property)?.name !== "insert") return false;
  const args = call?.arguments;
  return Array.isArray(args) && isJobAuditLogTable(args[0]);
}

/** The static text of a template literal (its quasis; interpolations are gaps). */
function templateText(node: unknown): string {
  const quasis = toRecord(node)?.quasis;
  if (!Array.isArray(quasis)) return "";
  return quasis
    .map((quasi) => {
      const value = toRecord(toRecord(quasi)?.value);
      const text = value?.cooked ?? value?.raw;
      return typeof text === "string" ? text : "";
    })
    .join(" ");
}

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Restrict inserts into job_audit_log to appendJobEvent (packages/db/src/job-events.ts).",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (
      OWNER_PATTERN.test(filename) ||
      isTestFile(filename) ||
      TEST_DIRECTORY_PATTERN.test(filename)
    ) {
      return {};
    }

    return {
      CallExpression(node: unknown) {
        if (!isJobAuditLogInsert(node)) return;
        context.report({ node, message: MESSAGE });
      },
      // Raw SQL: the worker talks to Postgres through a pg client, where there
      // is no Drizzle call for the check above to see.
      TemplateLiteral(node: unknown) {
        if (!RAW_INSERT_PATTERN.test(templateText(node))) return;
        context.report({ node, message: MESSAGE });
      },
      Literal(node: unknown) {
        const value = toRecord(node)?.value;
        if (typeof value !== "string" || !RAW_INSERT_PATTERN.test(value)) {
          return;
        }
        context.report({ node, message: MESSAGE });
      },
    };
  },
};

export default rule;
