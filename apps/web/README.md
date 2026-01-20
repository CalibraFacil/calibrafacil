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
/sign-up                   # Registration
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
    /security              # Password, sessions
    /authentication        # 2FA, providers
    /billing               # Subscription, invoices
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
pnpm lint         # Lint with oxlint
pnpm check-types  # TypeScript check
```

## Project Structure

```
src/
├── routes/           # TanStack Router file-based routes
├── components/       # React components
│   ├── ui/          # Base UI components
│   └── ...          # Feature components
├── lib/             # Utilities and API client
├── hooks/           # Custom React hooks
└── styles/          # Global styles
```
