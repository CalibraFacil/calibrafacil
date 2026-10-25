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

- It connects with `DATABASE_OWNER_URL`, which `DATABASE_RLS_MODE=enforced` (the default) requires: start-up
  refuses to run without it, or with one whose role RLS binds. Only in `shadow` mode (diagnosis) may it be
  unset, and then it IS the application connection, which is the owner (DEPLOYMENT.md, "Row-level security").
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
the same change that migrates a handler (delete the entry at zero). The baseline is EMPTY since P2-18j:
every route is migrated, so a route that needs a statement outside an organization calls a named lib
function (`lib/identity.ts`, `lib/public-signup-store.ts`, ...), never the raw handle.

## Row-level security (enforced since P2-18k)

Migration 0123 enables RLS (not forced) on every tenant table with the policy `tenant_isolation` for the
role `calibra_app`: `USING` / `WITH CHECK` `<org column> = NULLIF(current_setting('calibra.organization_id', true), '')::<type>`.
The application connects as `calibra_app` (`DATABASE_URL`) and, since the cutover, that is the normal setup
everywhere: `DATABASE_RLS_MODE` defaults to `enforced`, the compose files, `pnpm setup:dev`, the integration
tiers and CI all run the application as that role. The table owner (`DATABASE_OWNER_URL`) is exempt and is only
used by the named system path, the migrations and the CLI; see [DEPLOYMENT.md](../../DEPLOYMENT.md) ("Row-level
security") for the role split, the upgrade of an existing installation and the rollback. The SQL is generated from
`tenancy.ts` (`pnpm --filter @calibra-facil/db gen:rls-sql`) and `rls-sql.test.ts` fails when a tenant table is
added or removed without a migration.

- **The tables are not `FORCE`d (P2-18k decision).** `FORCE ROW LEVEL SECURITY` would bind the owner too, which
  would give an accidental owner connection the same wall. But the owner legitimately runs what no one
  organization can name: Better Auth's adapter (Q40: sessions and the organization plugin run before an
  organization is chosen), the lookups that learn a laboratory, the cross-laboratory sweeps and listings, the
  `asset_type` write fan-out (a change-log row per laboratory), the migrations (`ALTER`, backfills) and the
  CLI. The policies are addressed to `calibra_app` only, so under `FORCE` the owner would match no policy and
  see nothing; an extra all-allowing owner policy would defeat the point. The accidental owner connection is
  closed instead at start-up: in `enforced` mode the API and the worker refuse a `DATABASE_URL` whose role RLS
  does not bind (owner, superuser, BYPASSRLS), a missing `DATABASE_OWNER_URL` and an owner URL whose role RLS
  binds, naming the variable. No migration is needed for any of this.
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
- **Master data (P2-18c).** Assets, customers, customer groups, services, units, visits (lab side),
  calibration requests, materials, environmental limits and certificate numbering run every statement in
  `orgDb(lab).transaction(...)`; their raw-`db` baseline entries are gone. Details worth knowing:
  - The `member` and `invitation` rows of a customer's or group's CLIENT organization carry that organization
    as their tenant column, so reading them is a transaction that names the CLIENT organization
    (`orgDb(customer.authOrganizationId).transaction`), after the lab-scoped lookup proved the customer is its own.
  - A lib function that reads for a handler takes an optional `executor` (the handler's `o`) or opens its own
    transaction (`inOrgTransaction`, `lib/org-transaction.ts`); `asset_type` is a global catalog and is read
    through `lib/asset-types.ts` on the plain handle.
  - Job creation (`createCalibrationJob`) still takes a Drizzle executor with `execute` (advisory locks,
    certificate numbering), which the org-bound handle does not offer. `orgTransactionWithExecutor` opens a
    `db.transaction`, names the laboratory, and hands the handler both the handle and the raw transaction; the
    raw one goes to that callee only. `cancelJob` takes optional `read`/`write` runners for the same reason.
  - A retry on a unique violation (unit slugs) opens a new transaction per attempt: the violation aborts the
    one that raised it.
  - Specs: `master-data-lab-scope.int.spec.ts` covers the success paths the per-router specs do not reach, each
    with a cross-laboratory negative.
- **Quality records (P2-18d).** The standards (certificates, recall workflow), methods, accredited scope,
  competences, training records, authorized signatories, proficiency tests and SPC routes resolve the
  laboratory from the session (`requireOrganization` already did) and run every statement in
  `orgDb(lab).transaction(...)`, so the audit entry of a regulated change commits with the change. The lib
  functions they call took an optional org-bound handle instead of the global `db` (`executor`, or an
  `OrgScope` = handle + `afterCommit` collector when the function also fires a side effect:
  `createNonConformanceRecord`, `ensureStandardRecall`, `createStandardRecallNotifications`;
  `lib/after-commit.ts`): the notification or queue job a transaction triggers waits for its commit
  (`afterCommitQueue().run()`), and the retry loop over a sequential number (CAPA, NC) runs each attempt in a
  savepoint of the caller's transaction. Without the handle every one of them still writes through `db`, so the
  jobs, sync and desktop callers are unchanged until their own slice. The SPC nightly sweep
  (`packages/jobs-core/src/spc-recompute.ts`) learns which laboratories own a chart on the system path (one
  `select distinct organization_id`, allowlisted) and evaluates every chart in `forOrg(db, lab).transaction`,
  one transaction per chart so a failing chart does not stop the sweep.
- **Service orders and finance (P2-18g).** The lab service-order modules (`modules/service-orders/*`:
  commands, quotes, execution, evaluations, certificates, documents, tokens, list queries) and the finance
  routes (`routes/finance/*`) run every statement in `orgDb(lab).transaction(...)`; each command is ONE
  transaction (reads, writes, the service-order event and the e-mail outbox row commit or roll back together,
  `enqueueServiceOrderEmail(o)`), and the document / PDF queue jobs are enqueued after it commits
  (`afterCommitQueue` where there are several). Where a step was a transaction of its own before, it stays one:
  closing an order creates the billing document in its own transaction after the close commits (it takes the
  numbering advisory lock and updates the same order row), and the ERP export (`exportBillingDocumentToPrimaryIntegration`,
  remote HTTP calls) holds no transaction across a call: each of its statements is a short transaction naming the
  laboratory. The billing numbering (`generateBillingDocumentNumber`) needs raw SQL for its advisory lock, so
  the handlers that issue a document use `orgTransactionWithExecutor` (handle + raw transaction). The libs they call
  (`lib/finance.ts`, `service-order-workflow.ts`, `tenant-refs.ts`, `certificate-release.ts`, `automatic-send.ts`,
  `billing-readiness.ts`, the cash / margin / operations-to-cash / revenue-leakage readers, `supplier.ts`,
  `outsourced-cost.ts`) take an optional org-bound handle and, without one, open an org-bound transaction of
  their own, so the jobs, sync, integration and desktop callers need no change and are scoped as well. The one
  system-path statement of the slice is the lookup of a public quote link by its token / approval-code hash
  (`service-order.tokens.ts`, `service_order_public_access_token`, select only): the grant row names the
  laboratory and everything after it runs on `orgDb(grant.organizationId)`. Not in this slice: the service-order
  e-mail drain (`lib/service-order-email-drain.ts`, `service-order-email-once.ts`, a cron/worker sweep) and the
  Conta Azul callees (`requireContaAzulOAuthConfig`); inside a transaction an error is rethrown (never turned into
  a response in the callback), so a failure after the first write rolls the whole command back.
- **NC / CAPA, dashboard, reports, signatures (P2-18e).** The non-conformance, CAPA, dashboard, consolidated
  report, visual-signature and signing-certificate routes run every statement in `orgDb(lab).transaction(...)`;
  their raw-`db` baseline entries are gone. Details worth knowing:
  - A handler that creates an NC or escalates one to a CAPA runs its notification through
    `afterCommitQueue` (after the commit, as in P2-18d); the escalation's CAPA, its audit entry, the NC link and
    the NC audit entry are one transaction, so a failure on any of them leaves none.
  - The two calendar-day trend queries (dashboard, consolidated trend) were raw `db.execute(sql...)`, which the
    org-bound handle does not offer; they are now `o.select(...)` builders with `sql` expressions for the day
    bucket and the `FILTER` counts, so the handle adds the organization predicate.
  - The handlers that talk to object storage (visual signatures) keep the storage call outside the database
    transaction: read, then store, then write, as before.
  - The public out-of-tolerance acknowledgement link (`routes/oot-ack.ts`) learns the laboratory from the
    unguessable ack token: that one lookup is `findOotNotificationByAckToken` in `lib/oot-acknowledgement.ts`
    on the system path (allowlisted, "public-token"), and the stamp runs in `orgDb(laboratory).transaction`.
  - Specs: `nc-capa-lab-scope.int.spec.ts` and `signatures-signing-lab-scope.int.spec.ts` cover the success
    paths the per-router specs do not reach, each with a cross-laboratory negative, plus an escalation that
    rolls back as a whole.
- **Integrations, public API, webhooks, API keys, notifications (P2-18h).** The ERP integration routes and
  modules (`modules/integrations/*`, `lib/conta-azul-app.ts`, `lib/integration-drift.ts`, material stock adjustment),
  the API-key routes, the public API v1 and v2 (including webhook delivery and replay), the notification routes and
  `packages/notifications`, the e-mail sender resolution (`packages/email-sender/src/sender.ts`) and the e-mail drains
  run every statement in a transaction that names an organization; the `routes/**` raw-`db` entries for these files
  are gone (`api-keys`, `integrations`, `notifications`, `public-api`, `webhooks` and every `public-api-v2/*`).
  Details worth knowing:
  - The integration libs take an optional org-bound handle (`executor`) and otherwise open a short transaction of
    their own (`inOrgTransaction`), so a handler can put a change and its events in one transaction
    (`writeIntegrationEvent(params, o)`) while the cron sweeps need no change. A remote call (Conta Azul, ERP HTTP,
    a webhook target, the e-mail transport) never runs inside a transaction: the poll reads, calls, then writes its
    bookkeeping (config watermark, cursor, event) in one transaction; a webhook delivery inserts its row, posts, then
    records the outcome. Relational `db.query...` reads became `select` builders (the handle has no `query`).
  - `requireContaAzulOAuthConfig` (deferred by #112) takes the same optional executor. The OAuth callback's session
    lookup runs in the laboratory named by the signed state.
  - API keys: `requireApiKeyAuth` looks the key up by its hash on the system path (the hash IS the credential and
    names the laboratory); the last-used touch and every handler statement run in `orgDb(key.organizationId)`.
  - Notifications: a sender is called with the id of an entity its caller just operated on, or with the laboratory.
    `packages/notifications/src/lab-scope.ts` learns the laboratory of a job / calibration request / visit / audit
    pack id with a one-column system-path lookup, and everything after runs in `inOrg(organization)`: the entity reads in
    the laboratory, the notification rows in the RECIPIENT's organization (a portal user's belong to the CLIENT
    organization), and no transaction is held across the e-mail. Global tables (`user`, `organization`,
    `notification_preference`) are read on the plain handle. The portal due-digest enumerates the opted-in users of every
    laboratory on the system path (`listPortalDigestRecipients`) and reads each customer's instruments in its own
    laboratory. A reminder asked with a laboratory that does not own the entity finds nothing.
  - Cron sweeps (Conta Azul scheduled sync and polls, the service-order and out-of-tolerance e-mail drains) list the
    laboratories / owed rows on the system path (one statement each) and then claim, load and finish each row in a
    transaction naming `row.organizationId`. The drains keep their raw SQL (claim / release / redact) with an explicit
    `organization_id` predicate, run through `orgTransactionWithExecutor`.
  - `flagJobOutOfTolerance` / `ensureOotNotificationForNc` without a caller's scope now run the whole workflow in one
    organization-bound transaction (PDF job after the commit) instead of the plain `db`.
  - Not in this slice (done in P2-18j, below): the raw-`pg` compliance sweep of `packages/jobs-core/src/scheduled/*`
    and the e-mail-domain settings routes (`routes/email-domains.ts`, `lib/email-domain*.ts`); the job modules the v2
    job endpoints call were P2-18f.
  - Specs: `public-api-lab-scope`, `integrations-lab-scope` and `notifications-sweeps-lab-scope` (the sweeps and
    senders run as `calibra_app`) cover the success paths the per-router specs do not reach, each with a
    cross-laboratory negative.
- **Calibration jobs (P2-18f).** `routes/jobs.ts` (no raw-`db` entry left), the job commands of
  `modules/jobs/*` and the job libraries run every statement in a transaction that names the laboratory. Only
  where the statements run changed: the status machine, the compare-and-set predicates, `appendJobEvent`, the
  frozen certificate input, the approval, signing and the numbering formats are untouched. Details worth
  knowing:
  - **The commands name the laboratory themselves.** `editJob`, `assignJob`, `rejectJob`, `submitJob` /
    `executeJob` open `orgDb(command.organizationId).transaction(...)` and run the read, the gates, the
    compare-and-set write and its audit row in it (one transaction; the write still matches on the status it
    read, a failing audit insert still rolls the write back). `amendJob` and `cancelJob` use
    `orgTransactionWithExecutor` (the numbering and the cancel runners take a raw executor). Because the
    command knows the laboratory, every entry point (cloud route, public API, desktop sync apply, visit
    remove-job) is scoped without changing its caller. `createCalibrationJob` without a caller transaction opens
    one that names the laboratory.
  - **Approval keeps storage I/O out of every transaction.** `approveJob` reads the gates and the release
    evaluation in one short transaction (`PreparedApproval`), reads the logo and signature objects after it ended
    (`prefetchCertificateImages` was split into `findCertificateImageKeys` + `readCertificateImages`; the
    function itself is unchanged), then writes the status, the frozen input, the audit row and the outbox queue
    row in one `orgTransactionWithExecutor`. The post-commit steps (asset-date advance, OOT event) open their own
    org transactions.
  - **Lib functions take an optional reader.** `loadScopedJob`, the technician and competence gates, the
    standards judgement, the execution snapshots and `reconcileMethodSnapshotEngine` take an optional org-bound
    handle and, absent, read in a short transaction of their own (`withOrgReader`, `lib/org-transaction.ts`).
    The job_standard projection and the visit roll-forward run after the commit (`afterCommitQueue`), as
    before; `flagJobOutOfTolerance` takes an `OrgScope` like the NC creator and the route now opens the NC and
    the notification in one transaction.
  - **Behaviour that is stricter than before.** The label update and its audit row of the worker, the asset-date
    advance and its audit row, and the asset OOT event and its first audit entry are now one transaction each
    (they were separate autocommit statements); `POST /:id/flag-oot` no longer leaves an NC behind when the
    notification insert fails.
  - **The worker.** `packages/jobs-core` learns the laboratory of a certificate or label message with one lookup
    on the system path (`findJobOrganization`, `DATABASE_OWNER_URL`, falling back to `DATABASE_URL`) and runs
    everything else of the job in a transaction that names it (`withOrgDbClient`, `inOrganizationTransaction`:
    `set_config(..., true)` after `BEGIN`). The legacy live read of a pre-0120 job reads its rows in the
    transaction and the images after it. `setJobError` takes the laboratory. The queue backstop of
    `packages/db/src/queue-render-recovery.ts` lists candidates on `systemDb` and rejects each render in
    `forOrg(db, lab).transaction`. The queue claim (`FOR UPDATE SKIP LOCKED`), the stale-lease recovery and
    the other worker handlers are unchanged.
  - **The compare-and-set harness works under both pools.** `changeJobBeforeNextTransaction`
    (`test/integration/job-cas.ts`) no longer waits for "the next transaction that is not an org-bound one": it
    fires the other actor right before the first statement of a transaction that takes the job's row lock (its
    `UPDATE`, or the `FOR UPDATE` an approval and an amendment serialise on), for the plain `db.transaction`, for
    `orgDb(...).transaction`, for a savepoint of a transaction scope, and, under the shadow report, on the
    `calibra_app` pool the request runs on (the other actor runs on the owner: `outsideApplication`). The
    assertions of the specs are unchanged.
  - **Not done here (other slices).** The jobs specs that go through the public API or the desktop sync apply
    still break as `calibra_app` on `middleware/api-key-auth.ts`, `lib/api-key-approver.ts`,
    `lib/public-api.ts` (idempotency), `lib/audit.ts`, `routes/public-api-v2/jobs-decisions.ts` and
    `modules/sync/*`: the integrations / public API and desktop sync slices.
  - Specs: `jobs-lab-scope.int.spec.ts` (success paths the other job specs do not reach, each with a
    cross-laboratory negative, plus the flag-oot atomicity) and `apps/worker`
    `certificate-issuance-lab-scope.int.spec.ts` (the certificate and label worker connected as `calibra_app`).
- **Desktop sync (P2-18i).** `routes/sync/*` and `modules/sync/*` run every statement in a transaction that
  names the laboratory of the pushing or pulling device (the session's active organization, the same value
  `requireOrganization` already put in `memberData`). The protocol, the cursor semantics (xid8 below
  `pg_snapshot_xmin`), the tombstones, the idempotency ledger, the conflict answers and the order of apply are
  untouched: only where the statements run changed. Details worth knowing:
  - **One transaction per pushed event, now named.** `applyDesktopEventAtomically` still opens
    `runInTransactionScope` (the claim, the change, every audit row and the "applied" record commit or roll
    back together; a refused or conflicting event rolls back whole), and its first statement is
    `setTransactionOrganization(db, lab)`. `db` is that very transaction inside the scope, so every helper that
    reaches for it, and every `orgDb(lab).transaction` of a lib or a job command (a savepoint of the event's
    transaction that names the same laboratory), runs as the laboratory. The apply functions receive the
    handle `o` of that transaction (`ApplyDesktopSyncEventInput.o`) and read and write through it, so the
    organization predicate is added to each statement; the small `db.transaction` blocks inside the apply
    (customer, asset, quote, execution) were savepoints of the same transaction and are now plain statements of
    it, with the same all-or-nothing outcome. `claimDesktopSyncEvent` / `completeDesktopSyncClaim` and the audit
    writer take `o`; the job commands (`submitJob`, `executeJob`) and the service-order, NC and finance libs
    join the event's transaction (they open their own `orgDb(lab).transaction`, which is a savepoint there), so
    they are scoped without a second transaction and cannot break the atomicity of the event.
  - **Before the event's transaction.** The pre-phase (`prepareDesktopEventSideEffects`) and the actor check
    (`validateSyncActorScope`) read the audit log and `member` in a short `orgDb(lab).transaction`
    (`withOrgReader`). The client organization of a `create_local_customer` is still created by better-auth
    before the event (its own connection; see "Not done here").
  - **Pull and bootstrap.** The protocol 3 pull page and each bootstrap page, and the deprecated protocol 1 and
    2 pull and bootstrap, run in one `orgDb(lab).transaction` (READ COMMITTED: each statement still takes its
    own snapshot, so the horizon of the pull and the `xmin` of the bootstrap are computed exactly as before; the
    read-only transaction has no id and is never the "oldest in flight"). A cursor is a position in the shared
    transaction order, not a key to a laboratory's rows: a laboratory's device presenting another laboratory's
    cursor gets only its own entries after that position.
  - **Triggers under `calibra_app`.** The change-log triggers run as the writer: a laboratory's write appends
    an entry of its own organization, which the `sync_change_log` policy accepts, so no migration was needed. A
    write that fans out to every laboratory (the global `asset_type` catalog, the seed) is refused for
    `calibra_app` and stays on `systemDb` (above).
  - **System path.** One statement: the "is another laboratory's customer attached to this client organization"
    check of the `create_local_customer` pre-phase (`findOrganizationCreatedForEvent`, `modules/sync/desktop-customer-org.ts`,
    `customer`, one column, read only; the allowlist entry says why). The `organization` slug lookup beside it
    is a global table.
  - **One behaviour change (a closed hole).** An attachment id is the object key in base64 and carried no
    authority: any device could be handed a download URL for any `org/.../sync-attachments/...` key it could
    name. `GET /attachments/:id/download` and `POST /attachments/complete-upload` now answer 400 (as for an
    invalid id) unless the key is under the device's own laboratory partition
    (`syncAttachmentObjectKeyBelongsToOrganization`).
  - **Not done here.** `createClientOrganizationAsServiceOwner` (better-auth's own adapter creates the CLIENT
    organization and its owner `member` row without a laboratory named; the online customer, customer-group and
    public-API customer routes call it the same way): the pre-org identity slice. The job commands defer their
    derived bookkeeping (`job_standard` projection, visit roll-forward, `afterCommitQueue`) to "after the
    commit" of their own transaction, which inside a sync event is a savepoint of the event: it still runs
    before the event commits, exactly as it did before this slice.
  - **The shadow harness now follows the transaction scope.** In shadow mode `db` used to resolve to the
    `calibra_app` pool even inside `runInTransactionScope`, and the scope itself opened on the owner connection,
    so the statements of a pushed event ran outside its transaction and with no organization set (that is what
    the sync rows of the baseline mostly measured). `appRoleDatabase` (`test/integration/app-role-mode.ts`, then `shadowDatabase` of `rls-shadow-mode.ts`) now
    opens a request's scope on the `calibra_app` pool and keeps `db` on the scope's transaction inside it
    (`createTransactionScopeRunner` / `currentTransactionScope` from `@calibra-facil/db/testing`).
  - **Measured** (`rls:shadow-report` over the 11 sync specs plus the four job entry-point specs, with the
    corrected harness): before, 147 of 424 tests broke as `calibra_app` and 125 distinct statements (655 runs)
    reached a tenant table with no organization; after, 0 of 435 break and the one remaining statement is
    better-auth creating the CLIENT organization (`packages/auth/src/auth.ts`, the pre-org identity slice).
  - Specs: `sync-lab-scope.int.spec.ts` (a device of laboratory A cannot push into, execute on or read from
    laboratory B by ids in payloads, by event organization or unit, by local-id mapping, by cursor or by
    attachment id; the ledger is per laboratory; the bootstrap pages never contain laboratory B's rows; the
    change-log triggers under a `calibra_app` connection; an event that fails mid-apply leaves no claim, write,
    audit row or change-log entry).
- **Pre-org identity, platform sweeps, worker handlers, CLI (P2-18j).** The slice that breaks login if the role
  split is wrong: identity runs before an organization is chosen and across a person's memberships. The rule was
  applied per statement: a GLOBAL table (`user`, `session`, `account`, `verification`, `organization`,
  `platform_event_log`, `legal_metrology_regulation`: no policy, `packages/db/src/tenancy.ts`) stays on the plain
  handle (in a lib, never in a route); a TENANT table whose laboratory is known runs in a transaction that names
  it; a tenant table read BEFORE the laboratory is known is one narrow system-path statement with a why-comment
  and an allowlist entry. The raw-`db` baseline of the routes is now EMPTY (11 files, 31 references -> 0).
  - **Better Auth runs on the system path.** `packages/auth` builds the adapter on `getSystemDb()` (the owner
    connection): Better Auth is the identity layer (sign-in, sessions, accounts, and the organization plugin's
    create / list / set-active / invitations / SSO providers), its statements cannot name one organization per
    transaction, and it authorizes by role itself before it touches a row. Everything in `packages/auth` and the
    API that is NOT Better Auth's own statement names the laboratory: `createLabAccountSetupToken` writes in
    `forOrg(laboratory)`, `validateLabAccountSetupToken` looks the token up by its own id on the system path (the
    row names the laboratory) and then reads the membership and the pending invitation in that laboratory (so a
    token of laboratory A that points at laboratory B's invitation finds none: `invitation_invalid`).
    System-path statements of the package, each one row and commented: the sign-in gate by e-mail
    (`hasActiveLabMembership`, `hasPendingLabInvitation`), the session's default laboratory
    (`findDefaultActiveOrganizationId`), the portal magic-link sender (pending invitation, existing client
    membership, the laboratory behind a client organization), the CORS check of a portal custom domain, and
    `deleteUser`, which preserves the regulated records of a person in EVERY laboratory in one transaction (so one
    system-path transaction, bound to that user id, keeps it atomic).
  - **Routes.** `lib/identity.ts` holds what the pre-organization routes need: global-table reads
    (`findUserByEmail`, `findUserImage`, the magic-link verification row, own-session revocation, platform events)
    and two system-path lookups, the public invitation by its id (the bearer secret; its row names the
    laboratory) and the user's own primary organization for the magic-link preview. `lab-setup` runs the whole
    claim (membership, invitation, token, platform event, session's active laboratory) in ONE
    `orgDb(token.organizationId).transaction`; `sso` reads the provider in a short transaction naming the
    laboratory and writes its audit entry in one (the Better Auth calls in between run on their own connection,
    never inside a transaction); `organization-media` commits the new logo and its audit entry together and
    removes the previous object from storage after the commit; `email-domains` verify / activate commit the
    change with its audit entry. `organization-lifecycle` and `lib/records-retention.ts` soft-delete in one
    organization-naming transaction (stamp, key revocations, audit rows), and `removeLabOrganization` hands its
    raw transaction to the evidence probe. `services/lab-provisioning.ts` creates the first membership in the new
    laboratory's transaction; `services/activation-checklist.ts` reads one laboratory in one transaction.
    Public self-serve sign-up keeps its slot ledger in the global `platform_event_log`
    (`lib/public-signup-store.ts`); its one tenant read ("is this person already in a laboratory") is a system-path
    statement.
  - **E-mail domain.** `lib/email-domain-lifecycle.ts` stays ONE transaction that names the laboratory and holds the
    tenant lock across the provider call: that is deliberate (it serialises a concurrent create for the same
    organization and lets a rejected database write be compensated before the lock is released; the specs pin
    both), so it is the one place a transaction spans I/O. The one cross-organization question, "does ANOTHER
    laboratory hold this hostname" (`org_email_domain_hostname_uidx` is platform-wide), is a system-path lookup.
  - **Sweeps.** `purgeSyncChangeLog` lists the laboratories holding entries past the window on the system path (ids
    only) and purges each in its own `orgTransactionWithExecutor` (delete + horizon, explicit `organization_id`
    predicate), one failing laboratory does not stop the others and the run reports it at the end.
    `runCertificateDriftCheck` lists the newest snapshots of every laboratory on the system path and writes each
    finding's audit event in `orgDb(snapshot.organizationId)`. `runRecordsPurge` / `evaluatePurgeCandidates`
    run WHOLE on the system path: erasing a laboratory deletes the organization root and its portal-login CLIENT
    organizations (rows that belong to other organizations, and "does another laboratory's customer still use this
    client organization" looks across laboratories), which no single `calibra.organization_id` can name; the
    erasure of one laboratory stays one transaction. `cleanupExpiredAuthRecords` only touches the global
    `session` / `verification` tables and needs nothing.
  - **Worker (`packages/jobs-core`).** Every raw-`pg` handler that was left on the owner now names the laboratory:
    the compliance sweep (`scheduled/*`: the laboratories are listed once on the system path, then every step runs
    per laboratory, each statement in its own short transaction that names it, with an explicit
    `organization_id` predicate on every `check*` query; the competence auto-expire and its audit row are one
    transaction; no transaction is held across a notification), the audit pack, the service-order documents and
    intake documents, the out-of-tolerance letter (one owner lookup of the laboratory per message, via
    `findOrganizationOnSystemPath`, with the same loud error as the job lookup when `DATABASE_RLS_MODE=enforced`
    has no `DATABASE_OWNER_URL`), the e-mail-domain health cron (list on the system path, then the row update and
    its audit events in one transaction after the Resend call; an audit failure now rolls the update back and the
    next sweep retries it) and the generic-HTTP integration sync (the remote call never runs inside a
    transaction). The worker integration tier now has `calibra_app` specs (`*-lab-scope.int.spec.ts`).
  - **CLI (`apps/api/src/cli`).** Operator tools: they run as the table OWNER by design, now explicit:
    `systemDb` imported as `ownerDb` (the owner URL, or `DATABASE_URL` when the roles are not split). Nothing was
    migrated to `orgDb`.
  - **Specs.** `lib/identity-lab-scope.int.spec.ts` runs the REAL Better Auth lab instance and the real routes with
    `DATABASE_URL` as `calibra_app` and `DATABASE_OWNER_URL` as the owner (`test/integration/application-role.ts`):
    magic-link sign-in, default laboratory, lab switching, the sign-in gate, claiming an invited account, the
    cross-laboratory token negative, provisioning of a laboratory and its first member, `deleteUser`, the
    change-log sweep, auth maintenance, the sign-up store and the checklist. Pointing the adapter back at
    `getDb()` fails lab switching and provisioning. The records-purge and certificate-drift specs gained
    `calibra_app` cases.
  - **Shadow report, 15 identity / lifecycle specs** (the routes above, `records-retention`, `certificate-drift`,
    `user-cascade-soft-delete`, plus `sync-change-seq` and `db-immutability` for the sync work of P2-18i):
    before, 194 tests, 44 broken as `calibra_app`, 53 distinct (162 runs) unscoped statements; after (rebased on
    P2-18i), 197 tests, 0 broken, 0 unscoped (before the rebase the only rows left were the 17 broken / 14 distinct
    of `modules/sync`).
  - **Not covered by the shadow report.** The Better Auth adapter statements run on the system path in every
    harness, so the report cannot show them; the specs above are the evidence.
  - **No RLS backstop for Better Auth (Q40).** Accepted: its guard is its own membership and role check plus the
    app's permission middleware. `identity-org-plugin-deny.int.spec.ts` pins it: an owner of laboratory A, with a
    real session, calls list-members, get-full-organization, list / create / get / accept / cancel invitation,
    update-member-role, remove-member and update-organization against laboratory B (also the paths that find a
    member by its id alone, `findMemberById` having no organization filter, with a second owner in A so the
    organization check and not the only-owner rule refuses) and every call is refused with B unchanged.
    **Start-up guard:** `assertRlsStartup` (API and worker) refuses to start with `DATABASE_RLS_MODE=enforced` and no
    `DATABASE_OWNER_URL`, naming both variables, so no system-path listing silently returns nothing.
  - **One laboratory failing does not hide another's work.** The certificate-drift sweep keeps writing the other
    findings when one audit write fails and then throws `DriftAuditWriteError` (carrying the result); the scheduled
    integration sync does the same (`ScheduledIntegrationSyncError`); the compliance and change-log sweeps already
    continued and report at the end.
- **Tests.** `apps/api/src/lib/rls-policies.int.spec.ts` runs against a pool whose sessions are `calibra_app`
  (`test/integration/rls.ts`). Since P2-18k **the integration tier itself runs as `calibra_app`**:
  `test/integration/app-role-mode.ts` (installed by `setup.ts`) mocks `@calibra-facil/db` and `hono` so that every
  HTTP request a spec sends (`app.request(...)`) takes its database access, and its transaction scope, on a pool
  whose sessions are `calibra_app`; the specs' own seeding and assertions, and `systemDb`, stay on the owner
  (`DATABASE_OWNER_URL` is set to the owner, `DATABASE_RLS_MODE` is left at its default). A statement that forgets
  its organization matches no row and a write for another laboratory is refused by `WITH CHECK`, so the spec that
  ran it fails in the normal CI job. The tenant SQL guard keeps watching those statements (the pool forwards them
  to its observer). `app-role-harness.int.spec.ts` pins the routing itself (`current_user` is `calibra_app` in a
  request, the owner in the spec and in `systemDb`; an unscoped statement of a request sees nothing).
  `CALIBRA_API_DB_ROLE=owner pnpm --dir apps/api test:integration <file>` runs the requests as the owner, to tell an
  RLS refusal from a bug. The worker tier (`apps/worker/test/integration/env.ts`, `makeTestEnv`) builds every
  handler's env as `calibra_app` plus `DATABASE_OWNER_URL` and `DATABASE_RLS_MODE=enforced`
  (`CALIBRA_WORKER_DB_ROLE=owner` to debug), while the specs seed and assert on the owner. The role exists in the
  test Postgres from `sql/schema-extras.sql`; no URL or secret is passed in CI.
- **Shadow report (diagnosis).** `pnpm --filter @calibra-facil/api rls:shadow-report` replays every API
  integration spec (`--group routes/jobs` or `--files` narrow it) three times (the requests as the owner, as
  `calibra_app` under probing policies, and the same letting unscoped statements through) and prints what breaks,
  by spec file, and every statement that reached a tenant table without an organization, grouped by the
  application module that issued it. The normal integration run supersedes it as the regression gate; it stays
  for the question "which statements does this change leave unscoped?", which a failing spec only answers one
  at a time. See "Final report" below.
- **Start-up check.** `DATABASE_RLS_MODE` (`enforced` by default) makes the API and the worker run the catalog
  query at start-up (`packages/db/src/rls-startup.ts`): `enforced` refuses an application connection that RLS
  does not bind, a missing `DATABASE_OWNER_URL` and an owner URL that RLS binds; `shadow` refuses a role the
  policies bind (not the table owner, superuser or BYPASSRLS). Migration 0123 applies the same test to the role
  that runs it.

### Final report (P2-18k)

`docs/architecture/rls-shadow-baseline.json` is the output of
`pnpm --filter @calibra-facil/api rls:shadow-report --json <file>` on `origin/main` at `f33aed08` (every slice
P2-18a to P2-18j merged), the number the cutover was measured against. The first baseline (P2-18b, `c59be795`, before
any slice) had **999 of 1552 tests breaking as `calibra_app`** and 2319 distinct (spec, statement) pairs reaching a
tenant table with no organization set (12428 executions); each slice's own section above records what it cleared.

|                                          | before the slices (P2-18b) | final (P2-18k) |
| ---------------------------------------- | -------------------------: | -------------: |
| API integration specs                    |                        116 |            141 |
| Tests                                    |                       1552 |           1740 |
| Failing as the owner                     |                          0 |              0 |
| **Breaking as `calibra_app` (strict)**   |                        999 |          **0** |
| **Distinct unscoped statements (audit)** |                       2319 |          **0** |
| Executions of an unscoped statement      |                      12428 |              0 |

Nothing is left over: no statement reaches a tenant table without an organization, and none of the 1740 tests
breaks under the policies. The normal integration run (above, "Tests") now enforces that on every CI run, so the report
is a diagnosis tool, not a gate: after a change that adds statements, `rls:shadow-report --group <prefix>` lists every
unscoped statement at once (strict mode stops a request at its first), and a slice is clean when the module
disappears from `byModule` and `testsBroken` is 0. The JSON carries counts per spec, module and layer (no statement text);
`--json-full` adds the rows and statements and `--from-full` re-slices such a file without running vitest.

- **Scope.** Every `apps/api/src/**/*.int.spec.ts` except the harness self-tests (the tenant SQL guard's, and
  `app-role-harness.int.spec.ts`, which issues an unscoped statement on purpose). The three passes run the requests
  as the owner (`CALIBRA_API_DB_ROLE=owner`), as `calibra_app` with the probing policies (`CALIBRA_RLS_REPORT=1`),
  and the same letting unscoped statements through (`CALIBRA_RLS_REPORT_MODE=audit`).
- **Run time.** 6238 s (about 104 minutes) end to end with `--maxWorkers=2` on a 16-core machine that was running other
  jobs; a single spec costs about 2 minutes of container and schema start-up per pass, so use `--group` for a slice.
- **Attribution.** The harness records, per unscoped statement, the application module that obtained the
  database handle (innermost stack frame outside drizzle, `packages/db`, `lib/org-db.ts` and the harness) and
  the request path. The request path is not usable as a group: route specs mount a router at `/`. A module is
  credited a broken test when that test ran one of its unscoped statements; a test that breaks otherwise (a
  WITH CHECK refusal) shows only in its spec. Identical statement text issued concurrently in one process (a
  `Promise.all` race) may be attributed to the latest issuer.
- **Not covered by the report.** `apps/worker`'s integration tier (its handlers are called directly, not through
  `app.request(...)`): it is covered by the tier itself, which builds every handler's env as `calibra_app`
  (126 tests in 22 files pass that way). Work started outside `request()` in an API spec stays on the owner, and a
  statement on an empty table does not evaluate the policy.
