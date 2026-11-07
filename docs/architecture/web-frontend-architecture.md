# Web Frontend Architecture

This document defines the architecture rules for `apps/web`. The target shape is
feature-first React with thin TanStack routes, explicit package boundaries, and
schema-first validation for regulated workflows.

## Goals

- Keep route files predictable and small.
- Keep domain implementation close to domain tests and types.
- Prevent frontend code from depending on API server implementation files.
- Preserve desktop/cloud behavior while centralizing runtime decisions.
- Make validation, telemetry, and accessibility rules explicit.

## Directory Responsibilities

```txt
apps/web/src/
  app/
    config/          # Runtime config, env flags, telemetry switches
    router/          # Route metadata consumed by nav/guards/prewarm
  routes/            # Thin TanStack route adapters only
  features/          # Domain pages, layouts, forms, queries, models, types
  shared/            # Cross-domain API/form helpers
  components/        # App-level components; shadcn primitives, instrument-panel and
                     # status-tone come from @calibra-facil/ui (packages/ui)
  hooks/             # Generic React hooks
  lib/               # Generic utilities and route helpers
  runtime/           # Desktop/offline/sync runtime concerns
```

Routes import features. Features may import shared helpers, components, hooks,
schemas, and client-runtime. Shared/app/runtime modules must not import feature
modules unless they are explicitly composing the application shell.

Layering is enforced: `components/`, `lib/`, `utils/` and `hooks/` are low layers
that depend on nothing above them, so they never import `features/*`
(`calibra/no-features-import-from-low-layers`, empty baseline). A piece that a
low layer and several features share (the dashboard scope storage, the weighing
range helpers) lives in the low layer. A file that needs a feature is part of
that feature: the dashboard shell chrome (sidebar, header, user menu) is under
`features/dashboard/components`, the command palette under `features/command-palette`,
the method builder and method runtime under `features/methods/{builder,runtime}`,
the finance status badges under `features/finance/components`. Route prewarm
(`app/router/route-prewarm.ts`) is part of the route registry, not a helper.

## Thin Route Contract

Files under `apps/web/src/routes` are navigation adapters. They may contain:

- `createFileRoute(...)`
- `beforeLoad`, `loader`, `head`, and route metadata wiring
- search validation
- small wrappers that read `Route.useParams()` or `Route.useSearch()` and pass
  explicit props into a feature component
- redirects required by the route path

Routes should not contain product UI, table columns, mutation workflows, form
schemas, or domain-specific parsing. If a route file grows beyond adapter code,
move the implementation to `apps/web/src/features/<domain>`.

Do not add new dashboard route-local `-components`, `-index.data.ts`, or
`-index.db.ts` files. Use a feature module instead.

Every renderable dashboard page route must define `head` metadata with a page
title. Layout `route.tsx` files and redirect-only adapters are exempt. The
guard in `apps/web/src/app/router/dashboard-route-heads.test.ts` enforces this,
so update the route head or the explicit redirect-only exemption when dashboard
routes are added, renamed, or converted between redirect and page behavior.

## Feature Modules

Feature folders own domain behavior:

```txt
features/jobs/
  list-page.tsx
  detail-page.tsx
  queries.ts
  forms.ts
  types.ts
  components/
  *.test.ts
```

Production feature modules should not call `createFileRoute`, `Route.use*`,
`useParams`, or `useSearch`. Route params and search state should be normalized
at the route boundary and passed into features through props or loader inputs.

Router behavior that a feature needs beyond params/search (for example
blocking navigation while a form holds unsaved work) is injected by the route
adapter as a component prop, not imported into the feature. The execution page
takes `UnsavedChangesGate` (`apps/web/src/lib/unsaved-changes-gate.tsx`); the
route passes `TanStackUnsavedChangesGate`, tests pass a fake, and the default is
a no-op gate.

Recommended file roles:

- `*-page.tsx` and `*-layout.tsx`: route-rendered feature UI.
- `keys.ts`: the feature's query-key factory (see "Query Keys and Tenant Scope").
- `queries.ts`: React Query options, loaders, and domain data hooks.
- `forms.ts`: UI-to-payload parsing and schema-backed validation.
- `types.ts`: feature DTO/view-model types.
- `components/`: domain-local reusable UI.
- `*.test.ts(x)`: focused tests next to the behavior they protect.

## API and Client Runtime

Frontend code must not import `@calibra-facil/api` or `apps/api/*`. Use
`@calibra-facil/client-runtime` and `@calibra-facil/contracts`.

Raw Hono RPC usage belongs inside `packages/client-runtime`. Web features should
call product-level methods such as:

```ts
calibraApi.jobs.approve(input);
calibraApi.nonConformances.create(input);
calibraApi.methods.create(input);
```

When adding API behavior:

1. Add or update the endpoint definitions (`packages/contracts/src/endpoints/<domain>.ts`);
   add a `packages/client-runtime/src/modules/<domain>.ts` only for client logic the
   definitions cannot express.
2. Reuse shared transport helpers from `packages/client-runtime/src/transport`.
3. Keep public exports compatible through `packages/client-runtime/src/index.ts`.
4. Add client-runtime tests for success and error paths.

See `docs/architecture/api-client-contract.md` for the package boundary rules.

## Query Keys and Tenant Scope

Every TanStack Query key comes from a factory, never from a literal array.
Each feature owns `features/<domain>/keys.ts` (`assetKeys`, `customerKeys`, ...):
`all` is the broadest prefix, `list(input)` / `detail(id)` / ... build full keys,
and `listScope(organizationId)` is the leading part of `list` that
`keepPreviousDataInScope` compares. The factory is the single source of the key
shape: the query (`queryKey: customerKeys.detail(id)`), every invalidation
(`invalidateQueries({ queryKey: customerKeys.all })`), `setQueryData` and
`useIsFetching` use the same call, so a reshaped key moves them all together.
A feature that must refresh another feature's data imports that feature's
factory (`@/features/assets/keys`); it never retypes the array. Code in the low
layers (`lib`, `hooks`) that must share a key puts it in `lib/query-keys.ts`.
Cross-feature fan-out for one event lives in one map, for example
`features/jobs/query-effects.ts` (job approved: jobs, dashboard, assets,
service orders, notifications, finance).

`calibra/no-literal-query-keys` fails a literal array passed as `queryKey`, to
`setQueryData` / `getQueryData` and the other cache methods, or to
`keepPreviousDataInScope`, in `apps/web/src/features` and `apps/portal/src`
(tests exempt, baseline empty).

Tenant scope has one mechanism, a guaranteed cache reset. The API resolves the
laboratory and unit from the session and from `x-active-unit-id`, so an
organization id inside a key could not make a request answer for it. Every code
path that changes the active organization or unit goes through
`apps/web/src/lib/switch-scope.ts` (`switchActiveOrganization`, `switchScope`),
which cancels in-flight requests, applies the switch and resets all queries;
`organization.setActive` is called nowhere else (a test enforces it). Sign-out
and organization deletion call `queryClient.clear()`. The portal, whose keys are
built from `portalQueryKey(organizationId, ...)`, keeps the organization in the
key as well.

Known gap, left on purpose: a second tab of the lab app does not hear that
another tab changed the session's organization or unit. The app has no
cross-tab signal to hook the reset into (no `storage` or `BroadcastChannel`
listener in `apps/web`, `refetchOnWindowFocus` is off for the session, and Better
Auth's own `storage`-based broadcast carries `session` events for its session
atom and is not connected to the query cache). The tab keeps the
old organization's cached data until it refetches. Adding a `storage` listener on
the stored dashboard organization/unit keys (written on every switch) and calling
the same reset would close it; that is a new signal, so it is a product decision.

## Runtime Config and Dashboard Scope

Web runtime constants and environment flag parsing live in
`apps/web/src/app/config/runtime.ts`.

This includes:

- cloud/local API defaults
- desktop local API fallback
- dashboard localStorage keys

Dashboard organization and unit storage is centralized in
`apps/web/src/lib/dashboard-scope-storage.ts`. New code should not
read or write `dashboard-active-org` or `dashboard-active-unit:*` directly.

The `x-active-unit-id` header, route preloading, and dashboard shell should all
use the storage helper so they cannot drift.

## Route Metadata

Sidebar, cloud-only state, access checks, and route prewarm should use
`apps/web/src/app/router/route-meta.ts` where possible. Avoid duplicating the
same path rules in navigation components and runtime guards.

When adding or renaming a dashboard route, check whether it needs metadata for:

- navigation visibility
- cloud-only blocking in desktop/offline mode
- role requirements
- prewarm eligibility
- page `head` title metadata

## Forms and Validation

Regulated workflows should be schema-first. Prefer schemas from
`@calibra-facil/schemas` for API payload validation and feature `forms.ts`
helpers for UI state normalization.

Examples:

- NC and CAPA creation validate final payloads with quality schemas.
- Asset, services, standards, jobs, customers, and personnel forms keep parsing
  and defaults in feature-level form modules.
- Shared form UI and validation helpers live in `apps/web/src/shared/forms`.

Avoid validating only in JSX event handlers. Put parsing and validation in
testable functions when the workflow affects compliance, certificates,
calibration execution, or billing.

## Dashboard Shell

The dashboard shell is split into focused modules under
`apps/web/src/features/dashboard`:

- session/auth redirect logic
- organization bootstrap and active org persistence
- shell layout composition
- access/onboarding/restricted states
- performance marks
- scope storage

The route file at `routes/dashboard/route.tsx` should remain a small TanStack
route declaration that wires the extracted shell to `/dashboard`.

Preserve behavior for:

- web and desktop sessions
- `/sign-in` redirects
- LAB organization filtering
- no-organization onboarding state
- client-only restricted state
- cloud-only blocking in desktop/offline mode
- command palette, sidebar, header, unit banner, and outlet layout

## Telemetry and Privacy

The web runtime has no third-party telemetry: no error-tracking SDK, no session
replay, no default PII collection. Errors stay in the browser console (and, on
the server, in structured logs).

Router boundaries (`app/router/route-boundaries.tsx`: default error, pending and
not-found components) report render and loader crashes through `defaultOnCatch`
-> `reportClientError` (`@calibra-facil/shared/client-error`, shared with the portal), a structured
`console.error` line with no third-party SDK.

Paginated list query options pass `placeholderData:
keepPreviousDataInScope([...])` (`@calibra-facil/shared/query-scope`) so paging never
flashes the skeleton, scoped so rows never carry across an organization switch.

Do not expose session tokens through React context unless a real consumer
requires it and the exposure is documented.

## Accessibility

Shared primitives should preserve semantic behavior. For tables:

- clickable rows must be keyboard-activatable
- nested interactive controls must not accidentally trigger row navigation
- row-click behavior should be covered by tests when it is used

For forms:

- labels must be associated with controls
- errors should be connected through `aria-describedby`
- invalid state should be exposed with `aria-invalid`

## Validation Checklist

For frontend architecture changes, run the relevant focused tests and at least:

```bash
pnpm --dir apps/web check
pnpm --dir apps/web test
pnpm --dir apps/web build
pnpm check-types
pnpm lint
```

When the change touches login, redirects, dashboard bootstrap, desktop/cloud
runtime behavior, certificate download/issue flows, sync conflicts, or method
execution, add or update a browser-level Playwright spec under
`apps/web/e2e` and run:

```bash
pnpm --dir apps/web test:e2e
```

For cross-package changes, also run:

```bash
pnpm --dir packages/client-runtime test
pnpm turbo test
```

The core boundary rules are enforced deterministically by `pnpm lint` via the
custom oxlint plugin (`packages/oxlint-plugin-calibra`, prefix `calibra/`):

- `calibra/no-api-import-in-frontend` — no `@calibra-facil/api` / `apps/api/*`
  imports from `apps/web` or `apps/portal`;
- `calibra/no-router-coupling-in-features` — no `createFileRoute` / `useParams`
  / `useSearch` imports inside `apps/web/src/features` (test files exempt);
- `calibra/no-literal-query-keys` — query keys come from the key factories, never
  a literal array, in `apps/web/src/features` and `apps/portal/src`.

Each rule has a `LEGACY_BASELINE` ratchet for grandfathering (all empty today).
For the residual patterns the lint rules do not cover (route-local
`-components` imports, `Route.use*` member access), a pre-PR scan still helps:

```bash
rg -n -g '*.ts' -g '*.tsx' -- "from './-components|from '../-components|routes/dashboard/.*/-components|\\bapi\\.api\\.|apiFetch\\(" apps/web packages/contracts
rg -n -g '*.ts' -g '*.tsx' -g '!*.test.ts' -g '!*.test.tsx' -- "Route\\.use|from ['\\"]\\.\\/route['\\"]|from ['\\"]\\.\\.\\/route['\\"]" apps/web/src/features
```

Both scans should be empty unless the match is intentional and documented.
