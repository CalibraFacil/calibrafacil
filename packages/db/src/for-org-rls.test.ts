import { describe, expect, it } from "vitest";
import { type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import { forOrg, forOrgs, type OrgExecutor } from "./for-org";
import { ORGANIZATION_SETTING } from "./rls-sql";
import * as schema from "./schema";

// A connection-less executor whose `transaction` runs the callback on a fake
// `tx` that records what it executes. The real-database behaviour (the setting
// reaching Postgres, and being gone after the transaction) is covered by
// apps/api/src/lib/rls-policies.int.spec.ts.
const mock = drizzle.mock({ schema });
const ORG = "lab-a";
const dialect = new PgDialect();

type Recorded = { text: string; params: unknown[] };

function recordingExecutor(
  log: Recorded[],
  options: { previous?: string } = {},
): OrgExecutor {
  const tx = new Proxy(mock, {
    get(target, property) {
      if (property === "execute") {
        return async (statement: SQL) => {
          const query = dialect.sqlToQuery(statement);
          log.push({
            text: query.sql.replace(/\s+/g, " "),
            params: query.params,
          });
          return [{ previous: options.previous ?? "" }];
        };
      }
      if (property === "transaction") {
        return async (run: (inner: OrgExecutor) => Promise<unknown>) => run(tx);
      }
      return Reflect.get(target, property);
    },
  });
  return tx;
}

describe("forOrg: the organization setting of a transaction", () => {
  it("REQ-RLS-4: transaction() sets calibra.organization_id transaction-locally before the callback runs", async () => {
    const log: Recorded[] = [];
    const o = forOrg(recordingExecutor(log), ORG);
    let seenInCallback = 0;
    await o.transaction(async () => {
      seenInCallback = log.length;
    });
    expect(seenInCallback).toBeGreaterThan(0);
    const [first] = log;
    expect(first?.text).toContain("set_config(");
    expect(first?.text).toContain(`'${ORGANIZATION_SETTING}'`);
    // The third argument is `true`: is_local, so it ends with the transaction.
    expect(first?.text).toMatch(
      /set_config\('calibra\.organization_id', \$\d+, true\)/,
    );
    expect(first?.params).toContain(ORG);
  });

  it("REQ-RLS-4: a handle opened on a transaction's tx sets its own organization in the nested transaction, and restores the outer one after", async () => {
    const log: Recorded[] = [];
    const outer = forOrg(
      recordingExecutor(log, { previous: "lab-outer" }),
      ORG,
    );
    await outer.transaction(async () => {});
    const texts = log.map((entry) => entry.text);
    expect(texts.length).toBeGreaterThanOrEqual(2);
    // The last statement puts the previous value back.
    const last = log.at(-1);
    expect(last?.text).toMatch(
      /set_config\('calibra\.organization_id', \$\d+, true\)/,
    );
    expect(last?.params).toContain("lab-outer");
  });

  it("REQ-RLS-4: the read-only set handle sets nothing (a set of laboratories is not one organization)", async () => {
    const log: Recorded[] = [];
    const set = forOrgs(recordingExecutor(log), [ORG, "lab-b"]);
    await set.transaction(async () => {});
    expect(log).toEqual([]);
  });

  it("REQ-RLS-4: a statement on the handle outside a transaction runs no set_config (fail closed under calibra_app)", async () => {
    const log: Recorded[] = [];
    const o = forOrg(recordingExecutor(log), ORG);
    void o.select;
    void o.insert;
    expect(log).toEqual([]);
  });
});
