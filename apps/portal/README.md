# @calibra-facil/portal

Client-facing portal for calibration customers to access their certificates and assets.

## Overview

The portal provides a read-focused interface for customers to view their calibration history, download certificates, and manage their account settings.

## Development

```bash
# From root
pnpm turbo dev --filter=@calibra-facil/portal

# Or from this directory
pnpm dev
```

The app runs at `http://localhost:5174` by default.
Set `VITE_DEV_HTTPS=true` if you explicitly need local HTTPS.

## Routes

```
/sign-in                   # Client authentication
/v/$token                  # Certificate verification (public)
/accept-invite             # Portal invitation acceptance

/@authenticated
  /                        # Dashboard overview
  /assets                  # View assigned equipment
  /certificates            # Download certificates
  /settings
    /profile               # User profile
    /preferences           # Notification settings
```

## Key Features

- Certificate download and verification
- Calibration history view
- Asset visibility (customer's equipment)
- Public verification endpoint (no auth required)
- Notification preferences

## Tech Stack

- React 19
- Vite
- TanStack Router
- TanStack Query
- Tailwind CSS 4

## Scripts

```bash
pnpm dev          # Development server
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm lint         # Lint with oxlint
pnpm check-types  # TypeScript check
```

## Project Structure

```
src/
├── routes/           # TanStack Router file-based routes
├── components/       # React components
├── lib/             # Utilities and API client
└── hooks/           # Custom React hooks
```
