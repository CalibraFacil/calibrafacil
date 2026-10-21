# API Client Contract Boundary

The client-facing API contract must stay separate from the API implementation
so frontend packages do not pull server runtime code, database access, worker
bindings, or route handler dependencies into their type graph.

## Package Boundaries

- `apps/api` owns the Hono HTTP server, middleware, route handlers, auth, DB
  access, and deployment/runtime concerns.
- `packages/contracts` owns stable client-facing DTOs and API-facing TypeScript
  contract types.
- `packages/client-runtime` owns cloud/desktop transport, raw Hono RPC usage,
  response handling, runtime switching, and product-level SDK methods.
- Frontend apps should call product-level SDK methods from `client-runtime`, not
  raw Hono RPC paths.

`packages/client-runtime` is organized as a public facade plus domain modules.
The public API should remain stable from `src/index.ts`, while domain
implementation details live under `src/modules/*` and shared transport helpers
live under `src/transport/*`.

## `AppType`

`packages/contracts/src/api-app.ts` exports the Hono `AppType` consumed by
browser-facing raw clients such as `createRawCloudClient<AppType>()`.

Rules:

- Never use `export type AppType = any`.
- Never import `createApiApp`, `app`, or any `apps/api/*` module from
  `packages/contracts`.
- Keep `AppType` server-free: it may import Hono types and contract DTOs, but
  not API route handlers or server runtime modules.
- When a raw browser-facing Hono route is added, removed, or renamed, update the
  route path list in `packages/contracts/src/api-app.ts` in the same PR.

The current `AppType` intentionally describes the public browser RPC surface in
`packages/contracts` instead of deriving it from `apps/api`. This gives clients
route and path-param checking without re-coupling frontend packages to server
implementation files.

## Why Not Import `typeof app` From `apps/api`?

Hono RPC examples often export a server app type and import it in the client.
That is fine for small apps, but in this monorepo it breaks the desired package
boundary. A type-only import from `apps/api` still makes TypeScript resolve API
route modules and their dependencies. That can drag in server-only concepts such
as Cloudflare bindings, database modules, email JSX configuration, worker code,
and deployment-specific runtime assumptions.

For this codebase, `contracts -> apps/api` is the wrong dependency direction.
The server may depend on shared contracts, but contracts must not depend on the
server implementation.

## Change Checklist

When changing API/client boundaries:

1. Keep frontend imports pointed at `@calibra-facil/client-runtime` and
   `@calibra-facil/contracts`.
2. Keep raw Hono RPC calls inside `packages/client-runtime`.
3. Add or update a domain module in `packages/client-runtime/src/modules/*`
   instead of calling `api.api.*` from web routes or features.
4. Reuse `readJson`, `readApiError`, `ensureOk`, and form-data helpers from
   `packages/client-runtime/src/transport/*` for response/error handling.
5. Update `packages/contracts/src/api-app.ts` if the browser-facing raw route
   surface changes.
6. Run `pnpm --filter @calibra-facil/contracts check-types`.
7. Run `pnpm check-types` before pushing.

Rules 1 and 2 are enforced deterministically by `pnpm lint` via the custom
oxlint plugin (`packages/oxlint-plugin-calibra`):
`calibra/no-api-import-in-frontend` and
`calibra/no-hono-client-outside-client-runtime`. Each rule carries a
`LEGACY_BASELINE` ratchet for grandfathering existing violations (empty today).

## Domain errors and stable codes

Clients must be able to branch on a failure without parsing pt-BR text, so
every domain failure carries a stable `code`.

- **The registry** is `API_ERROR_CODES` in `packages/contracts/src/api-errors.ts`
  (one file, a closed TypeScript union exported as `ApiErrorCode`; the response
  body type is `ApiErrorBody = { error, code, details? }`). Codes are
  snake_case and never reused for another meaning. `JOB_STATUS_CONFLICT` is the
  single documented legacy upper-case code, kept because clients already ship
  against it.
- **Server side:** new endpoints **throw `DomainError`** (`invalid`, `unauthenticated`,
  `forbidden`, `notFound`, `conflict`, `unprocessable` in
  `apps/api/src/lib/domain-errors.ts`); **never `c.json({ error })` for a domain
  failure**. `applyErrorHandling` maps the thrown error once to
  `{ error, code, details? }` with its status; it is not reported to Sentry
  unless the status is 5xx. Where a handler runs without the app-level error
  hook (a bare sub-router in a test) or must `return`, use
  `return domainErrorResponse(c, error)` — same body. `error` stays the pt-BR
  text; structured context goes in `details` (JSON-safe). `legacyBody` exists
  only to keep top-level fields of pre-registry responses (`currentStatus`).
- **Public API v2** keeps its `{ error: { code, message, details } }` envelope;
  `buildPublicApiError` takes an `ApiErrorCode`, so v2 and the internal API
  share the registry.
- **Client side:** `CalibraApiError.code` (`packages/client-runtime`) carries the
  code when the response body has a known one. Branch on `error.code`, not on
  `error.message`.
- **Guard:** the `calibra/no-json-error-body-in-routes` oxlint rule flags
  `c.json({ error ... })` in `apps/api/src/routes`. Existing sites are
  grandfathered as exact per-file counts in the rule's `LEGACY_BASELINE`; a file
  can never gain one. When you migrate a site, lower that file's count in the
  same change.
