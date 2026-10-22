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
  `{ error, code, details? }` with its status; it is not reported as an error
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

## Typed, validated responses (response contracts)

Request payloads were already schema-derived. Responses used to be trusted:
`client-runtime` cast every body (`assumeClientResponse<T>`), pages passed
hand-written generics (`jobs.get<TJob>()`), and the portal read `fetch(...).json()`
as `any`. Response contracts replace that, one domain at a time.

**The pattern (one schema, three guards):**

1. **Schema.** `packages/contracts/src/<domain>.ts` holds Zod _wire_ schemas for
   the responses and exports the inferred types (`JobDetail`, `JobsListResponse`,
   `PortalOverviewResponse`, ...). Rules: validate only (no `.default()`,
   `.transform()`, `.coerce`), unknown keys allowed, timestamps are ISO strings,
   nullable/optional exactly as the handler returns them. Written from what the
   handler returns today, never the reverse.
2. **Server: compile time.** The handler types its response with
   `body satisfies ServerShape<JobDetail>` (`ServerShape` lets a `Date` stand
   where the wire has an ISO string and keeps literal unions exact). A handler
   change that breaks the shape fails `pnpm check-types`.
3. **Client: run time.** `client-runtime` modules validate with
   `readValidatedJsonResponse(response, schema, { endpoint, fallback })`; the
   portal uses `fetchPortalJson(path, schema, { errorMessage })`
   (`apps/portal/src/lib/api-fetch.ts`). Both call `validateResponsePayload`
   from contracts. A valid payload is returned as-is (same object, every key the
   server sent, so frozen evidence is never rewritten); call sites get inferred
   types and no generic.
4. **CI: contract test.** An int spec calls the real route (real middleware, real
   Postgres) and `safeParse`s the body with the same schema:
   `apps/api/src/routes/jobs-contract.int.spec.ts`,
   `portal-overview-contract.int.spec.ts`. Drift between the handler's runtime
   values (including the JSON snapshot columns) and the schema fails CI.
   `packages/contracts/src/jobs.fixtures.ts` has contract-valid payloads for unit
   tests in any package.

**Mismatch policy** (`ResponseValidationMode`):

- `strict` (default; development and tests): throw `ResponseContractError`
  (endpoint + failing paths) so drift fails where it is introduced.
- `warn` (production): never break the UI. One structured JSON warning
  (`tag: "response-contract"`, endpoint, paths and codes, never response values:
  they can be customer data) and the payload is returned as received.
  The web app selects it with `import.meta.env.PROD` (or an explicit
  `VITE_RESPONSE_VALIDATION=warn`). The portal helper is `strict` everywhere
  except production. Nothing in the test suites opts out: the mocked-API
  Playwright specs and the component unit tests serve contract-valid bodies
  built from the shared fixtures (`@calibra-facil/contracts/jobs-fixtures`,
  `packages/contracts/src/jobs.fixtures.ts`). Every exported fixture builder is
  parsed against its schema in `packages/contracts/src/fixtures.test.ts`, so a
  fixture cannot drift from the contract it stands in for.

**Covered so far:** jobs domain (`GET /api/jobs`, `GET /api/jobs/:id`, the
execute/submit/approve/reject/cancel/assign mutation responses, amend,
technicians list, certificate/label download links, `POST /api/jobs` create,
`flag-oot`, `generate-label`), `GET /api/portal/overview`, standards (list,
detail, create, update, composition profiles, certificate document upload and
download) and environmental limits (list, save, delete, effective lookup).
`client-runtime` validates all of these.

**Reference data and service orders** (customers, assets, asset types, methods,
service orders: `packages/contracts/src/reference-data.ts`,
`service-orders.ts`) have response schemas that the API contract spec
(`reference-data-contract.int.spec.ts`) checks against the real cloud routes,
with `satisfies ServerShape<...>` at the handlers. `client-runtime` does not
validate them at run time yet.

**Desktop parity.** The desktop local-server (SQLite mirror) answers the offline
routes with the SAME schemas the cloud is held to:
`apps/local-server/src/contract.test.ts` parses every offline route (jobs reads,
execution save/submit, attachments, environmental limits, service-order
create/list/get, asset create/list/get, asset types, customers / standards /
methods reads, sync) with them. Where the mirror legitimately keeps less than
the cloud, the test names the exact missing fields (`JOB_DETAIL_GAPS`: review
trail, amendment chain, as-found verdict, letterhead, commercial terms) and
fails when that set changes in either direction; the schema itself is never
loosened to fit the mirror. Execute/submit are typed by the common core
`jobExecutionResponseSchema` because the local job read model has no cloud-only
columns (`verificationToken`, signature data).

**Opaque by design, for now:** `methodSnapshot.compiledMethod` is `unknown` in the
job schema because the database column is; the worksheet reads it through
`compiledMethodSnapshotSchema.safeParse` (see `readCompiledMethodSnapshot` in
`apps/web/src/features/jobs/execution.ts`).

**Follow-ups (remaining domains, in rough priority):** run-time validation of
the reference-data and service-order responses in `client-runtime`; the
desktop transport (`desktop-client.ts`) still reads local-server bodies with
`readDesktopJson<T>`, unvalidated (the local-server contract tests pin the
shapes instead); services; quality (NC/CAPA); finance; reports; and the
hand-written `*Data` DTOs left in `packages/client-runtime/src/types.ts`. New
endpoints should start with a schema in contracts rather than a generic.
