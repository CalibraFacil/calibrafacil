# The organization-bound data handle

Every tenant table carries `organization_id` / `lab_organization_id` (see
[tenancy.md](./tenancy.md)). A route handler that queries through the global Drizzle `db` has to
remember that predicate on every statement; the tenant SQL guard of the integration tier only
catches a forgotten one after the fact. The org-bound handle makes the predicate something the
handler cannot forget.

## The handle

```ts
import { orgDb } from "../lib/org-db"; // forOrg(db, organizationId)

const o = orgDb(scope.labOrganizationId);

await o.select({ id: asset.id }).from(asset).where(eq(asset.id, id)); // ... AND lab_organization_id = $org
await o.update(asset).set({ name }).where(eq(asset.id, id)); //          ... AND lab_organization_id = $org
await o.delete(asset).where(eq(asset.id, id)); //                        ... AND lab_organization_id = $org
await o.insert(asset).values({ ...row, labOrganizationId: o.organizationId }); // another org throws
await o.transaction(async (tx) => tx.select(/* ... */)); //              tx is bound to the same org
```

`forOrg(executor, organizationId)` lives in `packages/db/src/for-org.ts` (subpath
`@calibra-facil/db/for-org`) and works on the global `db` and on the `tx` of `db.transaction`.
`apps/api/src/lib/org-db.ts` binds it to the global `db` for the API.

- **Reads, updates, deletes.** The `from()` / `update()` / `delete()` table gets the organization
  predicate in the WHERE, ANDed with whatever `.where()` the caller adds. An inner or left joined
  tenant table gets it in its ON clause. The handle is a thin Proxy over the Drizzle builders, so
  every query keeps its Drizzle result type.
- **Writes.** `set()` cannot touch the organization column. An insert row that carries another
  organization throws; a row without one gets the bound organization.
- **Upserts.** `onConflictDoUpdate` cannot set the organization column, and the organization
  predicate is ANDed into its `setWhere` (a legacy `where` is folded into it), so a unique key that
  is not per organization can never update another laboratory's row. `onConflictDoNothing` and
  `returning` are unchanged.
- **Global tables** (`organization`, `user`, `asset_type`, ... per `tenancy.ts`) pass through
  untouched.
- **Fail closed.** Shapes that cannot be scoped throw instead of running unscoped: a non-table
  `from`/join source (subquery, raw `sql`), right/full/cross/lateral joins, `update ... from`,
  `insert ... select`, and the set operators (`union`, `intersect`, `except`, with or without
  `all`).
- **Raw `sql` fragments are NOT scoped.** A `sql` template inside select fields or a `where`
  (a correlated subquery, `exists (...)`, a computed column) reaches Postgres exactly as written.
  The handle cannot see inside it. Such a fragment must be correlated to the scoped parent row
  (`... where child.parent_id = ${parent.id}`) or be built from handle builders
  (`o.select(...).from(...)`), and reviewers check that. The handle runs one raw statement of its
  own, `advisoryXactLock(key1, key2)` (`pg_advisory_xact_lock`), which locks no table and reads no
  tenant row.
- **A set of laboratories is read-only.** `orgSetDb(ids)` (`forOrgs`) binds `IN (...)`: for the
  surfaces that read across several laboratories by design (a portal customer user who belongs to
  customers of more than one laboratory). It has no insert, update or delete, in the type and at
  runtime; a write names the one organization it writes to (read the rows through the set handle,
  then `orgDb(row.organizationId)` to write). An empty set matches nothing.

## What stays off the org-bound handle: the system path

Statements that are cross-organization by design: the lookup that LEARNS the laboratory of a
session (the portal customer scope, the host name of a portal request, the user's own
memberships), public-token lookups, reads over a SET of laboratories (`orgSetDb`), notification
fan-out, cron and queue sweeps. They run on the named **system path**: `systemDb` /
`getSystemDb()` of `@calibra-facil/db` (`packages/db/src/db.ts`), the connection of the table owner.

- It connects with `DATABASE_OWNER_URL`; unset it IS the application connection (while
  `DATABASE_RLS_MODE=shadow` the application is the owner, so there is nothing to split). The role split
  sets it (DEPLOYMENT.md, "Row-level security").
- It lives in lib modules, each with a comment saying why the statement cannot name an organization yet
  and an entry in `apps/api/test/integration/tenant-sql-allowlist.ts`; `calibra/no-raw-db-in-routes`
  forbids `systemDb` / `getSystemDb` in `apps/api/src/routes/**` exactly like `db`, so a route reaches it
  only through a named lib function.
- Keep it small: a statement that learns the laboratory runs on it, and everything after that runs on
  `orgDb(thatLaboratory).transaction(...)`. The portal does exactly this: `resolvePortalCustomerScope`
  (system) yields `scope.labOrganizationId`, every handler then runs its reads and writes in
  `orgDb(scope.labOrganizationId).transaction(...)`.
- `orgSetDb(ids)` runs on it too (one `calibra.organization_id` cannot name a set), keeping the
  `organization_id IN (...)` predicate and staying read-only. The follow-up is a set-aware policy or a
  per-laboratory fan-out, if the wall must hold for those reads as well.
- **`asset_type` writes.** `asset_type` is a global catalog; the change-log trigger of migration 0122 copies
  every write into the change log of EVERY laboratory, which a `calibra_app` session may not do (those rows
  belong to other organizations). The only writer is the seed (`seedAssetTypes`, run by `init` and `seed-demo`;
  `routes/asset-types.ts` is read-only), and it now writes through `systemDb`: the owner connection, named
  and explicit. Chosen over a `SECURITY DEFINER` function because it needs no migration, no new privilege
  and no second copy of the write logic, and the catalog is maintained by the platform operator, not by a
  laboratory's session. Reads of the catalog stay on the application pool (no policy on a global table). If a
  route ever has to write the catalog, it calls a named lib function on `systemDb`.

## The lint ratchet

`calibra/no-raw-db-in-routes` (`packages/oxlint-plugin-calibra`) forbids the raw handle in
`apps/api/src/routes/**`: `db` and `getDb()` from `@calibra-facil/db`, a namespace import reaching
them (`import * as x`, `x.db`), a dynamic `import("@calibra-facil/db")`, and importing `db` or
`getDb` by name from ANY module (so a lib that re-exports the raw handle is no way around it). The routes that still use it are grandfathered as
exact per-file counts in `packages/oxlint-plugin-calibra/src/lib/raw-db-baseline.ts`: a count may
not go up, and a count above the file's real number of uses fails too, so the allowance shrinks in
the same change that migrates a handler (delete the entry at zero). The portal routes
(`portal*.ts`) have no entry.

## Row-level security (shadow mode, P2-3)

Migration 0123 enables RLS (not forced) on every tenant table with the policy `tenant_isolation` for the
role `calibra_app`: `USING` / `WITH CHECK` `<org column> = NULLIF(current_setting('calibra.organization_id', true), '')::<type>`.
The table owner is exempt, so nothing changes for the owner connection production uses today; see
[DEPLOYMENT.md](../../DEPLOYMENT.md) for the role split the owner runs later. The SQL is generated from
`tenancy.ts` (`pnpm --filter @calibra-facil/db gen:rls-sql`) and `rls-sql.test.ts` fails when a tenant table is
added or removed without a migration.

- **The handle names the organization.** `orgDb(id).transaction(...)` runs
  `select set_config('calibra.organization_id', $org, true)` first (transaction-local: it ends with the
  transaction, so it never leaks to the next one on a pooled connection). Inside a bigger transaction (a
  transaction scope, a caller's `db.transaction`) the handle's transaction is a savepoint: it sets its own
  organization and, when the outer transaction had named one, puts it back when it succeeds (an outer
  transaction that named none keeps the savepoint's organization until it ends).
- **Statements outside a transaction set nothing: fail closed.** `o.select(...)` straight on the handle
  carries the organization predicate but no setting, so as `calibra_app` it matches no row; as the owner it
  is unchanged. Wrapping every read in a short transaction was rejected for this step: it would add `BEGIN`,
  `set_config` and `COMMIT` round trips to every request in production for a role nobody connects as yet,
  and the shape the cutover wants is one transaction (and one `set_config`) per request, which is the
  transaction scope (P2-4a), not a wrapper per read. The shadow report lists which reads need it.
- **A set of laboratories runs on the system path.** `orgSetDb(ids)` (portal customer users that belong to several
  laboratories) is read-only and its transaction cannot name an organization: a single setting cannot name a
  set. It therefore reads through `systemDb` (see "the system path" above) with its `IN (...)` predicate.
- **Portal (P2-18a).** Every portal handler (`/api/portal/*`, the portal service-order endpoints, the lab-side
  `/api/portal-domains`) resolves the laboratory first (system path) and then runs its statements in
  `orgDb(lab).transaction(...)`; side effects that read what the transaction wrote (notifications, queue
  jobs) run after it commits. `pnpm --filter @calibra-facil/api rls:shadow-report` shows 0 unscoped
  statements and 0 broken tests for the portal specs.
- **Tests.** `apps/api/src/lib/rls-shadow.int.spec.ts` runs against a pool whose sessions are `calibra_app`
  (`test/integration/rls.ts`). `pnpm --filter @calibra-facil/api rls:shadow-report` replays the portal and
  jobs specs with each request's database access as `calibra_app` (strict, then audit) and prints what
  breaks, by file, and every statement that reached a tenant table without an organization.
- **Start-up check.** `DATABASE_RLS_MODE` (`shadow` by default) makes the API and the worker run one catalog
  query at start-up (`packages/db/src/rls-startup.ts`) and refuse to start as a role the policies bind (not the
  table owner, superuser or BYPASSRLS). The role split sets `enforced` for the API. Migration 0123 applies
  the same test to the role that runs it.
