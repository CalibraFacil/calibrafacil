# Calibra Fácil

ISO 17025 compliant calibration laboratory management system.

## Overview

Calibra Fácil helps calibration laboratories manage their operations with full compliance to ISO/IEC 17025 requirements. The system handles calibration workflows, uncertainty calculations (GUM-compliant), certificate generation, customer management, and compliance tracking.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           Vercel                                │
├─────────────┬─────────────┬─────────────┬───────────────────────┤
│  Web App    │  Portal     │    API      │   Queue + Cron        │
│  :5173      │  :5174      │   :3000     │   background jobs     │
└──────┬──────┴──────┬──────┴──────┬──────┴──────────┬────────────┘
       │             │             │                 │
       └─────────────┴──────┬──────┴────────┬────────┘
                            │               │
                     ┌──────┴──────┐ ┌──────┴──────┐
                     │    Neon     │ │ Cloudflare  │
                     │ PostgreSQL  │ │  R2 Storage │
                     └─────────────┘ └─────────────┘
```

| Component           | Description                                              | Platform              |
| ------------------- | -------------------------------------------------------- | --------------------- |
| **Web**             | Lab dashboard for technicians and administrators         | Vercel                |
| **Portal**          | Client-facing portal for certificate access              | Vercel                |
| **API**             | REST API backend                                         | Vercel Functions      |
| **Background jobs** | PDF generation, compliance checks, and integration syncs | Vercel Queue and Cron |
| **Database**        | PostgreSQL with Drizzle ORM                              | Neon                  |
| **Object storage**  | Certificate PDFs and runtime assets                      | Cloudflare R2         |

For frontend architecture rules, see
[`docs/architecture/web-frontend-architecture.md`](./docs/architecture/web-frontend-architecture.md).
For API/client package boundaries, see
[`docs/architecture/api-client-contract.md`](./docs/architecture/api-client-contract.md).

## Monorepo Structure

```
calibra-facil/
├── apps/
│   ├── api/          # Hono REST API
│   ├── web/          # React dashboard
│   ├── portal/       # React client portal
│   └── worker/       # Background job processor
├── packages/
│   ├── db/           # Drizzle ORM + schema
│   ├── auth/         # Better-Auth integration
│   ├── schemas/      # Zod validation schemas
│   ├── email/        # React Email templates
│   ├── notifications/# Notification service
│   ├── documents/    # Certificate/label templates
│   └── shared/       # Plans, config, types
├── docs/
│   └── architecture/ # Architecture rules and package boundaries
└── packages/
    └── typescript-config/
```

The web app uses a feature-first structure: `apps/web/src/routes` contains thin
TanStack route adapters, while domain implementation lives in
`apps/web/src/features`. Product code should call `@calibra-facil/client-runtime`
facades instead of importing API server code or raw Hono route handlers.

## Tech Stack

- **Frontend:** React 19, Vite, TanStack Router/Query, Tailwind CSS 4
- **Backend:** Hono, Vercel Functions
- **Database:** PostgreSQL (Neon), Drizzle ORM
- **Auth:** Better-Auth with organization support
- **PDF Generation:** Puppeteer/Chromium
- **Email:** Resend + React Email
- **Monorepo:** Turborepo + pnpm

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL (local or Neon account)

### Setup

1. Clone and install dependencies:

   ```bash
   git clone https://github.com/CalibraFacil/calibra-facil.git
   cd calibra-facil
   pnpm install
   ```

2. Configure environment:

   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/worker/.env.example apps/worker/.env
   # Edit .env files with your credentials
   ```

3. Run database migrations:

   ```bash
   cd packages/db
   pnpm db:migrate
   ```

4. Start development:

   ```bash
   pnpm dev
   ```

   This starts:
   - Web: https://localhost:5173
   - Portal: https://localhost:5174
   - API: http://localhost:3000
   - Worker: Postgres queue polling and scheduled jobs

## Development Commands

```bash
# All apps
pnpm dev              # Start all apps in dev mode
pnpm build            # Build all apps and packages
pnpm lint             # Lint with oxlint
pnpm format           # Format with Prettier
pnpm check-types      # TypeScript type checking

# Specific app
pnpm turbo dev --filter=@calibra-facil/api
pnpm turbo dev --filter=@calibra-facil/web

# Database
cd packages/db
pnpm db:generate      # Generate migration from schema
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Drizzle Studio

# Testing
pnpm turbo test       # Run all tests
```

## Key Features

- **Calibration Workflow:** Draft → Review → Approved with audit trail
- **GUM Calculations:** Type A, Type B, and combined uncertainty
- **Certificate Generation:** PDF certificates with QR verification
- **Customer Portal:** Clients can view certificates and assets
- **Compliance Tracking:** Asset recalibration and standard expiry alerts
- **Role-Based Access:** Owner, Admin, Technician, Member, Client roles
- **Multi-Tenant:** Organization-based data isolation

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment instructions.

## License

Proprietary - All rights reserved.
