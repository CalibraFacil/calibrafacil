# Row-level security (migration 0123) and the role split

Runbook moved out of [`DEPLOYMENT.md`](../../DEPLOYMENT.md#runbooks) (roadmap 2 G5).

Postgres enforces tenant isolation itself, as a second wall behind the `organization_id` predicate the
application writes (decision Q15). Migration `0123_rls_shadow_mode` (the name is historical) prepares it, and
since the cutover (P2-18k) **enforcement is the normal setup**:

- the migration creates the role `calibra_app` (`NOLOGIN`) with `CONNECT` on the database, `USAGE` on schema
  `public`, `SELECT/INSERT/UPDATE/DELETE` on every table and `USAGE` on every sequence, and the same default
  privileges for tables the migration owner creates later. `CREATE ROLE` needs the `CREATEROLE` attribute,
  which the owner of a self-hosted Postgres, Neon, RDS and Supabase has; where it is missing the migration
  stops with the fix and never skips the role (see "Hosts without `CREATEROLE`");
- it runs `ENABLE ROW LEVEL SECURITY` on every tenant table (each table of `packages/db/src/tenancy.ts` that
  carries `organization_id` / `lab_organization_id`) and adds the policy `tenant_isolation FOR ALL TO calibra_app`
  with `USING` and `WITH CHECK`
  `<org column> = NULLIF(current_setting('calibra.organization_id', true), '')::text`. Global tables
  (identity, queues, global catalogs) get no RLS;
- the application names the laboratory of every org-scoped transaction
  (`select set_config('calibra.organization_id', <org>, true)` at its start, `packages/db/src/for-org.ts`), so
  a `calibra_app` session sees and writes that laboratory's rows only. A statement that names none sees nothing
  (fail closed), a write for another laboratory is refused.

**The two connections.** The API, the worker and the CLI use two Postgres logins:

| Variable                                 | Role                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                           | `calibra_app`: the application. The policies bind it.                                                                                                    |
| `DATABASE_OWNER_URL`                     | the table owner: the **system path** (below), and the connection `db:bootstrap` / `db:migrate` / `init` use to change the schema. It is exempt from RLS. |
| `DATABASE_RLS_MODE` (default `enforced`) | `enforced`: the application must be a role RLS binds. `shadow`: diagnosis only, the application connects as the owner.                                   |

- **Docker Compose does all of it.** `deploy/compose.yaml` sets both URLs; `init` runs `db:bootstrap` as the
  owner, which creates the `calibra_app` login with the password `CALIBRA_APP_PASSWORD` of `deploy/.env`
  (`./setup.sh` generates it) on every start, so rotating the password is editing `.env` and
  `docker compose up -d`.
- **Your own Postgres.** Run `db:bootstrap` (or `init`) once as the owner with both URLs set,
  `DATABASE_URL=postgres://calibra_app:<password>@host/db` and `DATABASE_OWNER_URL=<the owner's URL>`: it applies the
  migrations (migration 0123 creates the role `calibra_app`) and then, because the application URL names
  `calibra_app`, gives that role `LOGIN` and the password of the URL, on every run (a password change is an edit and a
  rerun). Nothing else about the role is touched, so it works for a non-superuser owner with `CREATEROLE` (Neon, RDS,
  Supabase). By hand, once the role exists (the migration created it), as the owner or an admin role:

  ```sql
  ALTER ROLE calibra_app LOGIN PASSWORD '<strong password>';
  ```

  (`CREATE ROLE`'s defaults are the right ones: not a superuser, no `BYPASSRLS`, no `CREATEDB`, no `CREATEROLE`; start-up
  refuses an application role that has any of the first two.) A separate login that is a member of the role works as
  well: `CREATE ROLE calibra_api LOGIN PASSWORD '...' IN ROLE calibra_app;` (keep `INHERIT`, the default).

- **Development.** `pnpm setup:dev` does the same against the compose Postgres: `apps/api/.env` and
  `apps/worker/.env` carry `DATABASE_URL=postgres://calibra_app:calibra_app@localhost:55432/calibra` and
  `DATABASE_OWNER_URL=postgres://calibra:calibra@localhost:55432/calibra`; `packages/db/.env` stays the owner
  (drizzle-kit, the seeds). An `.env` from before the cutover is rewritten that way by `pnpm setup:dev`.

**Start-up refuses a connection that would hide data or skip the wall.** The API and the worker run one catalog
query (two with `enforced`) before they serve, and stop with a message naming the variable:

- `enforced` and `DATABASE_OWNER_URL` unset: refused (Q40), because the system path would run as the
  application role and silently see nothing;
- `enforced` and `DATABASE_URL` is the table owner, a superuser or a `BYPASSRLS` role, owns even ONE tenant
  table, or is a member of such an owner (with or without `INHERIT`: it could `SET ROLE` to it): refused (RLS would
  not apply to the application, at least on some table; nobody would notice). To run as the owner knowingly, set
  `DATABASE_RLS_MODE=shadow`, which logs a loud warning when `NODE_ENV=production`;
- `enforced` and `DATABASE_OWNER_URL` is a role RLS binds: refused (the system path would match no row);
- `shadow` and `DATABASE_URL` is a role RLS binds: refused (statements without an organization would
  silently match no row);
- before migration 0123, when no table has RLS enabled yet, the role checks pass.

The migration itself stops (`calibra: migration 0123 is run as <role>, which is neither the owner ...`) before
changing anything when run by a role RLS would bind, so run migrations as the owner.

**Upgrading an existing installation.** Before this release the API and worker connected as the table owner
with `DATABASE_RLS_MODE` unset (`shadow`). The default is now `enforced`, so an upgrade that changes nothing
fails at start-up with the messages above, on purpose. Do, once:

1. Docker Compose: add `CALIBRA_APP_PASSWORD=<random>` to `deploy/.env` (for example
   `echo "CALIBRA_APP_PASSWORD=$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')" >> .env`), then
   `docker compose pull && docker compose up -d`: `init` creates the login and the new compose file wires the
   URLs. Nothing else changes.
2. Your own Postgres and processes, in this order (the role does not exist before migration 0123, so the login
   cannot be created first): (a) with the OLD application still running, run `init` / `db:bootstrap` as the owner
   with `DATABASE_OWNER_URL=<what DATABASE_URL is today>` and
   `DATABASE_URL=postgres://calibra_app:<new password>@host/db`: it migrates, which creates `calibra_app`, and gives it
   the login; (b) then switch the API and the worker to `DATABASE_URL=postgres://calibra_app:<password>@host/db` and
   `DATABASE_OWNER_URL=<the old URL>`, leave `DATABASE_RLS_MODE` unset (or `enforced`), run `pnpm config:check`, and
   restart.
3. To go back, set `DATABASE_RLS_MODE=shadow` and `DATABASE_URL` to the owner (the policies stay, the owner
   bypasses them); nothing else changes.

**Verify** as `calibra_app`: `select count(*) from calibration_job;` returns `0`; inside
`begin; select set_config('calibra.organization_id', '<org id>', true); select count(*) from calibration_job; commit;`
it returns that laboratory's jobs only.

**Hosts without `CREATEROLE`.** If the migration owner cannot create roles, the migration stops with
`the role calibra_app does not exist and <role> may not create it`. An administrator (a role with
`CREATEROLE`, or a superuser) runs this once, and the migration is run again; it skips creation when the role
exists:

```sql
CREATE ROLE calibra_app NOLOGIN;
```

**Locks and retry.** The migration starts with `SET LOCAL lock_timeout = '5s'` and `ALTER TABLE ... ENABLE ROW
LEVEL SECURITY` takes a short exclusive lock on each tenant table. If a long query holds one, the migration
fails fast with `canceling statement due to lock timeout` (SQLSTATE `55P03`) instead of queueing every request
behind it. It runs in one transaction and is idempotent, so a failed attempt changes nothing: wait for the
query to finish, or pick a quiet moment, and run `db:migrate` again. `db:migrate` connects as the owner
(`DATABASE_OWNER_URL` when set, else `DATABASE_URL`, see `packages/db/drizzle.config.ts`), never as `calibra_app`.

**Why the tables are not `FORCE`d.** A table owner is exempt from RLS unless the table is `FORCE`d. Forcing
would also bind the owner, and the owner legitimately runs statements that no single organization can name:
Better Auth (sessions, the organization plugin), the lookups that learn a laboratory, the cross-laboratory
sweeps, the global `asset_type` write fan-out, the migrations and the CLI. The policies are addressed to
`calibra_app` only, so under `FORCE` the owner would match no policy and see nothing; giving it a second,
all-allowing policy would add nothing. The protection against an accidental owner connection is the start-up
check above (the application refuses to run as a role RLS does not bind), not `FORCE`.

- **The system path (`DATABASE_OWNER_URL`).** A few statements are cross-laboratory on purpose and cannot name
  one organization first: the lookup that learns which laboratory a request belongs to (the portal's host
  name, the portal customer scope, a public certificate token), reads over a bounded set of laboratories
  (a portal customer user of several), notification fan-out, the identity layer (Better Auth's own statements, the
  sign-in gate by e-mail, a person's memberships at sign-in, an invitation by its id, a setup token by its id:
  all before an organization is chosen), the cross-laboratory sweeps (records purge, change-log and
  certificate-drift lists) and writes to the global `asset_type` catalog
  (its change-log trigger writes to every laboratory's log, which `calibra_app` may not do; only the seed writes it).
  The operator CLI (`apps/api/src/cli`) runs as the owner on the same path. They use the named
  `systemDb` of `@calibra-facil/db`, which connects with `DATABASE_OWNER_URL`. Better Auth (sessions, the
  organization plugin) runs on this owner connection too, guarded by its own membership and role checks
  (pinned by `identity-org-plugin-deny.int.spec.ts`), not by RLS. Every use is a reviewed entry
  of `apps/api/test/integration/tenant-sql-allowlist.ts`, and routes may not import it.
- **The worker.** It connects like the API (`calibra_app` plus `DATABASE_OWNER_URL`). A queue message names a
  job, not its laboratory: the worker learns the laboratory with one lookup on the system path, and every
  other statement of the job (the frozen input or the legacy live read, the signing certificate, the issuance
  transaction, the audit rows, the failure rejection) runs in a transaction that names it
  (`set_config(..., true)`). The other handlers do the same: the scheduled compliance sweep, the audit packs,
  the service-order and out-of-tolerance documents, the sender-domain health cron and the generic-HTTP
  integration sync list or look up the laboratory on the system path and then work per laboratory. The queue
  claim, the stale-lease recovery and the stuck-render sweep list across laboratories and stay on the owner
  (`systemDb`); the queue table itself has no RLS.
- **Pooler mode.** Transaction pooling (PgBouncer `pool_mode = transaction`, Neon's pooled endpoint,
  Supavisor) is fine: `set_config(..., true)` is transaction-local, so the organization lives and dies with
  the transaction and never reaches the next client on the same server connection. A statement outside
  a transaction sets nothing and sees nothing as `calibra_app`; that is deliberate (fail closed).
  Session pooling is fine too. Do not set `calibra.organization_id` with a plain `SET` or in a role or
  connection default.
- **Rollback.** `DATABASE_RLS_MODE=shadow` plus `DATABASE_URL` pointing at the owner, then restart. Nothing else
  changes: the policies stay in place and the owner bypasses them. To remove the login for good:
  `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM calibra_app; ALTER ROLE calibra_app NOLOGIN;` (the policies
  and the role can stay).
- **Diagnosis.** `pnpm --filter @calibra-facil/api rls:shadow-report` (it needs Docker, like the integration
  tier) replays every API integration spec with the requests' database access as `calibra_app` and lists, by
  spec file, what breaks and every statement that reached a tenant table with no organization set. The
  integration tier itself runs the requests as `calibra_app` (see `docs/architecture/org-bound-db.md`).
- **New tenant tables.** A migration that adds a table with an organization column must also carry the
  regenerated block (`pnpm --filter @calibra-facil/db gen:rls-sql`) in a new migration and in
  `sql/schema-extras.sql`; `packages/db/src/rls-sql.test.ts` fails until it does, so a table never reaches
  `calibra_app` without its policy.
