import { db, systemDb } from "@calibra-facil/db";
import {
  forOrg,
  forOrgs,
  type OrgDb,
  type OrgSetDb,
} from "@calibra-facil/db/for-org";

/**
 * The data handle route handlers use (P2-2). It is the global `db` bound to one
 * laboratory: every statement on a tenant table gets `organization_id = $org`
 * (select/update/delete) or has it set (insert) without the handler writing it,
 * so a handler cannot forget the predicate. See packages/db/src/for-org.ts.
 *
 * Routes may not touch the raw `db` (calibra/no-raw-db-in-routes); inside a
 * `db.transaction` use `orgDb(id).transaction(...)`.
 */
export function orgDb(organizationId: string): OrgDb {
  return forOrg(db, organizationId);
}

/**
 * Handle bound to a bounded set of organizations, for the surfaces that read
 * across several by design (a portal customer user who belongs to customers of
 * more than one laboratory). Read-only.
 *
 * It runs on the SYSTEM path (the owner connection, `systemDb`), not on the
 * application pool: row-level security names ONE organization per transaction
 * (`calibra.organization_id`), so a set of laboratories cannot be named and,
 * as `calibra_app`, the read would match nothing. The handle still adds
 * `organization_id IN (...)` to every tenant table it touches, the ids come
 * from a membership the caller already verified, and it cannot write, so the
 * second wall is the predicate here, not the policy. A single-laboratory read
 * must use `orgDb(id).transaction(...)` instead.
 */
export function orgSetDb(organizationIds: readonly string[]): OrgSetDb {
  return forOrgs(systemDb, organizationIds);
}
