import { describe, it } from "vitest";
import { expectClean, expectViolation } from "./harness.ts";

const RULE = "no-error-response-in-transaction";

describe("calibra/no-error-response-in-transaction (real oxlint)", () => {
  it("REQ-D4-2: reports an error response returned inside a transaction callback", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/brand-new.ts":
        "export const h = (c: any, db: any) =>\n  db.transaction(async (tx: any) => {\n    await tx.update(1);\n    return c.json({ error: 'x' }, 400);\n  });\n",
    });
  });

  it("REQ-D4-2: reports it in the named transaction helpers and in a catch inside the callback", async () => {
    await expectViolation(RULE, {
      "apps/api/src/lib/helper.ts":
        "export const h = (c: any) =>\n  orgTransactionWithExecutor('o', async () => {\n    try { return 1; } catch { return c.json({ error: 'x' }, 500); }\n  });\ndeclare function orgTransactionWithExecutor(o: string, f: () => unknown): unknown;\n",
    });
  });

  it("REQ-D4-2: reports it inside a withOrg callback, the one write door", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/door.ts":
        "export const h = (c: any) =>\n  withOrg('o', {}, async (ctx: any) => {\n    await ctx.o.update(1);\n    return c.json({ error: 'x' }, 409);\n  });\ndeclare function withOrg(o: string, a: object, f: (ctx: any) => unknown): unknown;\n",
    });
  });

  it("REQ-D4-2: allows a thrown error inside, error responses outside, and success responses inside", async () => {
    await expectClean(RULE, {
      "apps/api/src/domains/example/routes/clean.ts":
        "export const h = async (c: any, db: any) => {\n  try {\n    return await db.transaction(async (tx: any) => {\n      if (!tx) throw new Error('x');\n      return c.json({ ok: true });\n    });\n  } catch {\n    return c.json({ error: 'x' }, 500);\n  }\n};\n",
    });
  });
});
