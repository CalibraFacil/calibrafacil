import { describe, it } from "vitest";
import { LEGACY_BASELINE } from "../src/rules/no-json-error-body-in-routes.ts";
import { expectClean, expectViolation } from "./harness.ts";
import { ratchetSuite } from "./ratchet.ts";

const RULE = "no-json-error-body-in-routes";

describe("calibra/no-json-error-body-in-routes (real oxlint)", () => {
  it("REQ-DE-5: reports a hand-built c.json({ error }) in an unlisted route file", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/brand-new.ts":
        'export const h = (c: any) => c.json({ error: "Nao encontrado" }, 404);\n',
    });
  });

  it("REQ-DE-5: guards a domain's routes/ folder", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/jobs/routes/new.ts":
        'export const h = (c: any) => c.json({ error: "x" }, 404);\n',
    });
  });

  it("REQ-DE-5: reports the multi-line and quoted-key forms", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/multi.ts":
        'export const h = (c: any) =>\n  c.json(\n    {\n      "error": "x",\n      extra: 1,\n    },\n    400,\n  );\n',
    });
  });

  it("REQ-DE-5: allows a throw of a DomainError and success bodies", async () => {
    await expectClean(RULE, {
      "apps/api/src/domains/example/routes/clean.ts":
        'export const h = (c: any) => c.json({ data: { error: 1 } });\nexport const g = (c: any) => c.json({ message: "ok" });\n',
    });
  });

  it("REQ-DE-5: only guards apps/api routes, not tests or other trees", async () => {
    await expectClean(RULE, {
      "apps/api/src/domains/example/routes/foo.spec.ts":
        'export const h = (c: any) => c.json({ error: "x" }, 400);\n',
      "apps/api/src/middleware/auth.ts":
        'export const h = (c: any) => c.json({ error: "x" }, 401);\n',
      "apps/local-server/src/routes/x.ts":
        'export const h = (c: any) => c.json({ error: "x" }, 400);\n',
    });
  });
});

ratchetSuite({
  rule: RULE,
  baseline: LEGACY_BASELINE,
  source: (count) =>
    Array.from(
      { length: count },
      (_, i) =>
        `export const h${i} = (c: any) => c.json({ error: "x" }, 400);\n`,
    ).join(""),
});
