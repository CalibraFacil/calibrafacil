import { describe, expect, it } from "vitest";
import { RAW_DB_BASELINE } from "../src/lib/raw-db-baseline.ts";
import {
  expectClean,
  expectViolation,
  lintFixtures,
  lintRepoPaths,
} from "./harness.ts";

const RULE = "no-raw-db-in-routes";

const IMPORT = 'import { db } from "@calibra-facil/db";\n';

/** `count` references to the imported `db`, one per exported function. */
function uses(count: number): string {
  return (
    IMPORT +
    Array.from(
      { length: count },
      (_, index) => `export const q${index} = () => db.select();\n`,
    ).join("")
  );
}

describe("calibra/no-raw-db-in-routes (real oxlint)", () => {
  it("REQ-ORGDB-2: reports a call on the global db in a new route file", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/brand-new.ts": uses(1),
    });
  });

  it("REQ-ORGDB-2: reports every way of using the binding, not just member calls", async () => {
    // passed along, aliased, returned, destructured from, shorthand property
    for (const body of [
      "export const a = (run: (x: unknown) => void) => run(db);\n",
      "export const a = () => db;\n",
      "export const a = () => ({ db });\n",
      "export const a = () => { const { select } = db; return select; };\n",
      "export const a = () => db.transaction(async (tx) => tx);\n",
    ]) {
      // eslint-disable-next-line no-await-in-loop -- sequential spawns keep the output readable
      await expectViolation(RULE, {
        "apps/api/src/routes/forms.ts": IMPORT + body,
      });
    }
  }, 60_000);

  it("REQ-ORGDB-2: follows an aliased import", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/aliased.ts":
        'import { db as database } from "@calibra-facil/db";\nexport const a = () => database.select();\n',
    });
  });

  it("REQ-ORGDB-2: nested route directories are routes too", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/finance/nested.ts": uses(1),
    });
  });

  it("REQ-ORGDB-2: the org-bound handle, other imports and unrelated names are fine", async () => {
    await expectClean(RULE, {
      "apps/api/src/routes/clean.ts":
        'import { orgDb } from "../lib/org-db";\n' +
        'import { db } from "./other-module";\n' +
        'import { sql } from "@calibra-facil/db";\n' +
        "export const a = (organizationId: string) => orgDb(organizationId).select();\n" +
        "export const b = () => db.select();\n" +
        "export const c = (x: { db: number }) => ({ db: x.db });\n",
      // a binding that merely shares the name is not the imported one
      "apps/api/src/routes/no-import.ts":
        "export const a = (db: { select(): number }) => db.select();\n",
    });
  });

  it("REQ-ORGDB-2: only guards route files, not libs, middleware, tests or other apps", async () => {
    await expectClean(RULE, {
      "apps/api/src/lib/helper.ts": uses(3),
      "apps/api/src/middleware/auth.ts": uses(3),
      "apps/api/src/modules/jobs/x.ts": uses(3),
      "apps/api/src/routes/foo.spec.ts": uses(3),
      "apps/api/src/routes/foo.int.spec.ts": uses(3),
      "apps/api/src/routes/__tests__/bar.ts": uses(3),
      "apps/worker/src/routes/x.ts": uses(3),
    });
  });

  it("REQ-ORGDB-2: grandfathers the exact legacy count, fails above it and fails when stale", async () => {
    // apps/api/src/routes/dashboard.ts is baselined; use its real allowance.
    const allowed = RAW_DB_BASELINE.get("apps/api/src/routes/dashboard.ts");
    if (allowed === undefined)
      throw new Error("dashboard.ts left the baseline");
    await expectClean(RULE, {
      "apps/api/src/routes/dashboard.ts": uses(allowed),
    });
    await expectViolation(RULE, {
      "apps/api/src/routes/dashboard.ts": uses(allowed + 1),
    });
    const stale = await expectViolation(RULE, {
      "apps/api/src/routes/dashboard.ts": uses(allowed - 1),
    });
    expect(stale).toMatch(/baseline/i);
  }, 60_000);

  it("REQ-ORGDB-2: every baselined file passes at its exact count, fails at +1 and fails stale at -1", async () => {
    const entries = [...RAW_DB_BASELINE];
    const tree = (delta: number) =>
      Object.fromEntries(
        entries.map(([file, count]) => [file, uses(count + delta)]),
      );

    const exact = await lintFixtures(RULE, tree(0));
    expect(exact.output).not.toContain(`calibra(${RULE})`);
    expect(exact.exitCode).toBe(0);

    const above = await lintFixtures(RULE, tree(1));
    const below = await lintFixtures(RULE, tree(-1));
    for (const [file] of entries) {
      expect(above.output, file).toContain(file);
      expect(below.output, file).toContain(file);
    }
  }, 120_000);

  it("REQ-ORGDB-2: the live routes match the baseline exactly (no file above it, none stale)", async () => {
    const { exitCode, output } = await lintRepoPaths(RULE, [
      "apps/api/src/routes",
    ]);
    expect(output).not.toContain(`calibra(${RULE})`);
    expect(exitCode).toBe(0);
  }, 120_000);

  it("REQ-ORGDB-3: the portal route files are not grandfathered at all", () => {
    const portal = [...RAW_DB_BASELINE.keys()].filter((file) =>
      /apps\/api\/src\/routes\/portal[^/]*\.ts$/.test(file),
    );
    expect(portal).toEqual([]);
  });
});
