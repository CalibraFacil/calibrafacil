# Portal Frontend Architecture

This document defines the architecture rules for `apps/portal` — the client-facing
portal that calibration-lab customers use to track calibration status, retrieve
certificates, request calibrations, and follow instruments in for repair.

The portal is a Vite SPA (React 19 + TanStack Router/Query). It is smaller and
narrower than `apps/web`, but it shares the same design language and the same
package-boundary discipline. Read `docs/architecture/web-frontend-architecture.md`
for the dashboard rules — this doc covers what is **specific to the portal**.

## Goals

- Reuse the main app's **instrument-panel** design system — never reintroduce
  generic shadcn cards or invent a parallel aesthetic.
- Keep the portal a thin, cookie-authenticated client over a narrow `/api/portal/*`
  surface, with no dependency on API server implementation files.
- Move page implementations into feature modules as they grow, mirroring `apps/web`.
- Speak the customer's language: copy is pt-BR, status is shown through a single
  semantic tone vocabulary, and identifiers in URLs are opaque.

## Directory Responsibilities

```txt
apps/portal/src/
  routes/            # TanStack file-based routes (route tree). Public + _authenticated
    _authenticated/  # Cookie-gated app shell + pages
    v/               # Public certificate verification (/v/$token)
    service-order-access/  # Public service-order view (/service-order-access/$token)
  features/          # Extracted domain modules (page + queries + types + components + tests)
  components/        # Shared components: instrument-panel, status-pill, timeline, command-menu…
    ui/              # base-ui primitives (button, card, dialog, checkbox, tabs…)
  lib/               # calibration-status, status-labels, format, platform, utils (getApiBaseUrl)
  hooks/             # use-mount-effect, use-mobile
```

### Routes and feature modules

The portal is **partially feature-first**. The mature pattern — already used by
`features/dashboard/` and `features/service-orders/` — extracts page UI, its
TanStack Query hooks (`queries.ts`), view-model `types.ts`, and tests into a
feature module, leaving the route file as a thin adapter.

Several route files under `routes/_authenticated/` still hold their own data
fetching and page UI inline. That is the current reality, not the target: when a
page grows past a simple read (multiple queries, mutations, non-trivial parsing),
extract it into `features/<domain>/` rather than expanding the route file. Do not
add route-local `-components` folders.

## Design System: instrument-panel

The portal's design system is the **instrument-panel** "metrology console" look,
ported from `apps/web/src/components/instrument-panel.tsx` into
`apps/portal/src/components/instrument-panel.tsx`. It is **not** plain
`Card`/`Badge`. New surfaces compose these primitives:

- `Panel`, `PanelHeader` — the framed console surface and its header.
- `SignalTile` — a labelled metric tile keyed by tone.
- `BlueprintGrid`, `BlueprintField` — the blueprint-style key/value layout.
- `StaggerGroup`, `StaggerItem` — staggered enter animations (via `motion`).
- `InfoHint`, `ACTION_BUTTON_CLASS`, `PANEL_CLASS` — shared affordances.

Typography uses **Geist Mono** (`--font-mono`) for tabular numerics and **Figtree**
(`--font-sans`) for body. Numbers that update should use tabular figures so the
layout does not shift.

When in doubt, look at how the same shape is rendered in `apps/web` and match it.

## Status Vocabulary

All status is expressed through one tone vocabulary, `SignalTone`:

| Tone       | Color       | Meaning                        |
| :--------- | :---------- | :----------------------------- |
| `ok`       | emerald     | scheduled / healthy / released |
| `critical` | destructive | overdue / breached / rejected  |
| `warning`  | amber       | due soon / attention           |
| `info`     | primary     | in progress / informational    |
| `neutral`  | muted       | unscheduled / inert            |

- `lib/calibration-status.ts` — `getCalibrationStatus(nextCalibrationDate, now?)`
  returns `{ status, tone, label, daysDelta, description }`
  (OVERDUE→critical, DUE_SOON→warning, SCHEDULED→ok, UNSCHEDULED→neutral;
  `DUE_SOON_DAYS = 30`). It also exports the deep-linkable `CALIBRATION_FILTERS`.
  It is unit-tested (`calibration-status.test.ts`) — keep it pure and testable.
- `lib/status-labels.ts` — request and service-order status → label + `SignalTone`.
- `components/status-pill.tsx` — the `TONE` class map + `StatusPill`, keyed by
  `SignalTone`, used everywhere a status renders.

Do not introduce ad-hoc color choices for status; map to a tone instead.

## Data and Transport

The portal does **not** use `@calibra-facil/client-runtime` and must **never**
import `@calibra-facil/api` or `apps/api/*`. It talks to a narrow, cookie-
authenticated `/api/portal/*` surface with raw `fetch`, wrapped in TanStack Query:

```ts
const response = await fetch(`${getApiBaseUrl()}/api/portal/overview`, {
  credentials: "include", // session cookie — the portal has no token plumbing
});
if (!response.ok) throw new Error("Falha ao carregar o painel");
return response.json();
```

- `getApiBaseUrl()` (`lib/utils.ts`) resolves the API origin per host
  (localhost:3000 in dev, `dev-*.calibrafacil.com` same-origin, else
  `api.calibrafacil.com`). Always go through it; never hardcode the origin.
- Wrap reads in `useQuery` with a stable `queryKey` and a sensible `staleTime`.
- The dashboard is powered by `GET /api/portal/overview` (an aggregation endpoint
  in `apps/api/src/routes/portal.ts`) via `features/dashboard/queries.ts:useOverview`;
  the sidebar badges reuse the same hook so counts cannot drift.
- The server redacts what customers must not see — e.g. the portal service-order
  endpoints return client-visible projections, and the assets list accepts a
  portal-local `dueStatus` filter without touching the shared list schema.

## Opaque Identifiers

Customer-facing URLs should not leak the lab's internal sequence. Service orders
are routed by an opaque `public_id` (uuid): the portal SO endpoints resolve it via
`resolvePortalServiceOrderIdByPublicId(publicId, customerId)` (scoped to the
customer) before touching the serial id, and the overview/list payloads carry
`publicId` so links never expose the numeric id.

Not every entity is opaque yet — asset, calibration-request, and certificate detail
routes still use serial ids. When making a new entity addressable from the portal,
prefer an opaque public id (`gen_random_uuid()` column + a scoped resolver).

## Page Shell and Large-Monitor Layout

Every page root uses one of two shells defined in `styles.css`:

- `.portal-shell` — lists and dashboards.
- `.portal-shell-sm` — focused detail pages and forms.

Both center and cap content, then **progressively widen** on large monitors so the
portal is not stranded in a thin column on FHD+/ultrawide displays
(`1536px → 1920px → 2400px` tiers). The `3xl` (1920px) and `4xl` (2560px)
breakpoints are declared in the `@theme` block.

> Tailwind v4 `@theme` changes (new breakpoints, fonts) are **not** picked up by
> HMR — restart the dev server after editing them.

The authenticated shell lives in `routes/_authenticated/route.tsx`; `SidebarInset`
carries `min-w-0 overflow-x-hidden` so the inset frame keeps its rounded corners.

## Repo Guards (apply here too)

- **`useEffect` is banned.** Use derived state, event handlers, data hooks, keyed
  remounts, or `@/hooks/use-mount-effect`.
- **`as` type assertions are banned** (oxlint `consistent-type-assertions`). Use
  type guards, `satisfies`, or schema parsing. Where a single narrowing is
  genuinely unavoidable, isolate it behind an `oxlint-disable` with a reason.
- base-ui primitives use the `render` prop, not `asChild`.
- OS-aware shortcut hints: render `⌘K` / `Ctrl K` via `lib/platform.ts`
  (`shortcutLabel`), never a hardcoded `⌘`.
- Copy is **pt-BR**.

## Scope

The portal is **cloud-only** — it is not part of the desktop/offline split, so
there is no `runtime/` cloud-vs-desktop logic here. Do not add SQLite/outbox/sync
concerns to this app.

## Validation Checklist

For portal changes, run:

```bash
pnpm --dir apps/portal check        # prettier --write + oxlint --fix
pnpm --dir apps/portal test
pnpm --dir apps/portal build
pnpm check-types
pnpm lint
```

When the change touches a `/api/portal/*` endpoint, also run the API tests:

```bash
pnpm --dir apps/api test:run
```

Before opening a PR, confirm the boundary holds — this scan should be empty:

```bash
rg -n -g '*.ts' -g '*.tsx' -- "from ['\"]@calibra-facil/api|from ['\"]apps/api" apps/portal
```
