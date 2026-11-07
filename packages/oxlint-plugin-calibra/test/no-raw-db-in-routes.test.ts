import { describe, expect, it } from "vitest";
import { expectClean, expectViolation, lintRepoPaths } from "./harness.ts";

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
      "apps/api/src/domains/example/routes/brand-new.ts": uses(1),
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
        "apps/api/src/domains/example/routes/forms.ts": IMPORT + body,
      });
    }
  }, 60_000);

  it("REQ-ORGDB-2: getDb() is the raw db under another name", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/get-db.ts":
        'import { getDb } from "@calibra-facil/db";\nexport const a = () => getDb().select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/get-db-alias.ts":
        'import { getDb as open } from "@calibra-facil/db";\nexport const a = () => open().select();\n',
    });
  }, 60_000);

  it("P2-18: the system (owner) path is raw too: systemDb and getSystemDb()", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/system-db.ts":
        'import { systemDb } from "@calibra-facil/db";\nexport const a = () => systemDb.select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/get-system-db.ts":
        'import { getSystemDb } from "@calibra-facil/db";\nexport const a = () => getSystemDb().select();\n',
    });
  }, 60_000);

  it("REQ-ORGDB-2: a namespace import reaches db and getDb too", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/ns-db.ts":
        'import * as pkg from "@calibra-facil/db";\nexport const a = () => pkg.db.select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/ns-get-db.ts":
        'import * as pkg from "@calibra-facil/db";\nexport const a = () => pkg.getDb().select();\n',
    });
    await expectClean(RULE, {
      "apps/api/src/domains/example/routes/ns-other.ts":
        'import * as pkg from "@calibra-facil/db";\nexport const a = () => pkg.setQueryObserver;\n',
    });
  }, 60_000);

  it("REQ-ORGDB-2: a dynamic import of the db package is a use", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/dynamic.ts":
        'export const a = async () => (await import("@calibra-facil/db")).db.select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/dynamic-destructure.ts":
        'export const a = async () => { const { db } = await import("@calibra-facil/db"); return db; };\n',
    });
    await expectClean(RULE, {
      "apps/api/src/domains/example/routes/dynamic-other.ts":
        'export const a = async () => import("@calibra-facil/db/schema");\n',
    });
  }, 60_000);

  it("REQ-ORGDB-2: importing db or getDb by name from ANY module (a lib that re-exports it) is a use", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/reexported.ts":
        'import { db } from "../lib/raw-db";\nexport const a = () => db.select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/reexported-get-db.ts":
        'import { getDb } from "../lib/raw-db";\nexport const a = () => getDb().select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/reexported-alias.ts":
        'import { db as handle } from "../lib/raw-db";\nexport const a = () => handle.select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/reexport-statement.ts":
        'export { db } from "@calibra-facil/db";\n',
    });
  }, 60_000);

  it("REQ-ORGDB-2: follows an aliased import", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/aliased.ts":
        'import { db as database } from "@calibra-facil/db";\nexport const a = () => database.select();\n',
    });
  });

  it("REQ-ORGDB-2: nested route directories are routes too", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/finance/routes/nested.ts": uses(1),
    });
  });

  it("REQ-ORGDB-2: a domain's routes/ folder is a routes folder, its other files are not", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/finance/routes/new.ts": uses(1),
    });
    await expectClean(RULE, {
      "apps/api/src/domains/finance/finance.ts": uses(3),
    });
  });

  it("REQ-ORGDB-2: the org-bound handle, other imports and unrelated names are fine", async () => {
    await expectClean(RULE, {
      "apps/api/src/domains/example/routes/clean.ts":
        'import { orgDb } from "../lib/org-db";\n' +
        'import { sql } from "@calibra-facil/db";\n' +
        'import * as helpers from "./helpers";\n' +
        "export const a = (organizationId: string) => orgDb(organizationId).select();\n" +
        "export const b = () => helpers.something();\n" +
        "export const c = (x: { db: number }) => ({ db: x.db });\n",
      // a binding that merely shares the name is not the imported one
      "apps/api/src/domains/example/routes/no-import.ts":
        "export const a = (db: { select(): number }) => db.select();\n",
    });
  });

  it("REQ-ORGDB-2: only guards route files, not libs, middleware, tests or other apps", async () => {
    await expectClean(RULE, {
      "apps/api/src/lib/helper.ts": uses(3),
      "apps/api/src/middleware/auth.ts": uses(3),
      "apps/api/src/domains/jobs/commands/x.ts": uses(3),
      "apps/api/src/domains/example/routes/foo.spec.ts": uses(3),
      "apps/api/src/domains/example/routes/foo.int.spec.ts": uses(3),
      "apps/api/src/domains/example/routes/__tests__/bar.ts": uses(3),
      "apps/worker/src/routes/x.ts": uses(3),
    });
  });

  it("REQ-ORGDB-2: nothing is grandfathered: a single use fails", async () => {
    await expectViolation(RULE, {
      "apps/api/src/domains/example/routes/anything.ts": uses(1),
    });
  });

  it("REQ-ORGDB-2: no live route uses the raw db", async () => {
    const { exitCode, output } = await lintRepoPaths(RULE, [
      "apps/api/src/domains",
    ]);
    expect(output).not.toContain(`calibra(${RULE})`);
    expect(exitCode).toBe(0);
  }, 120_000);
});
