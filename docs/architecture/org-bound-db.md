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

## What stays on the plain `db`

Statements that are cross-organization by design: the lookup that LEARNS the laboratory of a
session (the portal customer scope, the user's own memberships), public-token lookups, cron and
queue sweeps. They live in lib modules, with a reason in
`apps/api/test/integration/tenant-sql-allowlist.ts`, never in a route.

## The lint ratchet

`calibra/no-raw-db-in-routes` (`packages/oxlint-plugin-calibra`) forbids the raw handle in
`apps/api/src/routes/**`: `db` and `getDb()` from `@calibra-facil/db`, a namespace import reaching
them (`import * as x`, `x.db`), a dynamic `import("@calibra-facil/db")`, and importing `db` or
`getDb` by name from ANY module (so a lib that re-exports the raw handle is no way around it). The routes that still use it are grandfathered as
exact per-file counts in `packages/oxlint-plugin-calibra/src/lib/raw-db-baseline.ts`: a count may
not go up, and a count above the file's real number of uses fails too, so the allowance shrinks in
the same change that migrates a handler (delete the entry at zero). The portal routes
(`portal*.ts`) have no entry.
