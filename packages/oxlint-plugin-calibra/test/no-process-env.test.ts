import { describe, it, vi } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-process-env";

// Each case spawns the real oxlint binary; under a parallel `turbo test` the
// default 5s is not enough.
vi.setConfig({ testTimeout: 30_000 });

describe("calibra/no-process-env (real oxlint)", () => {
  it("REQ-CFG-5: reports process.env.X in an unlisted source file", async () => {
    await expectViolation(RULE, {
      "apps/api/src/lib/brand-new.ts":
        "export const url = process.env.DATABASE_URL;\n",
    });
  });

  it("REQ-CFG-5: reports the bracket forms and a whole-bag read", async () => {
    await expectViolation(RULE, {
      "apps/worker/src/a.ts":
        "export const read = (name: string) => process.env[name];\n",
    });
    await expectViolation(RULE, {
      "apps/worker/src/b.ts": 'export const e = process["env"];\n',
    });
    await expectViolation(RULE, {
      "apps/worker/src/c.ts": "export const all = { ...process.env };\n",
    });
  });

  it("REQ-CFG-5: reports Bun.env too", async () => {
    await expectViolation(RULE, {
      "apps/api/src/entry.ts": "export const port = Bun.env.PORT;\n",
    });
  });

  it("REQ-CFG-5: reports writes to the environment", async () => {
    await expectViolation(RULE, {
      "packages/db/src/x.ts": 'process.env.DATABASE_POOL_MAX ??= "1";\n',
    });
  });

  it("REQ-CFG-5: allows packages/config and test files", async () => {
    await expectClean(RULE, {
      "packages/config/src/process-env.ts":
        "export const raw = () => process.env;\n",
      "apps/api/src/lib/foo.spec.ts":
        'process.env.NODE_ENV = "test";\nexport {};\n',
      "apps/api/src/lib/foo.test.ts": "export const x = process.env.A;\n",
      "apps/api/src/lib/__tests__/foo.ts": "export const x = process.env.A;\n",
      "apps/api/test/integration/setup.ts": "export const x = process.env.A;\n",
    });
  });

  it("REQ-CFG-5: does not flag unrelated env members", async () => {
    await expectClean(RULE, {
      "apps/web/src/runtime.ts":
        "export const mode = import.meta.env.MODE;\nexport const e = { env: 1 }.env;\nexport const f = other.env;\ndeclare const other: { env: number };\n",
    });
  });

  it("REQ-CFG-5: grandfathers the exact legacy count and fails above it", async () => {
    // apps/api/src/routes/sso.ts is baselined at 4.
    const four =
      "export const a = [process.env.A, process.env.B, process.env.C, process.env.D];\n";
    await expectClean(RULE, { "apps/api/src/routes/sso.ts": four });
    await expectViolation(RULE, {
      "apps/api/src/routes/sso.ts": `${four}export const e = process.env.E;\n`,
    });
  });

  it("REQ-CFG-5: an unlisted file in the same directory is not grandfathered", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/new-route.ts": "export const a = process.env.A;\n",
    });
  });
});
