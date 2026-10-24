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
the same change that migrates a handler (delete the entry at zero). The baseline is EMPTY since P2-18j:
every route is migrated, so a route that needs a statement outside an organization calls a named lib
function (`lib/identity.ts`, `lib/public-signup-store.ts`, ...), never the raw handle.

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
    the sync rows of the baseline mostly measured). `shadowDatabase` (`test/integration/rls-shadow-mode.ts`) now
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
- **Tests.** `apps/api/src/lib/rls-shadow.int.spec.ts` runs against a pool whose sessions are `calibra_app`
  (`test/integration/rls.ts`). `pnpm --filter @calibra-facil/api rls:shadow-report` replays every API
  integration spec (`--group routes/jobs` or `--files` narrow it) with each request's database access as
  `calibra_app` (owner baseline, strict, audit) and prints what breaks, by spec file, and every statement that
  reached a tenant table without an organization, grouped by the application module that issued it. See
  "Baseline" below.
- **Start-up check.** `DATABASE_RLS_MODE` (`shadow` by default) makes the API and the worker run one catalog
  query at start-up (`packages/db/src/rls-startup.ts`) and refuse to start as a role the policies bind (not the
  table owner, superuser or BYPASSRLS). The role split sets `enforced` for the API. Migration 0123 applies
  the same test to the role that runs it.

### Baseline (P2-18b)

`docs/architecture/rls-shadow-baseline.json` is the output of
`pnpm --filter @calibra-facil/api rls:shadow-report --json <file>` on `origin/main` at `c59be795`, before any
of the cutover slices (P2-18a, #110, merged after it and already clears the portal routes, `requireOrganization` in
`middleware/permission.ts` and most of `lib/units.ts`, so those rows overstate what is left): the numbers each slice (master data, quality records, NC/CAPA, jobs, service orders and
finance, integrations / public API / notifications, desktop sync, pre-org identity) is measured against. After a
slice, re-run with `--group` for its specs (or the full report) and diff the `byModule` / `byLayer` / `bySpec`
counts: a migrated module disappears from `byModule`, a slice is done when its modules are gone and `testsBroken`
for its specs is 0. `--from-full` re-slices a `--json-full` output without running vitest.

- **Scope.** 116 integration specs (`apps/api/src/**/*.int.spec.ts`, minus the tenant SQL guard's own
  self-test), 1552 tests, 0 failing as the owner, **999 break as `calibra_app`** (strict). The audit pass found
  2319 distinct (spec, statement) pairs reaching a tenant table with no organization set, 12428 executions.
- **Run time.** About 125 minutes end to end with `--maxWorkers=2`: baseline 35 min, strict 40 min, audit 50 min
  (measured while another job loaded the same 16-core machine; expect less on an idle one). A single spec costs
  about 2 minutes, almost all of it per-pass container and schema start-up, so use `--group` while migrating.
- **Attribution.** The harness records, per unscoped statement, the application module that obtained the
  database handle (innermost stack frame outside drizzle, `packages/db`, `lib/org-db.ts` and the harness) and
  the request path. The request path is not usable as a group: route specs mount a router at `/`. A module is
  credited a broken test when that test ran one of its unscoped statements; a test that breaks otherwise (a
  WITH CHECK refusal) shows only in its spec. Identical statement text issued concurrently in one process (a
  `Promise.all` race) may be attributed to the latest issuer.
- **Not covered.** `apps/worker`'s integration tier: it runs serially against one shared database with no
  per-worker clone, its handlers (queue, cron, scheduled) are called directly instead of through
  `app.request(...)`, and the harness only routes a request's async context to the `calibra_app` pool, so those
  specs would stay on the owner connection and report nothing. It needs its own entry point in the worker's test
  setup, with the worker cutover. Work started outside `request()` in an API spec has the same limit, and a
  statement on an empty table does not evaluate the policy.

By layer (distinct SQL texts per group, executions, tests broken):

| layer                    | distinct statements | runs | tests broken |
| ------------------------ | ------------------: | ---: | -----------: |
| `routes`                 |                 394 | 2031 |          538 |
| `lib`                    |                  99 | 4833 |          922 |
| `modules/service-orders` |                  56 |  395 |           65 |
| `modules/sync`           |                  51 |  702 |          151 |
| `modules/jobs`           |                  45 | 2489 |          393 |
| `packages/notifications` |                   7 |   37 |           16 |
| `modules/integrations`   |                   5 |   26 |            7 |
| `packages/auth`          |                   5 |   16 |            9 |
| `middleware`             |                   3 | 1897 |          962 |
| `(unattributed)`         |                   1 |    2 |            1 |

The 25 modules with the most distinct statements (all 116 are in the JSON, `byModule`). `lib/units.ts` and
`middleware/permission.ts` run on almost every request, so one fix there clears most of the `tests broken`
column:

| application module                                              | distinct statements | runs | tests broken |
| --------------------------------------------------------------- | ------------------: | ---: | -----------: |
| `apps/api/src/routes/portal.ts`                                 |                  52 |  271 |           45 |
| `apps/api/src/routes/calibration-requests.ts`                   |                  26 |   87 |            6 |
| `apps/api/src/routes/dashboard.ts`                              |                  25 |  114 |            8 |
| `apps/api/src/routes/jobs.ts`                                   |                  24 |  362 |          206 |
| `apps/api/src/routes/visits.ts`                                 |                  19 |   85 |           29 |
| `apps/api/src/routes/methods.ts`                                |                  17 |   66 |           16 |
| `apps/api/src/modules/jobs/approve-job.ts`                      |                  15 |  537 |           50 |
| `apps/api/src/modules/service-orders/service-order.quotes.ts`   |                  15 |   87 |           11 |
| `apps/api/src/routes/standards.ts`                              |                  15 |   47 |           10 |
| `apps/api/src/routes/assets.ts`                                 |                  13 |  103 |           16 |
| `apps/api/src/lib/certificate-release.ts`                       |                  13 |   61 |            3 |
| `apps/api/src/routes/spc.ts`                                    |                  12 |  196 |            5 |
| `apps/api/src/modules/service-orders/service-order.commands.ts` |                  12 |   47 |           16 |
| `apps/api/src/routes/proficiency-tests.ts`                      |                  12 |   39 |            6 |
| `apps/api/src/routes/reports.ts`                                |                  12 |   32 |            6 |
| `apps/api/src/modules/sync/apply-service-order-documents.ts`    |                  12 |   30 |            6 |
| `apps/api/src/routes/competences.ts`                            |                  12 |   22 |            7 |
| `apps/api/src/lib/jobs.ts`                                      |                  12 |   14 |            1 |
| `apps/api/src/lib/service-order-workflow.ts`                    |                  11 |  113 |           29 |
| `apps/api/src/modules/service-orders/service-order.tokens.ts`   |                  11 |   74 |           14 |
| `apps/api/src/routes/units.ts`                                  |                  11 |   25 |            9 |
| `apps/api/src/lib/units.ts`                                     |                   9 | 3672 |          732 |
| `apps/api/src/routes/customers.ts`                              |                   9 |   35 |            9 |
| `apps/api/src/routes/capa.ts`                                   |                   9 |   32 |            6 |
| `apps/api/src/routes/non-conformances.ts`                       |                   9 |   31 |            5 |
