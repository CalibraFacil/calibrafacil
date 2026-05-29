# Repository Guidelines

## Project Structure & Module Organization

- `apps/`: deployable services. Key apps: `apps/api` (Hono REST API), `apps/web` (lab dashboard), `apps/portal` (client portal), `apps/worker` (background jobs), `apps/docs` (docs site).
- `packages/`: shared libraries such as `db` (Drizzle schema), `schemas` (Zod), `auth`, `documents`, `shared`.
- `docs/`: documentation assets.
- Root config: `package.json`, `turbo.json`, `pnpm-workspace.yaml`, `oxlint.json`.
- Web architecture reference: `docs/architecture/web-frontend-architecture.md`.

## Build, Test, and Development Commands

- `pnpm dev`: run all apps in dev mode (Turborepo).
- `pnpm build`: build all apps/packages.
- `pnpm lint`: run oxlint across the monorepo.
- `pnpm format`: format `*.ts`, `*.tsx`, `*.md` with Prettier.
- `pnpm check-types`: TypeScript type checks.
- `pnpm turbo test`: run all tests.
- `pnpm turbo dev --filter=@calibra-facil/api`: run a single app.
- `cd packages/db && pnpm db:generate`: generate migrations from schema changes.
- `cd packages/db && pnpm db:migrate`: apply migrations.

## Coding Style & Naming Conventions

- Language: TypeScript. Indentation: 2 spaces.
- Prefer descriptive, domain-focused names (e.g., `calibration`, `uncertainty`, `certificate`).
- Use `camelCase` for variables/functions, `PascalCase` for components/types.
- Formatting: Prettier; linting: oxlint. Run `pnpm format` and `pnpm lint` before PRs.

## API / Client Architecture Rules

- Frontend apps must not import from `@calibra-facil/api` or from `apps/api/*`. Use `@calibra-facil/contracts` and `@calibra-facil/client-runtime`.
- `packages/contracts` must not import `apps/api/*`. Contracts are the stable client-facing boundary, not a type alias back to the server implementation.
- Do not set `AppType` to `any`. The Hono RPC app type lives in `packages/contracts/src/api-app.ts` and must remain server-free.
- If a browser-facing raw Hono route is added, removed, or renamed, update the route list in `packages/contracts/src/api-app.ts` in the same change.
- Raw Hono RPC calls should stay inside `packages/client-runtime`. Frontend code should prefer product-level methods such as `calibraClient.jobs.approve(...)`.
- See `docs/architecture/api-client-contract.md` before changing API/client package boundaries.

## Web Frontend Architecture Rules

- Keep TanStack route files in `apps/web/src/routes` thin. They should declare `createFileRoute`, route metadata, loaders, search validation, and small param adapters only.
- Put product UI, data hooks, forms, models, and table columns in `apps/web/src/features/<domain>`.
- Production feature modules must not call `createFileRoute`, `Route.use*`, `useParams`, or `useSearch`. Route params/search should be passed from route adapters as explicit props or normalized loader inputs.
- Do not add new route-local `-components`, `-index.data.ts`, or `-index.db.ts` modules under dashboard routes. Add the equivalent feature module instead.
- Shared primitives and cross-domain helpers belong in `apps/web/src/shared`, `apps/web/src/components/ui`, `apps/web/src/lib`, or `apps/web/src/app`, not inside a feature.
- Runtime constants, telemetry flags, and dashboard storage keys belong in `apps/web/src/app/config/runtime.ts` and `apps/web/src/features/dashboard/dashboard-scope-storage.ts`.
- Route navigation, cloud-only state, sidebar visibility, and plan/role rules should use `apps/web/src/app/router/route-meta.ts` where possible.
- Forms for regulated workflows should be schema-first. Prefer `@calibra-facil/schemas` for domain payloads and feature `forms.ts` files for UI-to-payload parsing.
- Sentry PII and session replay must remain opt-in through runtime config. Do not enable replay or default PII collection by default.

## Testing Guidelines

- Test runner: Vitest (see package-level scripts).
- Place tests alongside code when practical (e.g., `*.test.ts`) or in package test folders.
- Run focused tests with package scripts, e.g., `cd apps/api && pnpm test:run`.

## Commit & Pull Request Guidelines

- Commit messages follow Conventional Commits: `type(scope): subject` (e.g., `feat(auth): add session revoke`).
- Keep subjects imperative and concise; include scope when useful.
- PRs should include a clear summary, testing notes, and linked issues.
- Include screenshots or recordings for UI changes in `apps/web` or `apps/portal`.

## Configuration & Environment

- Local secrets live in `.env` files under `apps/api` and `apps/worker`.
- API and worker run locally with Bun; keep secrets out of git.

## Agent Workflow

- Claude owns planning, implementation (backend/API/worker + UI/frontend), repair, and self-review for product-spec work.
- The `.agent/` directory is a working journal, not a hand-off protocol:
  - `.agent/goal.md`: the durable objective for the current multi-phase product-spec push.
  - `.agent/goal-state.md`: per-slice progress, completed phases, current phase result, next phase objective.
  - `.agent/brief.md`: the contract for the slice currently being implemented (scope, non-scope, acceptance criteria, tests/checks).
  - `.agent/status.md`: dated record of checks run and their outcomes.
  - `.agent/review.md`: Claude's self-review of the slice before declaring it done.
  - `.agent/decisions.md`: accepted/deferred/rejected design choices that bind future slices.
- Do not mark `.agent/goal.md` complete until the requested product scope is actually implemented, reviewed, and covered by relevant checks.
- For Conta Azul work, use `docs/plans/conta-azul-product-strategy.md` as required product context.
- Preserve tenant, organization, and unit scoping.
- Preserve Better Auth patterns and permission boundaries.
- Preserve entitlement and plan-limit enforcement.
- Avoid broad rewrites; keep each slice scoped to its brief.
- Run affected checks and record results in `.agent/status.md`.
- Do not touch secrets, `.env` files, production credentials, billing credentials, deployment tokens, or unrelated app features.
