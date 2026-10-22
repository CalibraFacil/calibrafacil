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
pnpm knip             # unused files/deps/unresolved imports (config: knip.json)
pnpm check:cycles     # madge --circular over every workspace's src
```

Local development needs no cloud account: `docker-compose.yml` runs Postgres, an
S3-compatible store, Mailpit (the app sends over SMTP; every email, magic links included,
lands at http://localhost:8025) and Gotenberg. The seed
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
  `hono/client` outside `client-runtime`, router coupling inside `apps/web/src/features`, app-local re-creations of `@calibra-facil/ui`
  components, and new raw Tailwind palette colour classes (`text-red-500`...) in
  `apps/*/src/features` (a per-file ratchet that steers to `status-tone`).
- **`as` type assertions are banned** (`consistent-type-assertions: never`). Use type guards,
  `satisfies`, or schema parsing instead.
- **`check-types` runs `tsrs`**, the Rust port of the TypeScript 7 compiler (Cloudflare/VoidZero)
  (`tsrs` npm package, pinned exactly in the root `package.json`; same flags and diagnostics as
  `tsc`, 4-8x faster and 2-3x less memory on `apps/api`). Each package's script goes
  through `scripts/typecheck.mjs`, which falls back to the native Go `tsc` (`typescript@7`, still
  installed for editors and peer deps) on hosts without a tsrs binary (it ships linux x64/arm64
  and macOS arm64 only: no Windows, no Intel macOS). `pnpm check-types:tsc` (or
  `CHECK_TYPES_CHECKER=tsc`) forces `tsc` for a local parity check. If the two
  disagree, `tsc` is the reference, so report it upstream (oxc-project/tsrs). Exit codes differ
  on errors (tsc 1, tsrs 2); both are non-zero. Exception: the Next.js app (`apps/docs`) stays
  on `typescript@6.0.3` and `tsc` — the classic JS build — because its tooling (`next typegen`)
  imports the TypeScript compiler _API_, which the native `typescript@7` package does not ship.
  The API `dev`/`start` and worker run under **Bun**; the web/portal/local-server run under
  Node + Vite/tsx.
- `pnpm.overrides` and `scripts/check-blocked-deps.mjs` pin/forbid specific dependency versions
  after supply-chain incidents (TanStack, axios). Don't loosen these; `check-blocked-deps`
  fails the build if a blocked version reappears in the lockfile.

## Architecture: cloud + desktop/offline

The same React frontend (`apps/web`) runs in two modes, and most of the architecture exists to
keep these in parity:

- **Cloud:** `apps/api` (Hono) → PostgreSQL + S3-compatible object storage (Cloudflare R2 in
  the original deployment), Gotenberg for PDFs and SMTP or Resend for email
  (`packages/email-sender/src/transport.ts`). Background work (PDF
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

Offline mode is deliberately narrow (audit decision Q13): field capture (execute an assigned job from
a read-only pack of method and standards), intake (a service order or a minimal asset stub) and
reference reads (customers, assets, standards, methods). Everything else is online-only. The
data-policy registry (`packages/client-runtime/src/data-policy.ts`) is the single source of truth:
a method that is not `cloud-only` there needs a local implementation (`apps/local-server`,
`packages/local-db`, the desktop client). Desktop-available routes are one allowlist in
`apps/web/src/runtime/desktop-offline-routes.ts`; a route is available offline only if every method
it renders from is non-cloud-only, and a new route is online-only on the desktop by default.

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

- **Reuse the `instrument-panel` design system** (from `@calibra-facil/ui/instrument-panel`,
  shared with `apps/web`) — `Panel`/`PanelHeader`/`SignalTile`/
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
  `pnpm lint`) fails on any `useEffect` import from `react`, and `no-restricted-properties` fails on
  `React.useEffect` through the default import. A default import under another name
  (`import R from "react"`) still passes: closing that needs a rule in `oxlint-plugin-calibra`. Use
  derived state, event handlers, data hooks, keyed remounts, or the `use-mount-effect.ts` wrapper.
  Only the `apps/*/src/hooks/use-mount-effect.ts` wrappers may import raw `useEffect` (allowed via an
  `overrides` entry in `.oxlintrc.json`).
- **The math engine is source-pinned.** `packages/math-engine/src/audit/engine-source-pin.spec.ts`
  compares a SHA-256 of the engine sources (and five golden GUM results) with the current
  dossier's `validation/math-engine/v<version>/manifest.json`. Any byte change to engine code,
  comments and formatting included, fails it. A deliberate release bumps `ENGINE_VERSION` and
  the package version, adds the new dossier directory, then runs
  `pnpm --filter @calibra-facil/math-engine run engine:pin`. The engine is exact for formula
  evaluation, sensitivities and Type A sums, but propagation (`u_c`, `ν_eff`, `k`, `U`) runs in
  float64; see `packages/math-engine/README.md`.
- **No third-party error tracking.** Nothing is reported off the device or the server. Server errors
  go through `createLogErrorReporter` (`packages/shared/src/telemetry`) as one redacted JSON line on
  stderr; browser route errors go to the console. Do not add an error-tracking SDK, replay or
  default PII collection.

## Packages quick reference

`db` (Drizzle schema + migrations + seeds), `schemas` (Zod), `contracts` (client-facing DTOs +
AppType), `client-runtime` (frontend SDK + transport), `auth` (Better-Auth), `math-engine` (GUM
uncertainty engine, versioned with dossiers in `validation/`), `method-definition` (method
compiler), `method-templates` (catalog of calibration methods), `certificate-data` +
`documents` (certificate/label data and templates), `signing` (PAdES / ICP-Brasil),
`label-rendering` (ZPL/TSPL thermal labels), `ui` (shared shadcn primitives,
instrument-panel and status-tone for web and portal; see `docs/architecture/shared-ui-package.md`), `email` (React Email), `email-sender`,
`notifications`, `interval-analysis` (calibration intervals), `local-db` (SQLite offline
store), `shared` (domain vocabularies, units, public URLs, storage endpoints), `oxlint-plugin-calibra`
(architecture lint rules).
