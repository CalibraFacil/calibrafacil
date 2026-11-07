import { db } from "@calibra-facil/db";
import {
  forOrg,
  setTransactionOrganization,
  type OrgDb,
} from "@calibra-facil/db/for-org";

/** The Drizzle transaction handle of `db.transaction`, with `execute`. */
export type OrgRawTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/**
 * `withOrg`'s transaction without its after-commit run, for the one place that
 * needs two transactions with work in between that `withOrg` cannot sit
 * around: the job approval (`modules/jobs/approve-job.ts`: object-storage reads
 * before the write transaction, and a compensation transaction that must see a
 * dispatch failure after it). Hands the caller BOTH the org-bound handle and
 * the raw transaction (the frozen certificate input and the queue outbox run
 * raw SQL). Every other write goes through `withOrg`.
 */
export function orgTransactionWithExecutor<R>(
  organizationId: string,
  run: (o: OrgDb, tx: OrgRawTransaction) => Promise<R>,
): Promise<R> {
  return db.transaction(async (tx) => {
    await setTransactionOrganization(tx, organizationId);
    return run(forOrg(tx, organizationId), tx);
  });
}
