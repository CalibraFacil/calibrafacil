import {
  createRatchet,
  isTestFile,
  normalizedFilename,
  type Baseline,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// calibration_job.status is a state machine
// (packages/schemas/src/job-transitions.ts). Its writes belong to one owner so
// the table, the compare-and-set and the audit row stay together:
//
//   - apps/api/src/modules/jobs/   (approve-job and the job modules)
//   - packages/db/src/queue-render-recovery.ts   (the render backstop)
//
// Everywhere else, `.update(calibrationJob)` is a new, unreviewed writer.
// Existing writers outside the owners are grandfathered as exact per-file
// counts (LEGACY_BASELINE, the same ratchet as no-json-error-body-in-routes):
// a file may never gain one, and moving a write into the owner should lower
// its file's count in the same change. An unlisted file must have zero.
// Raw SQL in the worker (`UPDATE calibration_job`) is outside what a lint rule
// on the Drizzle call can see; it reads the same transition table instead.

const OWNER_PATTERN =
  /(^|\/)(apps\/api\/src\/modules\/jobs\/|packages\/db\/src\/queue-render-recovery\.ts$)/;

// Test helpers that are not *.spec.ts (apps/api/test/integration/...).
const TEST_DIRECTORY_PATTERN = /(^|\/)apps\/[^/]+\/test\//;

const LEGACY_BASELINE: Baseline = new Map<string, number>([
  ["apps/api/src/cli/seed-demo/jobs.ts", 1],
  ["apps/api/src/cli/seed-demo/timeline.ts", 1],
]);

const MESSAGE =
  "calibration_job is written only from apps/api/src/modules/jobs/ (or packages/db/src/queue-render-recovery.ts), so the transition table, the compare-and-set and the audit row stay together. Move this write into the jobs module and take its allowed statuses from packages/schemas/src/job-transitions.ts.";

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? Object(value) : null;
}

/** `calibrationJob` or `<anything>.calibrationJob`. */
function isCalibrationJobTable(node: unknown): boolean {
  const record = toRecord(node);
  if (record?.type === "Identifier") return record.name === "calibrationJob";
  if (record?.type === "MemberExpression" && record.computed !== true) {
    return toRecord(record.property)?.name === "calibrationJob";
  }
  return false;
}

/** `<anything>.update(calibrationJob)` */
function isCalibrationJobUpdate(node: unknown): boolean {
  const call = toRecord(node);
  const callee = toRecord(call?.callee);
  if (callee?.type !== "MemberExpression" || callee.computed === true) {
    return false;
  }
  if (toRecord(callee.property)?.name !== "update") return false;
  const args = call?.arguments;
  return Array.isArray(args) && isCalibrationJobTable(args[0]);
}

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Restrict Drizzle .update(calibrationJob) to the jobs module and the render-recovery owner.",
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

    const ratchet = createRatchet(LEGACY_BASELINE, filename);
    return {
      CallExpression(node: unknown) {
        if (!isCalibrationJobUpdate(node)) return;
        if (!ratchet.exceeds()) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
};

export default rule;
