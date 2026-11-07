import { describe, it, vi } from "vitest";
import { expectClean, expectViolation, lintRepoPaths } from "./harness.ts";

const RULE = "no-literal-query-keys";

// Each case spawns the real oxlint binary; under a parallel `turbo test` the
// default 5s is not enough.
vi.setConfig({ testTimeout: 30_000 });

describe("calibra/no-literal-query-keys (real oxlint)", () => {
  it("reports a literal queryKey in a query", async () => {
    await expectViolation(RULE, {
      "apps/web/src/features/customers/queries.ts":
        "export const o = (id: string) => ({ queryKey: ['customer', id], queryFn: () => id });\n",
    });
  });

  it("reports a literal queryKey passed to invalidateQueries", async () => {
    await expectViolation(RULE, {
      "apps/web/src/features/jobs/detail.tsx":
        "export const f = (qc: { invalidateQueries(o: unknown): void }) => qc.invalidateQueries({ queryKey: ['assets'] });\n",
    });
  });

  it("reports a literal key given to setQueryData, getQueryData and keepPreviousDataInScope", async () => {
    await expectViolation(RULE, {
      "apps/web/src/features/a/x.ts":
        "export const f = (qc: { setQueryData(k: unknown, d: unknown): void }) => qc.setQueryData(['a'], 1);\n",
    });
    await expectViolation(RULE, {
      "apps/web/src/features/a/y.ts":
        "export const f = (qc: { getQueryData(k: unknown): unknown }) => qc.getQueryData(['a', 1]);\n",
    });
    await expectViolation(RULE, {
      "apps/web/src/features/a/z.ts":
        "declare function keepPreviousDataInScope(scope: unknown): unknown;\nexport const p = keepPreviousDataInScope(['jobs', 'org']);\n",
    });
  });

  it("reports a literal hidden behind a conditional or a const assertion", async () => {
    await expectViolation(RULE, {
      "apps/web/src/features/a/c.ts":
        "export const o = (x: boolean) => ({ queryKey: x ? ['a'] : ['b'] });\n",
    });
    await expectViolation(RULE, {
      "apps/web/src/features/a/d.ts":
        "export const o = { queryKey: ['a'] as const };\n",
    });
  });

  it("covers the portal app too", async () => {
    await expectViolation(RULE, {
      "apps/portal/src/features/requests/page.tsx":
        "export const o = { queryKey: ['portal-requests'] };\n",
    });
    await expectViolation(RULE, {
      "apps/portal/src/lib/anything.ts":
        "export const o = { queryKey: ['portal'] };\n",
    });
  });

  it("allows keys that come from a factory", async () => {
    await expectClean(RULE, {
      "apps/web/src/features/customers/queries.ts":
        "import { customerKeys } from './keys';\nexport const o = (id: string) => ({ queryKey: customerKeys.detail(id) });\nexport const i = (qc: { invalidateQueries(o: unknown): void }) => qc.invalidateQueries({ queryKey: customerKeys.all });\n",
      "apps/portal/src/features/requests/page.tsx":
        "declare const keys: { requests: readonly string[] };\nexport const o = { queryKey: keys.requests };\n",
    });
  });

  it("allows a factory module to build its arrays", async () => {
    await expectClean(RULE, {
      "apps/web/src/features/customers/keys.ts":
        "export const customerKeys = { all: ['customers'] as const, detail: (id: string) => ['customer', id] as const };\n",
    });
  });

  it("allows other `queryKey` shapes: a variable, a call, a computed property", async () => {
    await expectClean(RULE, {
      "apps/web/src/features/a/ok.ts":
        "declare const k: readonly string[];\nexport const a = { queryKey: k };\nexport const b = { ['queryKey']: ['x'] };\nexport const c = { notQueryKey: ['x'] };\n",
    });
  });

  it("does not look at tests or outside features and the portal", async () => {
    await expectClean(RULE, {
      "apps/web/src/features/customers/queries.test.ts":
        "export const o = { queryKey: ['customer', '1'] };\n",
      "apps/web/src/lib/thing.ts": "export const o = { queryKey: ['x'] };\n",
      "apps/web/src/runtime/thing.ts":
        "export const o = { queryKey: ['x'] };\n",
      "apps/api/src/thing.ts": "export const o = { queryKey: ['x'] };\n",
    });
  });

  it("holds for the live sources: the baseline is empty", async () => {
    const { exitCode, output } = await lintRepoPaths(RULE, [
      "apps/web/src/features",
      "apps/portal/src",
    ]);
    if (exitCode !== 0 || output.includes(`calibra(${RULE})`)) {
      throw new Error(`literal query keys found:\n${output}`);
    }
  });
});
