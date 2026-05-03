# Deployment Guide

This document describes how to deploy CalibraFacil to production.

## Architecture Overview

| App | Platform | URL |
|-----|----------|-----|
| API | Vercel Functions | api.calibrafacil.com |
| Web | Vercel | calibrafacil.com |
| Portal | Vercel | portal.calibrafacil.com |
| Background jobs | Vercel Queue and Cron | (API project) |
| Docs | Cloudflare Pages | docs.calibrafacil.com |
| Database | Neon PostgreSQL | (direct connection) |
| Object storage | Cloudflare R2 | (certificate assets) |

## Prerequisites

- Vercel project access for the API, web, and portal apps
- Cloudflare account access for the docs site and R2 storage
- GitHub repository access

## Initial Setup

### 1. Configure Vercel Projects

The API, web, and portal apps deploy through Vercel. Each project should point at
the matching app directory:

| Project | Root Directory | Build |
|---------|----------------|-------|
| API | `apps/api` | `pnpm build:vercel-functions` |
| Web | `apps/web` | `pnpm build` |
| Portal | `apps/portal` | `pnpm build` |

Vercel-specific routing, cron, queue, and output settings live in each app's
`vercel.json`.

### 2. Configure Production Environment Variables

Set production secrets in Vercel for the API project:

| Variable | Description |
|----------|-------------|
| `BETTER_AUTH_SECRET` | Auth secret key |
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `RESEND_API_KEY` | Resend email API key |
| `RESEND_FROM_EMAIL` | Sender email address |
| `APP_URL` | Web app URL |
| `API_URL` | API base URL |
| `PORTAL_URL` | Portal URL |
| `R2_ACCOUNT_ID` | Cloudflare R2 account id |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret |
| `R2_BUCKET_NAME` | Certificate bucket name |
| `CHROMIUM_PACK_R2_BUCKET` | Optional R2 bucket for Chromium pack |
| `CHROMIUM_PACK_R2_KEY` | Optional R2 key for Chromium pack |
| `CHROMIUM_PACK_URL` | Optional public fallback URL for Chromium pack |
| `SIGNING_MASTER_KEY` | Certificate signing master key |
| `INTEGRATIONS_MASTER_KEY` | Integration credential encryption key |

Set app-specific public variables, such as `VITE_API_URL`, on the web and portal
Vercel projects.

Optional Turbo Remote Cache settings can remain in GitHub Actions:

| Secret or Variable | Description |
|--------------------|-------------|
| `TURBO_TOKEN` | Vercel Turbo remote cache token |
| `TURBO_TEAM` | Vercel team name, usually configured as a repository variable |

### 3. Configure Docs Deployment

Docs remain on Cloudflare Pages. Keep the Cloudflare secrets in GitHub Actions:

| Secret Name | Description |
|-------------|-------------|
| `CLOUDFLARE_API_TOKEN` | Token with Pages edit permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |

The docs deployment command is defined in `apps/docs/package.json`.

## CI/CD Workflows

### Pull Request Workflow (`.github/workflows/ci.yml`)

Runs on every PR to `main`:
- Linting with oxlint
- Type checking with TypeScript
- Unit tests with Vitest

### Deploy Workflow (`.github/workflows/deploy.yml`)

Runs on push to `main`:
1. Quality checks (lint, typecheck, test)
2. Docs deployment when `apps/docs` changes

The API, web, and portal projects deploy through Vercel's Git integration.

### Database Migration Workflow (`.github/workflows/db-migrate.yml`)

**Manual trigger only** - requires explicit confirmation:
1. Go to Actions > Database Migration
2. Select environment (production/staging)
3. Type `migrate` to confirm
4. Run workflow

## Local Development

### Setup

1. Copy environment files:
   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/worker/.env.example apps/worker/.env
   cp .env.example .env  # if exists
   ```

2. Fill in the secret values in `.env` files.

3. Start development:
   ```bash
   pnpm dev
   ```

### Running Individual Apps

```bash
# API only
pnpm turbo dev --filter=@calibra-facil/api

# Web only
pnpm turbo dev --filter=@calibra-facil/web

# Portal only
pnpm turbo dev --filter=@calibra-facil/portal

# Local background worker only
pnpm dev:worker
```

## Manual Deployment

Manual deploys should go through the package scripts:

```bash
pnpm deploy:api
pnpm deploy:web
pnpm deploy:portal
pnpm deploy:docs
```

## Database Migrations

### Generate a new migration

When you modify `packages/db/src/schema.ts`:

```bash
cd packages/db
pnpm db:generate
```

This creates a new migration file in `packages/db/drizzle/`.

### Run migrations locally

```bash
cd packages/db
pnpm db:migrate
```

### Run migrations in production

Use the GitHub Actions workflow (recommended) or:

```bash
DATABASE_URL=<production-url> cd packages/db && pnpm db:migrate
```

## Rollback

### Vercel Apps

Use the Vercel dashboard deployment history for the API, web, and portal apps.

### Docs

Use the Cloudflare Pages deployment history for docs.

### Database

Database migrations are forward-only. For rollback:
1. Create a new migration that reverses the changes
2. Test thoroughly in staging
3. Deploy the reversal migration

## Monitoring

- **Vercel Observability**: Runtime logs, function metrics, cron activity, and queue activity in Vercel
- **Cloudflare Analytics**: Docs and R2 analytics in the Cloudflare dashboard
- **Application logs**: Use each provider dashboard for production logs

## Troubleshooting

### Deployment fails with "environment variable not found"

Confirm the missing variable is set on the correct Vercel project and
environment. API-only secrets should be configured on the API project.

### Queue or cron jobs are not running

Check `apps/api/vercel.json` and the API project's Vercel deployment logs. Queue
handlers and cron routes are part of the API project.

### Build fails in CI

1. Check that `pnpm-lock.yaml` is up to date
2. Ensure all required environment variables are set in GitHub or Vercel
3. Review the workflow logs for specific errors
