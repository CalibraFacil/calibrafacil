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
  components/        # Shared components and UI primitives
  hooks/             # Generic React hooks
  lib/               # Generic utilities and route helpers
  runtime/           # Desktop/offline/sync runtime concerns
```

Routes import features. Features may import shared helpers, components, hooks,
schemas, and client-runtime. Shared/app/runtime modules must not import feature
modules unless they are explicitly composing the application shell.

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

Recommended file roles:

- `*-page.tsx` and `*-layout.tsx`: route-rendered feature UI.
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

1. Add or update the relevant `packages/client-runtime/src/modules/<domain>.ts`.
2. Reuse shared transport helpers from `packages/client-runtime/src/transport`.
3. Keep public exports compatible through `packages/client-runtime/src/index.ts`.
4. Update `packages/contracts/src/api-app.ts` only when raw browser-facing Hono
   route paths change.
5. Add client-runtime tests for success and error paths.

See `docs/architecture/api-client-contract.md` for the package boundary rules.

## Runtime Config and Dashboard Scope

Web runtime constants and environment flag parsing live in
`apps/web/src/app/config/runtime.ts`.

This includes:

- cloud/local API defaults
- desktop local API fallback
- dashboard localStorage keys
- Sentry DSN, PII, and replay flags
- route prefixes eligible for replay when replay is explicitly enabled

Dashboard organization and unit storage is centralized in
`apps/web/src/features/dashboard/dashboard-scope-storage.ts`. New code should not
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
- plan or role requirements
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
- backoffice redirects
- LAB organization filtering
- no-organization onboarding state
- client-only restricted state
- cloud-only blocking in desktop/offline mode
- command palette, sidebar, header, unit banner, and outlet layout

## Telemetry and Privacy

Sentry may initialize in production web runtime, but privacy-sensitive behavior
must be explicit:

- `sendDefaultPii` defaults to `false`.
- session replay defaults to disabled.
- replay only runs when the explicit env flag is enabled and the route prefix is
  eligible.
- desktop runtime must not initialize browser Sentry.

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

For cross-package changes, also run:

```bash
pnpm --dir packages/client-runtime test
pnpm turbo test
```

Before opening a PR, scan for boundary regressions:

```bash
rg -n -g '*.ts' -g '*.tsx' -- "from './-components|from '../-components|routes/dashboard/.*/-components|\\bapi\\.api\\.|apiFetch\\(|from ['\\\"]@calibra-facil/api|from ['\\\"]apps/api|@calibra-facil/api" apps/web packages/contracts
rg -n -g '*.ts' -g '*.tsx' -g '!*.test.ts' -g '!*.test.tsx' -- "createFileRoute|Route\\.use|useParams|useSearch|from ['\\\"]\\.\\/route['\\\"]|from ['\\\"]\\.\\.\\/route['\\\"]" apps/web/src/features
```

Both scans should be empty unless the match is intentional and documented.
