# Repository Guidelines

Guidance for anyone — human or coding agent — changing this repository. `CLAUDE.md`
covers the big-picture architecture; `CONTRIBUTING.md` covers the contribution flow.

## Project Structure & Module Organization

- `apps/`: deployable services. Key apps: `apps/api` (Hono REST API), `apps/web` (lab app),
  `apps/portal` (client portal), `apps/worker` (background jobs), `apps/desktop` +
  `apps/local-server` (offline desktop app), `apps/docs` (user documentation), `apps/site`
  (project website).
- `packages/`: shared libraries such as `db` (Drizzle schema + migrations), `schemas` (Zod),
  `auth`, `math-engine` (GUM uncertainty engine), `documents`, `shared`.
- `docs/`: architecture notes, audits and normative references.
- `validation/`: versioned validation dossiers of the math engine (LaTeX).
- Root config: `package.json`, `turbo.json`, `pnpm-workspace.yaml`, `.oxlintrc.json`,
  `docker-compose.yml`.
- Web architecture reference: `docs/architecture/web-frontend-architecture.md`.

## Build, Test, and Development Commands

- `pnpm setup:dev`: one-time local setup (env files, Docker services, migrations, demo seed).
- `pnpm dev`: run the API (:3000), lab app (:5173) and portal (:5174).
- `pnpm dev:all`: run every app with a `dev` script.
- `pnpm build`: build all apps/packages.
- `pnpm lint`: run oxlint across the monorepo.
- `pnpm format`: format `*.ts`, `*.tsx`, `*.md` with Prettier.
- `pnpm check-types`: TypeScript type checks.
- `pnpm turbo test`: run all tests (use Node 24 and `TZ=UTC`).
- `pnpm turbo dev --filter=@calibra-facil/api`: run a single app.
- `cd packages/db && pnpm db:bootstrap`: build a new database (schema push + `sql/schema-extras.sql`)
  or apply pending migrations to an existing one. Migrations are hand-written SQL files
  in `packages/db/drizzle/` plus an entry in `drizzle/meta/_journal.json`.

## Coding Style & Naming Conventions

- Language: TypeScript. Indentation: 2 spaces.
- Prefer descriptive, domain-focused names (e.g., `calibration`, `uncertainty`, `certificate`).
- Use `camelCase` for variables/functions, `PascalCase` for components/types.
- Formatting: Prettier; linting: oxlint. Run `pnpm format` and `pnpm lint` before PRs.
- `as` type assertions and `useEffect` imports are lint errors — see `CLAUDE.md`.

## API / Client Architecture Rules

- Frontend apps must not import from `@calibra-facil/api` or from `apps/api/*`. Use
  `@calibra-facil/contracts` and `@calibra-facil/client-runtime`.
- `packages/contracts` must not import `apps/api/*`. Contracts are the stable client-facing
  boundary, not a type alias back to the server implementation.
- Do not set `AppType` to `any`. The Hono RPC app type lives in
  `packages/contracts/src/api-app.ts` and must remain server-free.
- If a browser-facing raw Hono route is added, removed, or renamed, update the route list in
  `packages/contracts/src/api-app.ts` in the same change.
- Raw Hono RPC calls should stay inside `packages/client-runtime`. Frontend code should prefer
  product-level methods such as `calibraClient.jobs.approve(...)`.
- See `docs/architecture/api-client-contract.md` before changing API/client package
  boundaries.

## Web Frontend Architecture Rules

- Keep TanStack route files in `apps/web/src/routes` thin. They should declare
  `createFileRoute`, route metadata, loaders, search validation, and small param adapters
  only.
- Put product UI, data hooks, forms, models, and table columns in
  `apps/web/src/features/<domain>`.
- Production feature modules must not call `createFileRoute`, `Route.use*`, `useParams`, or
  `useSearch`. Route params/search should be passed from route adapters as explicit props or
  normalized loader inputs.
- Do not add new route-local `-components`, `-index.data.ts`, or `-index.db.ts` modules under
  dashboard routes. Add the equivalent feature module instead.
- Shared primitives and cross-domain helpers belong in `apps/web/src/shared`,
  `apps/web/src/components/ui`, `apps/web/src/lib`, or `apps/web/src/app`, not inside a
  feature.
- Runtime constants, telemetry flags, and dashboard storage keys belong in
  `apps/web/src/app/config/runtime.ts` and
  `apps/web/src/features/dashboard/dashboard-scope-storage.ts`.
- Route navigation, cloud-only state, sidebar visibility, and plan/role rules should use
  `apps/web/src/app/router/route-meta.ts` where possible.
- Forms for regulated workflows should be schema-first. Prefer `@calibra-facil/schemas` for
  domain payloads and feature `forms.ts` files for UI-to-payload parsing.
- Sentry PII and session replay must remain opt-in through runtime config. Do not enable
  replay or default PII collection by default.

## Guardrails for Regulated Code

- Preserve tenant, organization, and unit scoping in every query.
- Preserve Better Auth patterns, RBAC permission boundaries, and plan/entitlement checks.
- The math engine (`packages/math-engine`) is versioned: any change to a numeric result needs
  a new `ENGINE_VERSION` and a new dossier directory under `validation/math-engine/`. Never
  reformat it as part of a sweep.
- Approved calibrations and issued certificates are immutable records; changes go through the
  amendment flow, never through in-place edits.
- Keep changes scoped; avoid broad rewrites mixed with feature work.

## Testing Guidelines

- Test runner: Vitest (see package-level scripts).
- Place tests alongside code when practical (e.g., `*.test.ts`) or in package test folders.
- Run focused tests with package scripts, e.g., `cd apps/api && pnpm test:run`.
- Real-database integration tests (`*.int.spec.ts`) run with
  `pnpm --dir apps/api test:integration` against a disposable local Postgres.

## Commit & Pull Request Guidelines

- Commit messages follow Conventional Commits: `type(scope): subject` (e.g.,
  `feat(auth): add session revoke`).
- Keep subjects imperative and concise; include scope when useful.
- PRs should include a clear summary, testing notes, and linked issues.
- Include screenshots or recordings for UI changes in `apps/web` or `apps/portal`.

## Configuration & Environment

- Local secrets live in gitignored `.env` files created by `pnpm setup:dev`
  (`apps/api/.env`, `packages/db/.env`). Templates: the matching `.env.example` files.
- The API and worker run with Bun; the web apps and local server run with Node 24.
- Never commit secrets, `.env` files, production credentials or customer data.
