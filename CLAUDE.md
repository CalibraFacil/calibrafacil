# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Calibra Fácil is an ISO/IEC 17025 calibration-laboratory management system: calibration
workflows, GUM uncertainty calculations, PDF certificate generation, and a client portal.
A detailed contributor guide also exists at `AGENTS.md` — read it for coding style, commit
conventions, and the full architecture-rule list. This file focuses on commands and the
big-picture architecture.

## Commands

Turborepo + pnpm monorepo. Run these from the repo root unless noted.

```bash
pnpm setup:dev        # one-time: env files, Docker services, migrations, demo seed
pnpm dev              # api :3000, lab app :5173, portal :5174
pnpm dev:isolated     # web+api+portal on this worktree's own port slot (parallel-safe)
pnpm dev:all          # every app with a dev script (incl. email, worker, docs, site, desktop)
pnpm dev:desktop      # web + Electron desktop shell
pnpm services:up      # start the Docker services (Postgres, S3, Mailpit, Gotenberg)
pnpm build            # build all apps/packages
pnpm lint             # oxlint across the monorepo (incl. the no-useEffect rule)
pnpm format           # Prettier on **/*.{ts,tsx,md}
pnpm check-types      # type-check all packages
```

Local development needs no cloud account: `docker-compose.yml` runs Postgres, an
S3-compatible store, Mailpit (every email, magic links included, lands at
http://localhost:8025 through a local Resend-compatible relay) and Gotenberg. The seed
creates a demo lab; sign in as `admin@laboratorio.test` (passwordless).

Single app / package:

```bash
pnpm turbo dev --filter=@calibra-facil/api      # one app in dev
pnpm --dir apps/web check                        # prettier --write + oxlint --fix
pnpm --filter @calibra-facil/contracts check-types
```

Tests use **Vitest**. There is no root `test` script — run per package:

```bash
pnpm turbo test                                  # all tests
pnpm --dir apps/api test:run                     # one package, no watch
pnpm --dir apps/api test:run path/to/file.test.ts -t "name"   # one test
pnpm --dir apps/web test:e2e                     # Playwright (web e2e under apps/web/e2e)
```

Database (Drizzle, in `packages/db`):

```bash
cd packages/db
pnpm db:bootstrap     # new DB: push schema + sql/schema-extras.sql; existing DB: migrate
pnpm db:migrate       # apply pending migrations
pnpm db:studio        # Drizzle Studio on :4000
```

`drizzle-kit generate` does not produce usable migrations past the early snapshots:
write new migrations by hand (`packages/db/drizzle/NNNN_name.sql`) and append the entry
to `drizzle/meta/_journal.json`. New databases are built from `src/schema.ts` (the historical
chain is not replayable from scratch), so a migration that adds something schema.ts cannot
express — an extension, function, partial/expression index or CHECK constraint — must also be
added to `packages/db/sql/schema-extras.sql`.

## Tooling notes (non-obvious)

- **Linter is oxlint, not ESLint.** Config in `.oxlintrc.json`. `correctness` is an error.
  Architectural boundaries are lint rules too: the custom `calibra/*` plugin
  (`packages/oxlint-plugin-calibra`) blocks `@calibra-facil/api` imports in frontends,
  `hono/client` outside `client-runtime`, and router coupling inside `apps/web/src/features`.
- **`as` type assertions are banned** (`consistent-type-assertions: never`). Use type guards,
  `satisfies`, or schema parsing instead.
- **`check-types` runs the native Go compiler** — `tsc` from `typescript@7` (TypeScript 7.0, the
  10x native port; GA'd, replaced the old `@typescript/native-preview`/`tsgo` beta). Exception:
  the Next.js app (`apps/docs`) stays pinned to `typescript@6.0.3` — the classic
  JS build — because its tooling (`next typegen`) imports the TypeScript compiler _API_, which
  the native `typescript@7` package does not ship (it exposes only the `tsc` binary plus an
  `unstable/*` API). The API `dev`/`start` and worker run under
  **Bun**; the web/portal/local-server run under Node + Vite/tsx.
- `pnpm.overrides` and `scripts/check-blocked-deps.mjs` pin/forbid specific dependency versions
  after supply-chain incidents (TanStack, axios). Don't loosen these; `check-blocked-deps`
  fails the build if a blocked version reappears in the lockfile.

## Architecture: cloud + desktop/offline

The same React frontend (`apps/web`) runs in two modes, and most of the architecture exists to
keep these in parity:

- **Cloud:** `apps/api` (Hono) → PostgreSQL + S3-compatible object storage (Cloudflare R2 in
  the original deployment), Gotenberg for PDFs and Resend for email. Background work (PDF
  generation, compliance checks, syncs) runs in `apps/worker`: in-process in development, via
  Vercel Queue + Cron or the always-on worker in production. On Vercel the API entrypoints are
  the generated functions in `apps/api/api/` (`[...route].js`, `cron/`, `queues/`); elsewhere
  `apps/api/src/bun.ts` serves the same app plus the `/api/cron/*` handlers. The Hono app itself
  is wired in `apps/api/src/app.ts` with route handlers in `apps/api/src/routes/`. Deployment
  URLs, CORS and auth origins all come from environment variables (see `DEPLOYMENT.md`).
- **Desktop/offline:** `apps/desktop` (Electron) embeds the web UI and talks to `apps/local-server`,
  a local Hono server backed by SQLite via `packages/local-db`. `packages/local-db` keeps an
  **outbox** and conflict records; `apps/local-server/src/sync.ts` (with the API's
  `/api/sync` routes) reconciles local changes with the cloud when
  online. `apps/web/src/runtime/` holds the client-side cloud-vs-desktop logic (cloud-only route
  blocking, desktop auth, sync-conflict UI).

When changing behavior, preserve both modes. Routes that require the cloud must be marked so they
are blocked in desktop/offline mode (see `apps/web/src/runtime/cloud-only-routes.ts` and
`apps/web/src/app/router/route-meta.ts`).

## Architecture: the API/client contract boundary (enforced)

This is the most important rule in the repo. Frontend packages must not pull server runtime into
their type graph. See `docs/architecture/api-client-contract.md`.

- **Frontend code (`apps/web`, `apps/portal`) must never import `@calibra-facil/api` or `apps/api/*`.**
  Call product-level methods on the client from `@calibra-facil/client-runtime`
  (e.g. `calibraApi.jobs.approve(...)`), not raw Hono RPC paths.
- `packages/contracts` owns the stable client-facing DTOs and the Hono `AppType`
  (`packages/contracts/src/api-app.ts`). It must **not** import `apps/api/*`, and `AppType` must
  never be `any`. When a browser-facing raw Hono route is added/removed/renamed, update the route
  list in `api-app.ts` in the same change.
- Raw Hono RPC usage and transport helpers (`readJson`, `ensureOk`, form-data) stay inside
  `packages/client-runtime` (`src/modules/*` for domains, `src/transport/*` for shared helpers,
  including the cloud vs. desktop transport switch).

## Architecture: web frontend (feature-first, enforced)

See `docs/architecture/web-frontend-architecture.md`.

- **`apps/web/src/routes/`** holds thin TanStack route adapters only: `createFileRoute`, loaders,
  `head` metadata, search validation, and small param/search → props wrappers. No product UI,
  table columns, mutation workflows, or form schemas.
- **`apps/web/src/features/<domain>/`** holds the implementation (`*-page.tsx`, `queries.ts`,
  `forms.ts`, `types.ts`, `components/`, tests). Feature modules must **not** call
  `createFileRoute`, `Route.use*`, `useParams`, or `useSearch` — params/search are passed in as
  props from the route adapter.
- Do not add new route-local `-components`, `-index.data.ts`, or `-index.db.ts` files under
  dashboard routes; add a feature module instead.
- Every renderable dashboard page route must define `head` title metadata
  (`apps/web/src/app/router/dashboard-route-heads.test.ts` enforces this).
- Regulated workflows (NC/CAPA, calibration, certificates, billing) are schema-first: validate
  payloads with `@calibra-facil/schemas` and keep parsing in testable `forms.ts` functions, not in
  JSX handlers.

## Architecture: portal frontend (client portal)

See `docs/architecture/portal-frontend.md`. `apps/portal` is the cloud-only client portal.

- **Reuse the `instrument-panel` design system** (ported into
  `apps/portal/src/components/instrument-panel.tsx`) — `Panel`/`PanelHeader`/`SignalTile`/
  `BlueprintGrid`/`StaggerGroup` + the `SignalTone` vocabulary (ok/critical/warning/info/neutral) +
  Geist Mono numerics. Not plain shadcn `Card`/`Badge`.
- **Transport is its own narrow surface:** raw `fetch` to `/api/portal/*` with
  `credentials: "include"`, wrapped in TanStack Query — the portal does not use
  `@calibra-facil/client-runtime` and (like all frontend) must never import `@calibra-facil/api`.
- Partially feature-first: extract pages into `apps/portal/src/features/<domain>/` as they grow
  (`dashboard`, `service-orders` already are). Status maps through `lib/calibration-status.ts` +
  `lib/status-labels.ts`. Customer-facing ids should be opaque (service orders route by `public_id`).
- Page roots use the `.portal-shell` / `.portal-shell-sm` shells; copy is pt-BR. Same `useEffect`/
  `as`-assertion bans apply.

## Other guards to be aware of

- **`useEffect` is banned.** The oxlint `no-restricted-imports` rule (in `.oxlintrc.json`, part of
  `pnpm lint`) fails on any `useEffect` import from `react`. Use derived state, event handlers, data
  hooks, keyed remounts, or the `use-mount-effect.ts` wrapper. Only the `apps/*/src/hooks/use-mount-effect.ts`
  wrappers may import raw `useEffect` (allowed via an `overrides` entry in `.oxlintrc.json`).
- Sentry PII (`sendDefaultPii`) and session replay default to **off** and are opt-in via runtime
  config; desktop runtime must not initialize browser Sentry.

## Packages quick reference

`db` (Drizzle schema + migrations + seeds), `schemas` (Zod), `contracts` (client-facing DTOs +
AppType), `client-runtime` (frontend SDK + transport), `auth` (Better-Auth), `math-engine` (GUM
uncertainty engine, versioned with dossiers in `validation/`), `method-definition` (method
compiler), `method-templates` (catalog of calibration methods), `certificate-data` +
`documents` (certificate/label data and templates), `signing` (PAdES / ICP-Brasil),
`label-rendering` (ZPL/TSPL thermal labels), `email` (React Email), `email-sender`,
`notifications`, `interval-analysis` (calibration intervals), `local-db` (SQLite offline
store), `shared` (plans, config, public URLs, storage endpoints), `oxlint-plugin-calibra`
(architecture lint rules).
