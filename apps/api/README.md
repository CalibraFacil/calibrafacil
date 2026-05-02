# @calibra-facil/api

REST API backend for Calibra Fácil, built with Hono and deployed on Fly.io.

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

Create `.env` from `.env.example`:

```env
BETTER_AUTH_SECRET=     # Auth secret key
RESEND_API_KEY=         # Resend email service
RESEND_FROM_EMAIL=      # Sender email address
API_URL=                # API base URL
APP_URL=                # Web app URL
NODE_ENV=               # development/production
DATABASE_URL=           # Postgres connection string
R2_ACCOUNT_ID=          # R2 account id
R2_ACCESS_KEY_ID=       # R2 access key
R2_SECRET_ACCESS_KEY=   # R2 secret
R2_BUCKET_NAME=         # R2 bucket name
```

## Testing

```bash
pnpm test        # Watch mode
pnpm test:run    # Single run
pnpm test:coverage
```

## Deployment

```bash
pnpm deploy
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
