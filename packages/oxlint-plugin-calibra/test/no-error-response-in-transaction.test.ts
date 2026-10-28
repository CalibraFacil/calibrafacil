import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-error-response-in-transaction";

describe("calibra/no-error-response-in-transaction (real oxlint)", () => {
  it("REQ-D4-2: reports an error response returned inside a transaction callback", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/brand-new.ts":
        "export const h = (c: any, db: any) =>\n  db.transaction(async (tx: any) => {\n    await tx.update(1);\n    return c.json({ error: 'x' }, 400);\n  });\n",
    });
  });

  it("REQ-D4-2: reports it in the named transaction helpers and in a catch inside the callback", async () => {
    await expectViolation(RULE, {
      "apps/api/src/lib/helper.ts":
        "export const h = (c: any) =>\n  orgTransactionWithExecutor('o', async () => {\n    try { return 1; } catch { return c.json({ error: 'x' }, 500); }\n  });\ndeclare function orgTransactionWithExecutor(o: string, f: () => unknown): unknown;\n",
    });
  });

  it("REQ-D4-2: allows a thrown error inside, error responses outside, and success responses inside", async () => {
    await expectClean(RULE, {
      "apps/api/src/routes/clean.ts":
        "export const h = async (c: any, db: any) => {\n  try {\n    return await db.transaction(async (tx: any) => {\n      if (!tx) throw new Error('x');\n      return c.json({ ok: true });\n    });\n  } catch {\n    return c.json({ error: 'x' }, 500);\n  }\n};\n",
    });
  });

  it("REQ-D4-2: grandfathers the exact legacy count and fails above it", async () => {
    // apps/api/src/routes/dashboard.ts is baselined at 1.
    const one =
      "export const h = (c: any, db: any) => db.transaction(async () => c.json({ error: 'x' }, 404));\n";
    await expectClean(RULE, { "apps/api/src/routes/dashboard.ts": one });
    await expectViolation(RULE, {
      "apps/api/src/routes/dashboard.ts":
        one +
        "export const g = (c: any, db: any) => db.transaction(async () => c.json({ error: 'y' }, 404));\n",
    });
  });
});
