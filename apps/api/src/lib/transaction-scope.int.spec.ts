/**
 * transaction-scope.int.spec.ts: the transaction scope against real Postgres
 * (D4). The scope's own rules are unit-tested in packages/db with a fake
 * database; this proves the fake's model is the real one: savepoints, rollback,
 * isolation between concurrent scopes and a stray continuation after the scope.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, runInTransactionScope } from "@calibra-facil/db";
import { truncateAll } from "../../test/integration/db";

async function insertMarker(label: string) {
  await db.execute(sql`
    insert into app_queue_job (type, payload, max_attempts, available_at)
    values ('scope-test', ${JSON.stringify({ label })}::jsonb, 1, now())
  `);
}

async function markers(): Promise<string[]> {
  const rows = await db.execute(
    sql`select payload->>'label' as label from app_queue_job order by id`,
  );
  return Array.from(rows, (row) => String(row.label));
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  await truncateAll();
});

describe("transaction scope on real Postgres (D4)", () => {
  it("D4: a nested transaction that fails rolls back only its own writes (savepoint); the scope's other writes commit", async () => {
    await runInTransactionScope(async () => {
      await insertMarker("before");
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`
            insert into app_queue_job (type, payload, max_attempts, available_at)
            values ('scope-test', '{"label":"inner"}'::jsonb, 1, now())
          `);
          throw new Error("inner failed");
        }),
      ).rejects.toThrow("inner failed");
      await insertMarker("after");
    });

    expect(await markers()).toEqual(["before", "after"]);
  });

  it("D4: an error that leaves the scope rolls back everything it wrote, nested transactions included", async () => {
    await expect(
      runInTransactionScope(async () => {
        await insertMarker("outer");
        await db.transaction(async (tx) => {
          await tx.execute(sql`
            insert into app_queue_job (type, payload, max_attempts, available_at)
            values ('scope-test', '{"label":"inner"}'::jsonb, 1, now())
          `);
        });
        throw new Error("the event failed");
      }),
    ).rejects.toThrow("the event failed");

    expect(await markers()).toEqual([]);
  });

  it("D4: concurrent scopes are isolated: one that rolls back does not touch the other's commit", async () => {
    const committed = runInTransactionScope(async () => {
      await insertMarker("kept-1");
      await sleep(30);
      await insertMarker("kept-2");
    });
    const rolledBack = runInTransactionScope(async () => {
      await insertMarker("lost");
      await sleep(10);
      throw new Error("rolled back");
    }).catch(() => undefined);

    await Promise.all([committed, rolledBack]);

    expect((await markers()).toSorted()).toEqual(["kept-1", "kept-2"]);
  });

  it("D4: a fire-and-forget read started inside the scope and finished after it uses the pool, not the closed transaction", async () => {
    let afterCommit: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      afterCommit = resolve;
    });
    let late: Promise<string[]> = Promise.resolve([]);

    await runInTransactionScope(async () => {
      await insertMarker("committed");
      // Created inside the scope, so it carries the scope's context; it only
      // runs once the scope has committed and closed.
      late = gate.then(markers);
    });
    afterCommit();

    expect(await late).toEqual(["committed"]);
  });
});
