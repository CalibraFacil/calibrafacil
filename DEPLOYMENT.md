# Deployment Guide

This document describes how to deploy CalibraFacil to production.

## Architecture Overview

| App | Platform | URL |
|-----|----------|-----|
| API | Cloudflare Workers | api.calibrafacil.com |
| Web | Cloudflare Pages | calibrafacil.com |
| Portal | Cloudflare Pages | portal.calibrafacil.com |
| Worker | Cloudflare Workers | (background jobs) |
| Database | Neon PostgreSQL | (via Hyperdrive) |

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed
- GitHub repository access

## Initial Setup

### 1. Configure GitHub Secrets

Go to your GitHub repository Settings > Secrets and variables > Actions, and add:

| Secret Name | Description |
|-------------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers/Pages edit permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `DATABASE_URL` | PostgreSQL connection string (for migrations) |

Optional (for Turbo Remote Cache):
| Secret Name | Description |
|-------------|-------------|
| `TURBO_TOKEN` | Vercel Turbo remote cache token |
| `TURBO_TEAM` | Vercel team name (set as repository variable) |

### 2. Configure Cloudflare Secrets

Secrets must be set via the Wrangler CLI (they cannot be in wrangler.jsonc for security):

```bash
# For the API worker
cd apps/api
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put R2_SECRET_ACCESS_KEY

# Enter each secret value when prompted
```

### 3. Cloudflare Pages Projects

The following Pages projects should already exist:
- `dashboard-calibra-facil` - Web app (calibrafacil.com)
- `calibra-facil-portal` - Portal app

### 4. Set Up Cloudflare Resources

Ensure these resources exist in your Cloudflare account:
- **Hyperdrive**: Connection to Neon PostgreSQL (ID: `<hyperdrive-id>`)
- **Queue**: `calibration-pdf-queue` for PDF generation
- **R2 Bucket**: `calibrafacil-certificates` for certificate storage
- **Custom Domain**: `api.calibrafacil.com` configured in DNS

## CI/CD Workflows

### Pull Request Workflow (`.github/workflows/ci.yml`)

Runs on every PR to `main`:
- Linting with oxlint
- Type checking with TypeScript
- Unit tests with Vitest

### Deploy Workflow (`.github/workflows/deploy.yml`)

Runs on push to `main`:
1. Quality checks (lint, typecheck, test)
2. Parallel deployment of all apps:
   - API to Cloudflare Workers
   - Worker to Cloudflare Workers
   - Web to Cloudflare Pages
   - Portal to Cloudflare Pages

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
   cp apps/api/.dev.vars.example apps/api/.dev.vars
   cp apps/worker/.dev.vars.example apps/worker/.dev.vars
   cp .env.example .env  # if exists
   ```

2. Fill in the secret values in `.dev.vars` files

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
```

## Manual Deployment

If you need to deploy manually (not recommended for production):

```bash
# API
cd apps/api && wrangler deploy

# Worker
cd apps/worker && wrangler deploy

# Web (build first)
cd apps/web && pnpm build && wrangler pages deploy dist --project-name=calibra-facil-web

# Portal (build first)
cd apps/portal && pnpm build && wrangler pages deploy dist --project-name=calibra-facil-portal
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

### Workers/Pages

Cloudflare keeps deployment history. To rollback:
1. Go to Cloudflare Dashboard > Workers/Pages
2. Select the app
3. Go to Deployments
4. Click "Rollback" on a previous deployment

### Database

Database migrations are forward-only. For rollback:
1. Create a new migration that reverses the changes
2. Test thoroughly in staging
3. Deploy the reversal migration

## Monitoring

- **Cloudflare Analytics**: Workers and Pages analytics in Cloudflare dashboard
- **Observability**: Enabled in wrangler.jsonc for all workers
- **Logs**: View real-time logs with `wrangler tail`

```bash
# API logs
cd apps/api && wrangler tail

# Worker logs
cd apps/worker && wrangler tail
```

## Troubleshooting

### Deployment fails with "secret not found"

Ensure all required secrets are set:
```bash
cd apps/api
wrangler secret list
```

### Hyperdrive connection issues

Check that the Hyperdrive ID matches in wrangler.jsonc and that the Hyperdrive
is properly configured in the Cloudflare dashboard.

### Build fails in CI

1. Check that `pnpm-lock.yaml` is up to date
2. Ensure all environment variables are set in GitHub Secrets
3. Review the workflow logs for specific errors
