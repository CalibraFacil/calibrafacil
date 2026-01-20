# @calibra-facil/api

REST API backend for Calibra Fácil, built with Hono and deployed on Cloudflare Workers.

## Overview

The API handles all backend operations including authentication, calibration workflows, customer management, billing, and certificate generation orchestration.

## Development

```bash
# From root
pnpm turbo dev --filter=@calibra-facil/api

# Or from this directory
pnpm dev
```

The API runs at `http://localhost:3000`.

## Routes

| Route | Description |
|-------|-------------|
| `/api/auth/lab/*` | Lab user authentication (Better Auth) |
| `/api/auth/portal/*` | Portal/client authentication |
| `/api/customers` | Customer CRUD operations |
| `/api/assets` | Instrument/equipment management |
| `/api/asset-types` | Dynamic asset type definitions |
| `/api/methods` | Calibration method management |
| `/api/services` | Calibration services catalog |
| `/api/standards` | Reference standards management |
| `/api/jobs` | Calibration job workflow |
| `/api/dashboard` | Analytics and metrics |
| `/api/billing/*` | Subscription and payments |
| `/api/webhooks` | External service webhooks |
| `/api/verify` | Public certificate verification |
| `/api/invitations` | Team member invitations |
| `/api/portal` | Portal-specific operations |
| `/api/notifications` | Notification management |

## Environment Variables

Create `.dev.vars` from `.dev.vars.example`:

```env
BETTER_AUTH_SECRET=     # Auth secret key
RESEND_API_KEY=         # Resend email service
RESEND_FROM_EMAIL=      # Sender email address
API_URL=                # API base URL
APP_URL=                # Web app URL
NODE_ENV=               # development/production
AWS_ACCESS_KEY_ID=      # R2 access (S3-compatible)
AWS_SECRET_ACCESS_KEY=  # R2 secret
S3_BUCKET=              # R2 bucket name
S3_REGION=              # R2 region
```

Cloudflare bindings (configured in `wrangler.jsonc`):
- `HYPERDRIVE` - Database connection via Hyperdrive
- `CERTIFICATES_BUCKET` - R2 bucket for certificate storage
- `PDF_QUEUE` - Queue for PDF generation jobs

## Testing

```bash
pnpm test        # Watch mode
pnpm test:run    # Single run
pnpm test:coverage
```

## Deployment

```bash
pnpm exec wrangler deploy
```

Or via CI/CD on push to main branch.

## Project Structure

```
src/
├── index.ts           # App entry, route composition
├── routes/            # API route handlers
│   ├── customers.ts
│   ├── assets.ts
│   ├── jobs.ts
│   ├── billing/
│   └── ...
├── services/          # Business logic
└── lib/               # Utilities
```
