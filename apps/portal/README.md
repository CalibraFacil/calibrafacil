# @calibra-facil/portal

Client-facing portal for calibration-lab customers (quality managers, metrology
coordinators, maintenance/purchasing teams). It is a **self-service command
center** — not a read-only viewer — where a customer can see their calibration
status, retrieve certificates, request calibrations, and track instruments in for
repair.

Conventions and architecture for working in this app live in
[`docs/architecture/portal-frontend.md`](../../docs/architecture/portal-frontend.md).
Read it before adding screens — the portal reuses the main app's **instrument-panel**
design system, not generic shadcn cards.

## Development

```bash
# From root
pnpm turbo dev --filter=@calibra-facil/portal
# Or from this directory
pnpm dev
```

Runs at `http://localhost:5174`. Set `VITE_DEV_HTTPS=true` if you explicitly need
local HTTPS. The app talks to the API at `/api/portal/*` (see `getApiBaseUrl` in
`src/lib/utils.ts`).

## Routes

```
# Public (no auth)
/sign-in                         # Magic-link sign-in
/accept-invite                   # Portal invitation acceptance
/v/$token                        # Public certificate verification + download
/service-order-access/$token     # Public service-order view + quote approve/reject

# Authenticated (_authenticated/)
/                                # Command center dashboard
/assets                          # Equipment list (calibration-status lens + filters)
/assets/$id                      # Equipment detail + calibration history timeline
/certificates                    # Certificates list (search, date range)
/certificates/$id                # Certificate detail (download, verification, traceability)
/requests                        # Calibration requests list
/requests/new                    # New request (delivery method + nota fiscal de remessa)
/requests/$id                    # Request detail
/service-orders                  # Maintenance / service orders list
/service-orders/$id              # Service-order detail — routed by opaque public_id
/settings/appearance             # Theme
```

## Key features

- **Command center dashboard** — overdue/due-soon equipment, certificates ready,
  quotes awaiting your approval, in-progress work, recent activity. Powered by
  `GET /api/portal/overview`.
- **⌘K global search** across equipment and certificates.
- **Calibration status everywhere** — overdue / due-soon / scheduled / unscheduled,
  with deep-linkable filters.
- **Certificates** — view, download, public verification link, and an explicit
  "payment pending" release state.
- **Calibration requests** — create for one or more assets, including a delivery
  method and the _nota fiscal de remessa para conserto_ when shipping via carrier.
- **Service orders** — track the repair: diagnostics, parts used / execution,
  status timeline, seals (incl. Inmetro), warranty; approve/reject quotes.
- Cloud-only (the portal is not part of the desktop/offline split).

## Tech stack

React 19 · Vite · TanStack Router / Query / Table · Tailwind CSS v4 ·
[`@base-ui/react`](https://base-ui.com) primitives · HugeIcons · `motion` ·
`cmdk` · Figtree (sans) + Geist Mono (mono).

## Scripts

```bash
pnpm dev          # Dev server (:5174)
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm lint         # oxlint
pnpm check-types  # native tsc (typescript@7) type-check
pnpm test         # Vitest
```

## Project structure

```
src/
├── routes/            # Thin TanStack file-based route adapters (createFileRoute, loaders, search)
├── features/          # Feature modules (e.g. dashboard/): pages, queries, types, components
├── components/
│   ├── instrument-panel.tsx   # The shared "metrology console" design system
│   ├── status-pill, timeline, page-header, command-menu, …
│   └── ui/            # base-ui primitives (button, card, dialog, checkbox, …)
├── lib/               # calibration-status, status-labels, format, platform, utils
└── hooks/             # use-mount-effect, use-mobile
```
