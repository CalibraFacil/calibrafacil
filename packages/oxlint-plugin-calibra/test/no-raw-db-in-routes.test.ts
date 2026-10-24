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

  it("REQ-ORGDB-2: getDb() is the raw db under another name", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/get-db.ts":
        'import { getDb } from "@calibra-facil/db";\nexport const a = () => getDb().select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/routes/get-db-alias.ts":
        'import { getDb as open } from "@calibra-facil/db";\nexport const a = () => open().select();\n',
    });
  }, 60_000);

  it("P2-18: the system (owner) path is raw too: systemDb and getSystemDb()", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/system-db.ts":
        'import { systemDb } from "@calibra-facil/db";\nexport const a = () => systemDb.select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/routes/get-system-db.ts":
        'import { getSystemDb } from "@calibra-facil/db";\nexport const a = () => getSystemDb().select();\n',
    });
  }, 60_000);

  it("REQ-ORGDB-2: a namespace import reaches db and getDb too", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/ns-db.ts":
        'import * as pkg from "@calibra-facil/db";\nexport const a = () => pkg.db.select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/routes/ns-get-db.ts":
        'import * as pkg from "@calibra-facil/db";\nexport const a = () => pkg.getDb().select();\n',
    });
    await expectClean(RULE, {
      "apps/api/src/routes/ns-other.ts":
        'import * as pkg from "@calibra-facil/db";\nexport const a = () => pkg.setQueryObserver;\n',
    });
  }, 60_000);

  it("REQ-ORGDB-2: a dynamic import of the db package is a use", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/dynamic.ts":
        'export const a = async () => (await import("@calibra-facil/db")).db.select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/routes/dynamic-destructure.ts":
        'export const a = async () => { const { db } = await import("@calibra-facil/db"); return db; };\n',
    });
    await expectClean(RULE, {
      "apps/api/src/routes/dynamic-other.ts":
        'export const a = async () => import("@calibra-facil/db/schema");\n',
    });
  }, 60_000);

  it("REQ-ORGDB-2: importing db or getDb by name from ANY module (a lib that re-exports it) is a use", async () => {
    await expectViolation(RULE, {
      "apps/api/src/routes/reexported.ts":
        'import { db } from "../lib/raw-db";\nexport const a = () => db.select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/routes/reexported-get-db.ts":
        'import { getDb } from "../lib/raw-db";\nexport const a = () => getDb().select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/routes/reexported-alias.ts":
        'import { db as handle } from "../lib/raw-db";\nexport const a = () => handle.select();\n',
    });
    await expectViolation(RULE, {
      "apps/api/src/routes/reexport-statement.ts":
        'export { db } from "@calibra-facil/db";\n',
    });
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
        'import { sql } from "@calibra-facil/db";\n' +
        'import * as helpers from "./helpers";\n' +
        "export const a = (organizationId: string) => orgDb(organizationId).select();\n" +
        "export const b = () => helpers.something();\n" +
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

  // The committed baseline is empty since P2-18j, so the ratchet is exercised with
  // a baseline INJECTED through the rule options (the repo config never sets it).
  const INJECTED = {
    baseline: {
      "apps/api/src/routes/legacy-a.ts": 2,
      "apps/api/src/routes/legacy-b.ts": 1,
    },
  };

  it("REQ-ORGDB-2: an empty committed baseline grandfathers nothing: a single use fails", async () => {
    expect([...RAW_DB_BASELINE]).toEqual([]);
    await expectViolation(RULE, {
      "apps/api/src/routes/anything.ts": uses(1),
    });
  });

  it("REQ-ORGDB-2: grandfathers the exact legacy count, fails above it and fails when stale", async () => {
    const file = "apps/api/src/routes/legacy-a.ts";
    await expectClean(RULE, { [file]: uses(2) }, INJECTED);
    await expectViolation(RULE, { [file]: uses(3) }, INJECTED);
    const stale = await expectViolation(RULE, { [file]: uses(1) }, INJECTED);
    expect(stale).toMatch(/baseline/i);
    // An unlisted file is still not allowed any.
    await expectViolation(
      RULE,
      { "apps/api/src/routes/new.ts": uses(1) },
      INJECTED,
    );
  }, 60_000);

  it("REQ-ORGDB-2: every baselined file passes at its exact count, fails at +1 and fails stale at -1", async () => {
    const entries = Object.entries(INJECTED.baseline);
    const tree = (delta: number) =>
      Object.fromEntries(
        entries.map(([file, count]) => [file, uses(count + delta)]),
      );

    const exact = await lintFixtures(RULE, tree(0), INJECTED);
    expect(exact.output).not.toContain(`calibra(${RULE})`);
    expect(exact.exitCode).toBe(0);

    const above = await lintFixtures(RULE, tree(1), INJECTED);
    const below = await lintFixtures(RULE, tree(-1), INJECTED);
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
