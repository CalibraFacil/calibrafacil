import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-console-error-on-server";

describe("calibra/no-console-error-on-server (real oxlint)", () => {
  it("reports console.error and console.warn in an API source file", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/jobs/commands/new.ts":
        'export function f(e: unknown) {\n  console.error("failed", e);\n  console.warn("careful");\n}\n',
    });
  });

  it("reports the function passed by reference", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/jobs/routes/new.ts":
        "export const f = (p: Promise<void>) => p.catch(console.error);\n",
    });
  });

  it("reports console.error and console.warn in the worker, jobs-core, notifications, auth, db and local-server", async () => {
    const files = [
      "apps/worker/src/queue-runtime.ts",
      "packages/jobs-core/src/scheduled/steps.ts",
      "packages/notifications/src/delivery.ts",
      "packages/auth/src/auth.ts",
      "packages/db/src/queue.ts",
      "apps/local-server/src/sync.ts",
    ];
    await Promise.all(
      files.map((file) =>
        expectViolation(RULE, {
          [file]:
            'export function f(e: unknown) {\n  console.error("x", e);\n}\n',
        }),
      ),
    );
  });

  it("allows the loggers, the CLI, seeds, the local-server bin, specs and other apps", async () => {
    await expectClean(RULE, {
      "apps/api/src/lib/logger.ts":
        "export const f = (line: string) => console.error(line);\n",
      "apps/api/src/cli/init.ts": 'console.error("usage: init");\n',
      "apps/api/src/domains/jobs/new.spec.ts": 'console.error("x");\n',
      "apps/local-server/src/bin.ts": 'console.error("x");\n',
      "packages/db/src/seed-asset-types.ts": 'console.error("x");\n',
      "packages/jobs-core/src/x.test.ts": 'console.error("x");\n',
      "apps/web/src/index.ts": 'console.error("x");\n',
    });
  });

  it("allows console.log and console.info", async () => {
    await expectClean(RULE, {
      "apps/api/src/domains/jobs/commands/ok.ts":
        'export const f = () => { console.log("a"); console.info("b"); };\n',
    });
  });
});
