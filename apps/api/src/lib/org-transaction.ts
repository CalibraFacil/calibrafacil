import { db } from "@calibra-facil/db";
import {
  forOrg,
  setTransactionOrganization,
  type OrgDb,
} from "@calibra-facil/db/for-org";
import { orgDb } from "./org-db";

/** The Drizzle transaction handle of `db.transaction`, with `execute`. */
export type OrgRawTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/**
 * Runs `run` on the caller's org-bound transaction when it has one, else in a
 * transaction of its own that names the laboratory. A lib function that reads
 * for a handler takes an optional `executor` (the handler's `o`) and calls this,
 * so it works both inside a handler's transaction and standalone.
 */
export function inOrgTransaction<R>(
  organizationId: string,
  executor: OrgDb | undefined,
  run: (o: OrgDb) => Promise<R>,
): Promise<R> {
  return executor ? run(executor) : orgDb(organizationId).transaction(run);
}

/**
 * One transaction that names the laboratory for row-level security
 * (`calibra.organization_id`, as `orgDb(org).transaction` does) and hands the
 * caller BOTH the org-bound handle and the raw transaction.
 *
 * Use it only where a callee still takes a plain Drizzle executor with
 * `execute` (calibration-job creation: the per-organization advisory lock and
 * the certificate numbering run raw SQL the handle cannot express). Everything
 * the handler itself reads or writes goes through the handle `o`; the raw
 * transaction `tx` is handed to those callees and nothing else. Their own
 * statements already carry the organization predicate by hand, and the setting
 * made here is what lets them through as `calibra_app`.
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
