# Repository Guidelines

## Project Structure & Module Organization

- `apps/`: deployable services. Key apps: `apps/api` (Hono REST API), `apps/web` (lab dashboard), `apps/portal` (client portal), `apps/worker` (background jobs), `apps/docs` (docs site).
- `packages/`: shared libraries such as `db` (Drizzle schema), `schemas` (Zod), `auth`, `documents`, `shared`.
- `docs/`: documentation assets.
- Root config: `package.json`, `turbo.json`, `pnpm-workspace.yaml`, `oxlint.json`.

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
