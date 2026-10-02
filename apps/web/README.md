# @calibra-facil/web

Main dashboard application for calibration laboratory operators, built with React 19 and Vite.

## Overview

The web app provides the primary interface for lab technicians, administrators, and owners to manage calibration operations, customers, assets, and compliance.

## Development

```bash
# From root
pnpm turbo dev --filter=@calibra-facil/web

# Or from this directory
pnpm dev
```

The app runs at `https://localhost:5173` (HTTPS required for auth cookies).

## Routes

```
/                          # Landing page
/sign-in                   # Authentication
/accept-invitation         # Team invitation acceptance

/dashboard
  /jobs                    # Calibration jobs list
    /$id                   # Job details & workflow
  /assets                  # Equipment inventory
    /$id                   # Asset details
  /clients                 # Customer management
    /new                   # Add customer
    /$id                   # Customer details
      /calibrations        # Customer's jobs
      /compliance          # Compliance tracking
      /assets              # Customer's equipment
      /users               # Portal users
      /info                # Company info
  /methods                 # Calibration methods
    /$id                   # Method details
  /services                # Services catalog
    /$id                   # Service details
  /standards               # Reference standards
    /$id                   # Standard details
  /settings
    /profile               # User profile
    /organization          # Lab settings
    /security              # Active sessions
    /authentication        # Sign-in methods, SSO, API keys
    /notifications         # Alert preferences
    /appearance            # Theme, locale
    /danger                # Delete account/org
```

## Key Features

- Calibration job workflow (Draft → Review → Approved)
- GUM uncertainty calculations
- Customer and asset management
- Reference standard tracking
- Compliance monitoring and alerts
- Team member management
- Subscription billing

## Tech Stack

- React 19
- Vite
- TanStack Router (file-based routing)
- TanStack Query (data fetching)
- TanStack Table (data grids)
- Tailwind CSS 4
- Shadcn/ui components
- Recharts (dashboards)
- Sentry (error tracking)

## Scripts

```bash
pnpm dev          # Development server
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm test         # Run tests
pnpm test:e2e     # Run Playwright browser tests
pnpm lint         # Lint with oxlint
pnpm check-types  # TypeScript check
```

Playwright tests live in `e2e/` and run against a local Vite server. By
default, the config points browser-side API calls at `http://127.0.0.1:3000`
and individual specs should route/mock the API calls they own. Set
`PLAYWRIGHT_BASE_URL` to reuse an already running web server.

## Project Structure

```
src/
├── app/              # App-level config, router metadata, providers
├── routes/           # Thin TanStack Router file-based route adapters
├── features/         # Domain-owned UI, queries, forms, models, types
├── shared/           # Cross-domain API/form helpers
├── components/       # Shared React components and UI primitives
│   └── ui/           # Base UI components
├── lib/              # Utilities and route helpers
├── hooks/            # Custom React hooks
└── styles.css        # Global styles and Tailwind tokens
```

## Architecture Rules

- Route files should stay thin: `createFileRoute`, metadata, loaders,
  search validation, and param handoff only.
- Renderable dashboard page routes must define `head` title metadata; layout
  `route.tsx` files and redirect-only adapters are the explicit exceptions.
- Domain UI and behavior belong in `src/features/<domain>`, not under
  `src/routes`.
- Feature modules should not call TanStack route registration or route hooks.
  Route adapters pass params/search into features through props or loader input.
- Raw Hono RPC calls stay inside `@calibra-facil/client-runtime`. Web code should
  use `calibraApi`/`calibraClient` product-level methods.
- Regulated workflows should validate payloads with Zod schemas from
  `@calibra-facil/schemas` or a feature `forms.ts` parser before mutation.
- Browser E2E specs belong in `e2e/`. Cover cross-route/auth/runtime workflows
  there when a component or feature-level Vitest test is too narrow.
- Dashboard organization/unit persistence uses
  `features/dashboard/dashboard-scope-storage.ts`; do not read those storage
  keys directly from new code.
- Sidebar, cloud-only behavior, and route access metadata should be added to
  `src/app/router/route-meta.ts` instead of duplicated in navigation components.
- Sentry PII and replay are opt-in through `src/app/config/runtime.ts`.

See
[`../../docs/architecture/web-frontend-architecture.md`](../../docs/architecture/web-frontend-architecture.md)
for the full frontend architecture contract.
