import { db } from "@calibra-facil/db";
import { sql } from "drizzle-orm";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs fixture writes that put rows straight into a mid-lifecycle state (an
 * order already delivered, a method already published) instead of walking the
 * state machine command by command. Every lifecycle status column is guarded by
 * a trigger generated from its machine (packages/db status-machines.ts), so such
 * a write is an audited repair: one transaction of the owner connection with
 * `SET LOCAL calibra.allow_status_repair = 'on'`, exactly what an operator's
 * repair is. Requests under test still run as calibra_app, where the hatch does
 * not open.
 */
export async function withStatusRepair<T>(
  // A Drizzle query builder is a thenable, not a Promise: it runs when awaited.
  run: (tx: Transaction) => T,
): Promise<Awaited<T>> {
  // Collected rather than returned from the callback: `db` is a union of two
  // drivers whose `transaction` signatures do not unify on a generic result.
  const results: Awaited<T>[] = [];
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local calibra.allow_status_repair = 'on'`);
    results.push(await run(tx));
  });
  for (const result of results) return result;
  throw new Error("withStatusRepair: the transaction produced no result");
}
