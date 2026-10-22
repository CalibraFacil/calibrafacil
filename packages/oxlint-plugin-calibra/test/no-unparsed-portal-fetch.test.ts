import { describe, it, vi } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-unparsed-portal-fetch";

// Each case spawns the real oxlint binary; under a parallel `turbo test` the
// default 5s is not enough.
vi.setConfig({ testTimeout: 30_000 });

describe("calibra/no-unparsed-portal-fetch (real oxlint)", () => {
  it("REQ-TC-3: reports a raw fetch() in portal code", async () => {
    await expectViolation(RULE, {
      "apps/portal/src/features/new/queries.ts":
        'export const load = () => fetch("/api/portal/x", { credentials: "include" });\n',
    });
  });

  it("REQ-TC-3: reports the unparsed read, fetch(...).json() and response.json()", async () => {
    await expectViolation(RULE, {
      "apps/portal/src/routes/a.tsx":
        'export const a = async () => (await fetch("/api/portal/x")).json();\n',
    });
    await expectViolation(RULE, {
      "apps/portal/src/routes/b.tsx":
        "export const b = async (response: Response) => response.json();\n",
    });
    await expectViolation(RULE, {
      "apps/portal/src/routes/c.tsx":
        'export const c = () => globalThis.fetch("/api/portal/x");\n',
    });
  });

  it("REQ-TC-3: allows the helper module, tests and other apps", async () => {
    await expectClean(RULE, {
      "apps/portal/src/lib/api-fetch.ts":
        "export const f = (u: string) => fetch(u).then((r) => r.json());\n",
      "apps/portal/src/lib/api-fetch.test.ts":
        'export const t = () => fetch("/x");\n',
      "apps/portal/src/features/x/y.test.tsx":
        "export const t = async (r: Response) => r.json();\n",
      "apps/web/src/lib/thing.ts": 'export const w = () => fetch("/api/x");\n',
    });
  });

  it("REQ-TC-3: does not flag the helper's own calls or unrelated .json members", async () => {
    await expectClean(RULE, {
      "apps/portal/src/features/ok/queries.ts": [
        'import { fetchPortalJson } from "@/lib/api-fetch";',
        'export const load = () => fetchPortalJson("/api/portal/x", schema, { errorMessage: "x" });',
        "declare const schema: never;",
        "export const text = JSON.stringify({ a: 1 });",
        "export const data = { json: 1 }.json;",
        "",
      ].join("\n"),
    });
  });
});
