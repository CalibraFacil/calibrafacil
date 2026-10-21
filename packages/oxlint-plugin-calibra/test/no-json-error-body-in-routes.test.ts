import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-json-error-body-in-routes";

describe("calibra/no-json-error-body-in-routes (real oxlint)", () => {
  it("REQ-DE-5: reports a hand-built c.json({ error }) in an unlisted route file", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/brand-new.ts":
        'export const h = (c: any) => c.json({ error: "Nao encontrado" }, 404);\n',
    });
  });

  it("REQ-DE-5: reports the multi-line and quoted-key forms", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/multi.ts":
        'export const h = (c: any) =>\n  c.json(\n    {\n      "error": "x",\n      extra: 1,\n    },\n    400,\n  );\n',
    });
  });

  it("REQ-DE-5: allows a throw of a DomainError and success bodies", async () => {
    await expectClean(RULE, {
      "apps/api/src/routes/clean.ts":
        'export const h = (c: any) => c.json({ data: { error: 1 } });\nexport const g = (c: any) => c.json({ message: "ok" });\n',
    });
  });

  it("REQ-DE-5: only guards apps/api routes, not tests or other trees", async () => {
    await expectClean(RULE, {
      "apps/api/src/routes/foo.spec.ts":
        'export const h = (c: any) => c.json({ error: "x" }, 400);\n',
      "apps/api/src/middleware/auth.ts":
        'export const h = (c: any) => c.json({ error: "x" }, 401);\n',
      "apps/local-server/src/routes/x.ts":
        'export const h = (c: any) => c.json({ error: "x" }, 400);\n',
    });
  });

  it("REQ-DE-5: grandfathers the exact legacy count and fails above it", async () => {
    // apps/api/src/routes/dashboard.ts is baselined at 1.
    await expectClean(RULE, {
      "apps/api/src/routes/dashboard.ts":
        'export const h = (c: any) => c.json({ error: "x" }, 400);\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/routes/dashboard.ts":
        'export const h = (c: any) => c.json({ error: "x" }, 400);\nexport const g = (c: any) => c.json({ error: "y" }, 400);\n',
    });
  });
});
