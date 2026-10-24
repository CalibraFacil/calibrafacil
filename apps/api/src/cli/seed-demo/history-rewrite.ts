/**
 * The seed back-dates history on purpose (audit rows, approval times, the
 * certificate snapshot). Postgres refuses those rewrites on approved jobs, the
 * issued-certificate snapshot and the append-only audit tables, except inside a
 * transaction that sets `calibra.allow_audit_rewrite = 'on'`. The setting is
 * transaction-local (`set_config(..., true)`): it reverts at COMMIT/ROLLBACK, so
 * nothing outside the callback sees it. Only the seed uses this; no route does.
 */
import { systemDb as ownerDb } from "@calibra-facil/db";
import { sql } from "drizzle-orm";

export type HistoryRewriteTx = Parameters<
  Parameters<typeof ownerDb.transaction>[0]
>[0];

export async function withHistoryRewrite<T>(
  run: (tx: HistoryRewriteTx) => Promise<T>,
): Promise<T> {
  return ownerDb.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
    );
    return run(tx);
  });
}
