import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

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
      "apps/api/src/modules/jobs/approve-job.ts": updates(2),
      "apps/api/src/modules/jobs/nested/deeper.ts": UPDATE,
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

  it("REQ-TR-4: grandfathers the exact legacy count and fails above it", async () => {
    // apps/api/src/routes/visits.ts is baselined at 1.
    await expectClean(RULE, { "apps/api/src/routes/visits.ts": UPDATE });
    await expectViolation(RULE, {
      "apps/api/src/routes/visits.ts": updates(2),
    });
  });

  it("REQ-TR-4: baselines the live legacy files at their exact counts", async () => {
    const legacy: Record<string, number> = {
      "apps/api/src/cli/seed-demo/jobs.ts": 1,
      "apps/api/src/cli/seed-demo/timeline.ts": 1,
      "apps/api/src/routes/jobs.ts": 5,
      "apps/api/src/routes/public-api-v2.ts": 3,
      "apps/api/src/routes/visits.ts": 1,
    };
    for (const [file, count] of Object.entries(legacy)) {
      // eslint-disable-next-line no-await-in-loop -- sequential spawns keep the output readable
      await expectClean(RULE, { [file]: updates(count) });
      // eslint-disable-next-line no-await-in-loop -- see above
      await expectViolation(RULE, { [file]: updates(count + 1) });
    }
    // Ten real oxlint spawns: well above the default 5s on a busy machine.
  }, 60_000);

  it("REQ-SUB-4: the desktop sync apply no longer writes the job itself (its grandfathered write moved into the submit/execute command)", async () => {
    await expectViolation(RULE, { "apps/api/src/routes/sync.ts": UPDATE });
    await expectClean(RULE, {
      "apps/api/src/modules/jobs/submit-job.ts": UPDATE,
    });
  });
});
