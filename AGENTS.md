# Repository Guidelines

## MANDATORY: Use td for Task Management

Run td usage --new-session at conversation start (or after /clear). This tells you what to work on next.

Sessions are automatic (based on terminal/agent context). Optional:
- td session "name" to label the current session
- td session --new to force a new session in the same context

Use td usage -q after first read.

## Project Structure & Module Organization
- `apps/`: deployable services. Key apps: `apps/api` (Hono REST API), `apps/web` (lab dashboard), `apps/portal` (client portal), `apps/worker` (background jobs), `apps/docs` (docs site).
- `packages/`: shared libraries such as `db` (Drizzle schema), `schemas` (Zod), `auth`, `math-engine`, `documents`, `shared`.
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
- Local secrets live in `.dev.vars` files under `apps/api` and `apps/worker`.
- Cloudflare bindings (Hyperdrive, R2, Queues, Browser API) are used by API/Worker; keep secrets out of git.
