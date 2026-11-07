# API code is organised by domain

`apps/api/src` holds one folder per business domain under `domains/`, and keeps only
cross-domain infrastructure outside it.

```
apps/api/src/
  domains/<domain>/   routes/ (mounted handlers; routes/index.ts is the mount entry), commands, queries,
                      background work, cron tasks, notifications, access helpers and their specs;
                      index.ts is the library entry
  lib/                platform: org-db / org-context / org-transaction, audit, background-jobs and the
                      outbox, endpoint-mount, errors (domain-errors, db-errors, api-error-json),
                      storage, logger, observability, runtime-env, client-ip, route ids,
                      sequential-number, tenant-refs, identity, units, api-keys, cron scheduler
  middleware/         permission, request-actor, api-key-auth, fresh-session
  server/             Hono wiring (mounts every domain's routers), CORS, rate limit, error handling
  cron/               the schedule table, the runner and the dispatcher (the tasks live in domains)
  cli/                operator commands
```

## Rules (enforced by `calibra/no-api-domain-boundary-violations`, empty baseline)

- `lib/` and `middleware/` never import `domains/*`.
- Another domain, `server/`, `cron/`, `cli/` and `app.ts` reach a domain only through its library
  entry, `domains/<d>/index.ts`. A name another module needs is added to that `index.ts`
  (`export { name } from "./path"`); a deep import into another domain's folder is a lint error.
- `server/route-mounts.ts` mounts a domain's routers through its mount entry,
  `domains/<d>/routes/index.ts`. The library entry carries no routers, so one domain's code reaching
  another never loads the other's route handlers (and a spec that mocks `middleware/permission` for
  one router is not broken by an unrelated domain's router being pulled in).
- A domain imports its own files with relative paths and never imports its own `index.ts`.
- Specs are exempt (a spec may reach any module; `vi.mock` needs the real module id) and live next
  to the file they test. Cross-cutting specs live in `lib/` (database level) or `server/` (request
  level).
- Domains form a DAG (`pnpm check:cycles` enforces no import cycles). See the map below.

## Domains

The folders are
`assets`, `catalog`, `customers`, `finance` (billing, receivables, certificate release and the ERP /
Conta Azul integration under `finance/integrations/`), `jobs` (calibration jobs and their commands
under `commands/`, certificates under `certificates/`, out-of-tolerance handling under `oot/`),
`methods`, `notifications`, `org` (organization, units, sessions, api keys, sso, signing credentials,
email and portal domains, invitations, signup, lab setup), `portal`, `public-api` (v1, v2, webhooks,
OpenAPI), `quality` (NC/CAPA, SPC, proficiency, competences, training, signatories, accredited scope),
`reports` (dashboard and reports), `service-orders`, `standards`, `sync` (desktop sync protocol),
`verify` (public certificate verification) and `visits` (visits and calibration requests).
