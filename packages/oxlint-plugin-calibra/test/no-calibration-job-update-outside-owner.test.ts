import { describe, it } from "vitest";
import { LEGACY_BASELINE } from "../src/rules/no-calibration-job-update-outside-owner.ts";
import { expectClean, expectViolation } from "./harness.ts";
import { ratchetSuite } from "./ratchet.ts";

const RULE = "no-calibration-job-update-outside-owner";

/** `count` distinct exported functions, each with one .update(calibrationJob). */
function updates(count: number): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `export const w${index} = (db: any) => db.update(calibrationJob).set({});\n`,
  ).join("");
}

const UPDATE = updates(1);

describe("calibra/no-calibration-job-update-outside-owner (real oxlint)", () => {
  it("REQ-TR-4: reports .update(calibrationJob) in a new route file", async () => {
    await expectViolation(RULE, { "apps/api/src/routes/brand-new.ts": UPDATE });
  });

  it("REQ-TR-4: reports the transaction and namespaced forms", async () => {
    await expectViolation(RULE, {
      "apps/api/src/lib/tx-form.ts":
        "export const w = async (db: any) => db.transaction(async (tx: any) => tx.update(calibrationJob).set({}));\n",
    });
    await expectViolation(RULE, {
      "apps/api/src/lib/ns-form.ts":
        "export const w = (db: any, schema: any) => db.update(schema.calibrationJob).set({});\n",
    });
    await expectViolation(RULE, {
      "apps/api/src/lib/multi-line.ts":
        "export const w = (db: any) =>\n  db\n    .update(\n      calibrationJob,\n    )\n    .set({});\n",
    });
  });

  it("REQ-TR-4: reports it outside apps/api too (worker, packages)", async () => {
    await expectViolation(RULE, { "apps/worker/src/x.ts": UPDATE });
    await expectViolation(RULE, { "packages/local-db/src/x.ts": UPDATE });
  });

  it("REQ-TR-4: allows the jobs module and the render-recovery owner", async () => {
    await expectClean(RULE, {
      "apps/api/src/domains/jobs/commands/approve-job.ts": updates(2),
      "apps/api/src/domains/jobs/commands/nested/deeper.ts": UPDATE,
      "packages/db/src/queue-render-recovery.ts": UPDATE,
    });
  });

  it("REQ-TR-4: other tables, reads and inserts are not writes to guard", async () => {
    await expectClean(RULE, {
      "apps/api/src/routes/other.ts":
        "export const a = (db: any) => db.update(asset).set({});\n" +
        "export const b = (db: any) => db.select().from(calibrationJob);\n" +
        "export const c = (db: any) => db.insert(calibrationJob).values({});\n" +
        "export const d = (db: any) => db.delete(calibrationJob);\n" +
        "export const e = (db: any) => db.update(calibrationJobStandard).set({});\n",
    });
  });

  it("REQ-TR-4: does not guard tests or test helpers", async () => {
    await expectClean(RULE, {
      "apps/api/src/routes/foo.spec.ts": UPDATE,
      "apps/api/src/routes/foo.int.spec.ts": UPDATE,
      "apps/api/src/lib/__tests__/bar.ts": UPDATE,
      "apps/api/test/integration/job-cas.ts": UPDATE,
    });
  });

  it("REQ-LC-2: the cloud jobs routes, the public API and the visits routes no longer write the job themselves (reject, cancel, assign, edit and amend moved into the jobs module)", async () => {
    for (const file of [
      "apps/api/src/domains/jobs/routes/jobs.ts",
      "apps/api/src/routes/public-api-v2.ts",
      "apps/api/src/domains/visits/routes/visits.ts",
    ]) {
      // eslint-disable-next-line no-await-in-loop -- sequential spawns keep the output readable
      await expectViolation(RULE, { [file]: UPDATE });
    }
    await expectClean(RULE, {
      "apps/api/src/domains/jobs/commands/reject-job.ts": UPDATE,
      "apps/api/src/domains/jobs/commands/cancel-job.ts": UPDATE,
      "apps/api/src/domains/jobs/commands/assign-job.ts": UPDATE,
      "apps/api/src/domains/jobs/commands/edit-job.ts": UPDATE,
      "apps/api/src/domains/jobs/commands/amend-job.ts": UPDATE,
    });
  }, 60_000);

  it("REQ-SUB-4: the desktop sync apply no longer writes the job itself (its grandfathered write moved into the submit/execute command)", async () => {
    await expectViolation(RULE, { "apps/api/src/routes/sync.ts": UPDATE });
    await expectClean(RULE, {
      "apps/api/src/domains/jobs/commands/submit-job.ts": UPDATE,
    });
  });
});

ratchetSuite({
  rule: RULE,
  baseline: LEGACY_BASELINE,
  source: (count) => updates(count),
});
