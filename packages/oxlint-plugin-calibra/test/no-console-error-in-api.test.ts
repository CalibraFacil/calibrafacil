import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-console-error-in-api";

describe("calibra/no-console-error-in-api (real oxlint)", () => {
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

  it("allows the API logger, the CLI, specs and other apps", async () => {
    await expectClean(RULE, {
      "apps/api/src/lib/logger.ts":
        "export const f = (line: string) => console.error(line);\n",
      "apps/api/src/cli/init.ts": 'console.error("usage: init");\n',
      "apps/api/src/domains/jobs/new.spec.ts": 'console.error("x");\n',
      "apps/worker/src/index.ts": 'console.error("x");\n',
    });
  });

  it("allows console.log and console.info", async () => {
    await expectClean(RULE, {
      "apps/api/src/domains/jobs/commands/ok.ts":
        'export const f = () => { console.log("a"); console.info("b"); };\n',
    });
  });
});
