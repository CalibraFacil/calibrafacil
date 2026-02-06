# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Root commands (Turborepo)
pnpm build           # Build all apps/packages
pnpm dev             # Run all apps in dev mode
pnpm lint            # Lint with oxlint
pnpm format          # Format with Prettier
pnpm check-types     # TypeScript type checking

# Run specific app
pnpm turbo dev --filter=@calibra-facil/api
pnpm turbo dev --filter=@calibra-facil/web
pnpm turbo dev --filter=@calibra-facil/docs

# Database (from packages/db)
pnpm db:generate     # Generate migration from schema changes
pnpm db:migrate      # Run pending migrations
pnpm db:studio       # Open Drizzle Studio (port 4000)

# Testing
pnpm turbo test                              # Run all tests
pnpm turbo test --filter=@calibra-facil/api  # Run specific package tests
cd apps/api && pnpm test:run                 # Run API tests once
cd packages/math-engine && pnpm test         # Run math-engine tests

# Manual deployment (prefer CI/CD)
cd apps/api && pnpm exec wrangler deploy
cd apps/worker && pnpm exec wrangler deploy
```

## Architecture Overview

**Monorepo:** Turborepo + pnpm workspaces

### Apps

| App | Package | Port | Platform | URL |
|-----|---------|------|----------|-----|
| API | `@calibra-facil/api` | 3000 | Cloudflare Workers | api.calibrafacil.com |
| Web | `@calibra-facil/web` | 5173 | Cloudflare Pages | calibrafacil.com |
| Portal | `@calibra-facil/portal` | 5174 | Cloudflare Pages | portal.calibrafacil.com |
| Docs | `@calibra-facil/docs` | 4321 | Cloudflare Pages | docs.calibrafacil.com |
| Worker | `@calibra-facil/worker` | - | Cloudflare Workers | (background jobs) |

### Shared Packages

| Package | Purpose | Key Exports |
|---------|---------|-------------|
| `@calibra-facil/db` | Drizzle ORM + Neon PostgreSQL | `db`, `schema` |
| `@calibra-facil/auth` | Better-Auth authentication | `auth`, `authClient`, `ac` (access control) |
| `@calibra-facil/schemas` | Zod validation schemas | shared schemas |
| `@calibra-facil/email` | React Email templates | `Email` |
| `@calibra-facil/math-engine` | GUM-compliant uncertainty calculations | `gum`, `flatten`, `config`, `types` |
| `@calibra-facil/notifications` | Notification service | `notifications`, `standaloneNotifications` |
| `@calibra-facil/documents` | Certificate HTML generation | `CertificateHTML` |
| `@calibra-facil/shared` | Plans, config, shared types | `plans`, `config` |

## Tech Stack

- **Frontend:** React 19, Vite, TanStack Router/Query, TailwindCSS 4
- **Backend:** Hono on Cloudflare Workers
- **Database:** Drizzle ORM → Neon PostgreSQL (via Hyperdrive)
- **Auth:** Better-Auth
- **Testing:** Vitest
- **Linting:** oxlint (TypeScript, React, React Hooks, Import, Unicorn plugins)

## Key Patterns

**Database schema changes:** Modify `packages/db/src/schema.ts`, then run `pnpm db:generate` from `packages/db` directory.

**API routes:** Located in `apps/api/src/routes/`. Each router uses Hono and is composed in the main app.

**Worker jobs:** Background processing in `apps/worker/` - handles PDF generation via Cloudflare Queue and Puppeteer.

**Cloudflare bindings:** API and Worker use Hyperdrive (DB proxy), R2 (storage), Queue (PDF jobs), and Browser API (Puppeteer).

**Environment secrets:** Cloudflare secrets set via `wrangler secret put`. Local dev uses `.dev.vars` files.

## Project Context

CalibraFacil is an ISO 17025 compliant calibration laboratory management system. The math-engine package implements GUM (Guide to the Expression of Uncertainty in Measurement) calculations for calibration certificates.
