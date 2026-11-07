# API Client Contract Boundary

The client-facing API contract must stay separate from the API implementation
so frontend packages do not pull server runtime code, database access, worker
bindings, or route handler dependencies into their type graph.

## Package Boundaries

- `apps/api` owns the Hono HTTP server, middleware, route handlers, auth, DB
  access, and deployment/runtime concerns.
- `packages/contracts` owns stable client-facing DTOs and the endpoint
  definitions (`ENDPOINT_GROUPS`).
- `packages/client-runtime` owns cloud/desktop transport, response handling,
  runtime switching, and product-level SDK methods.
- Frontend apps should call product-level SDK methods from `client-runtime`, not
  raw HTTP paths.

`packages/client-runtime` is organized as a public facade plus transport helpers.
The public API stays stable from `src/index.ts`. Every endpoint group is its own
client (`endpointClients(ENDPOINT_GROUPS, ...)`); a file under `src/modules/*`
exists only for a domain whose client adds logic to its group (a 404 that is a
result, a multipart upload, an unwrapped envelope). Shared transport helpers
live under `src/transport/*`.

## The route list

There is no hand-kept route list: the browser-facing routes are the endpoint
definitions in `packages/contracts/src/endpoints/*`. The API mounts a handler
against each definition and `apps/api/src/server/api-app-routes.spec.ts` checks
that every definition is served at its method and path. A route renamed on the
server while its definition stays fails that spec instead of 404ing in a client.

## Why Not Import `typeof app` From `apps/api`?

Hono RPC examples export a server app type and import it in the client. That is
fine for small apps, but in this monorepo it breaks the desired package
boundary. A type-only import from `apps/api` still makes TypeScript resolve API
route modules and their dependencies. That can drag in server-only concepts such
as runtime bindings, database modules, email JSX configuration, worker code,
and deployment-specific runtime assumptions.

For this codebase, `contracts -> apps/api` is the wrong dependency direction.
The server may depend on shared contracts, but contracts must not depend on the
server implementation.

## Change Checklist

When changing API/client boundaries:

1. Keep frontend imports pointed at `@calibra-facil/client-runtime` and
   `@calibra-facil/contracts`.
2. Keep the HTTP transport inside `packages/client-runtime`.
3. Declare the endpoint in `packages/contracts/src/endpoints/*` (see "Adding an
   endpoint"); add a domain module in `packages/client-runtime/src/modules/*`
   only for client logic the definition cannot express.
4. Reuse `readJson`, `readApiError`, `ensureOk`, and form-data helpers from
   `packages/client-runtime/src/transport/*` for response/error handling.
5. Run `pnpm --filter @calibra-facil/contracts check-types`.
6. Run `pnpm check-types` before pushing.

Rule 1 is enforced deterministically by `pnpm lint` via the custom oxlint plugin
(`packages/oxlint-plugin-calibra`): `calibra/no-api-import-in-frontend`. The rule
carries a `LEGACY_BASELINE` ratchet for grandfathering existing violations
(empty today).

## Adding an endpoint: one definition (converted domains)

A converted domain declares each client-facing endpoint **once**, in
`packages/contracts/src/endpoints/<domain>.ts`, and everything else is derived.
Customers is the reference (`endpoints/customers.ts`).

```ts
export const customerEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/customers",
    query: ListCustomersQuerySchema, // same schemas the server validates with
    response: customersListResponseSchema, // the wire body, from what the handler returns
    failure: "Falha ao carregar clientes", // CalibraApiError message when the body has no `error`
    policy: "local-first-read-through-sync",
  }),
  create: endpoint({
    method: "post",
    path: "/api/customers",
    body: CreateCustomerSchema,
    response: customerCreatedSchema,
    status: 201,
    failure: "Erro ao criar cliente",
    policy: "cloud-only",
    desktopLabel: "Clientes", // required for cloud-only: "Clientes requer a API web/nuvem ..."
  }),
} as const satisfies EndpointGroup;
```

What derives from it:

| Consumer      | How                                                                                                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API route     | `mount(router, "/api/customers", def, middleware, handler)` (`apps/api/src/lib/endpoint-mount.ts`): method + path, `zValidator` for `params`/`query`/`body`, the handler gets `{ params, query, body }` typed and returns the response (checked at compile time against `response`; parsed with it in development and tests). |
| SDK method    | `endpointClient(group, transport, options)` (`client-runtime/src/transport/endpoint-client.ts`): `(input) => Promise<z.infer<response>>`, input `{ params, query, body }` (each key only when the endpoint has it). Non-2xx is a `CalibraApiError`; a 2xx body is parsed with `response`.                                     |
| SDK namespace | `createCloudApiClient` spreads `endpointClients(ENDPOINT_GROUPS, ...)`: one client per group, and the `CalibraApi` type is computed from `ENDPOINT_GROUPS` the same way. A `modules/<ns>.ts` overrides it only where the client adds logic.                                                                                   |
| Data policy   | `calibraApiPolicyRegistry` spreads `endpointGroupPolicies(ENDPOINT_GROUPS)`: the `policy` of every definition.                                                                                                                                                                                                                |
| Desktop stubs | `desktopEndpointStubs()` throws for every `cloud-only` endpoint of every group with its `desktopLabel`; local-first methods are the group's own client over `createDesktopEndpointTransport` (the local server answers the same `response`).                                                                                  |
| Route drift   | `apps/api/src/server/api-app-routes.spec.ts` checks every definition is served at its method + path.                                                                                                                                                                                                                          |

The client portal's `/api/portal/*` surface is declared the same way
(`endpoints/portal.ts`, `endpoints/portal-engagement.ts`), as `PORTAL_ENDPOINT_GROUPS`
beside `ENDPOINT_GROUPS`, not inside it: the lab SDK, the policy registry and the
desktop stubs are computed from `ENDPOINT_GROUPS`, and none of them call the portal.
The portal calls the definitions through its own transport (`portalApi` in
`apps/portal/src/lib/portal-api.ts`, see `portal-frontend.md`); both clients build
the request from the definition with `buildEndpointRequest`.

To convert a domain:

1. Write the definitions (`endpoints/<domain>.ts`) and add the group to
   `ENDPOINT_GROUPS` in `endpoints/index.ts`, keyed by the `CalibraApi`
   namespace. Reuse the request schemas from `@calibra-facil/schemas`; write the
   response schemas from what each handler returns (wire rules above: validate
   only, unknown keys allowed). Move any existing response schema for the
   domain here. Add a `<domain>.fixtures.ts` (contract-valid builders, re-exported by `src/fixtures.ts`, parsed in
   a test) for tests in other packages.
2. API: replace the chained `.get(...)/.post(...)` of each client-facing route
   with `mount(...)`, return plain values (no `c.json`), keep `withLabPermission`
   as the `middleware` argument. A route nothing calls stays a plain Hono route
   (comment why). A status the definition does not describe (a 502 from an
   upstream) returns a `Response` from the handler.
3. client-runtime: nothing to wire. The group is a `CalibraApi` namespace, its
   client, its policies and its desktop stubs. Add `modules/<domain>.ts` only
   for genuine client logic (spread `endpointClient(group, ...)` and override
   that method, as `lookupCnpj` does for 404 to null), export its `<Domain>Api`
   type, add it to `ClientModules` in `types.ts` and to `createCloudApiClient`
   in `index.ts`. Replace the domain's hand DTOs in `types.ts` with `z.infer`
   aliases (`export type X = ContractX`).
4. Desktop: the local-first methods of the group are added in
   `transport/desktop-client.ts` from `endpointClient(group, createDesktopEndpointTransport(options), options)`
   (and any cloud-only method the desktop answers with a default, e.g. an empty
   list); the other cloud-only methods are stubbed already.
5. Callers: methods now take one object (`calibraApi.customers.get({ params: { id } })`),
   no generics (the response type is the schema's). Drop web/portal
   hand-written copies of the DTO in favour of the contract type.
6. Keep `apps/local-server/src/contract.test.ts` parsing the offline reads with
   `<domain>Endpoints.<name>.response`, and add an integration spec that parses
   the real route's body (as `reference-data-contract.int.spec.ts` does).

Path parameters: give the definition a `params` schema when the handler needs
more than a string (`params: z.object({ id: routeId })` for a numeric id): the
request is refused with 400 before the handler runs and the handler gets the
parsed value. Do not `parseInt(params.id)` in a handler.

Not yet in the definition: the route's permission (stays the `middleware`
argument of `mount`), and a response check in the SDK for domains that are not
converted.

## Domain errors and stable codes

Clients must be able to branch on a failure without parsing pt-BR text, so
every domain failure carries a stable `code`.

- **The registry** is `API_ERROR_CODES` in `packages/contracts/src/api-errors.ts`
  (one file, a closed TypeScript union exported as `ApiErrorCode`; the response
  body type is `ApiErrorBody = { error, code, details? }`). Codes are
  snake_case and never reused for another meaning. A few upper-case codes shipped
  before the registry and are kept because clients read them; six of them have a
  snake_case twin (the public API v2 sends it), listed in
  `LEGACY_API_ERROR_CODE_ALIASES`. `CalibraApiError.code` reports the canonical
  snake_case spelling for either.
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
   `readValidatedJsonResponse(response, schema, { endpoint, fallback })` (or the
   per-client `createValidatedReader(options)`); the portal goes through ONE
   module, `apps/portal/src/lib/api-fetch.ts`: `fetchPortalJson(path, schema,
{ errorMessage })` for a read or a mutation, `fetchPortalResponse` +
   `readPortalJson` / `readPortalJsonResult` when the HTTP status decides what
   to render (the public links), `fetchExternalJson` for the one external
   lookup. HTTP errors become a `PortalApiError` (status + body). All call
   `validateResponsePayload` from contracts. A valid payload is returned as-is
   (same object, every key the server sent, so frozen evidence is never
   rewritten); call sites get inferred types and no generic. The
   `calibra/no-unparsed-portal-fetch` oxlint rule fails any `fetch(...)` or
   `.json()` under `apps/portal/src` outside that module (empty baseline).
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
  built from the shared fixtures (`@calibra-facil/contracts/fixtures`,
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

**The client portal** (`packages/contracts/src/portal*.ts`, `public-access.ts`):
every `/api/portal/*` response the portal reads (branding, organizations, units,
calendar, fleet, asset detail, interval insight/update, certificates and their
downloads, audit packs, notifications and preferences, out-of-tolerance notices
and events, drift series, fleet analytics, visits, requests, service orders,
financial summary, quote decisions), the public verification endpoints, the
invitation lookup and the magic-link preview. The handlers return
`satisfies ServerShape<...>`; `portal-contract.int.spec.ts` and
`portal-engagement-contract.int.spec.ts` parse the real responses. A few
customer-scoped success paths (request detail/batch, service orders, OOT
acknowledge, `GET /organizations`) are proven at compile time only because the
tenant SQL guard of the integration tier flags their (customer- or user-scoped)
statements. Portal unit tests build their bodies from
`@calibra-facil/contracts/fixtures`.

**Reference data and service orders** (customers, assets, asset types, methods,
service orders: `packages/contracts/src/endpoints/{customers,assets,asset-types,
methods,service-orders}.ts`) have response schemas that the API contract spec
(`reference-data-contract.int.spec.ts`) checks against the real cloud routes,
with `satisfies ServerShape<...>` at the handlers; `client-runtime` validates
them at run time through the endpoint client.

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

**Follow-ups:** the desktop transport (`desktop-client.ts`) still reads local-server bodies with
`readDesktopJson<T>`, unvalidated (the local-server contract tests pin the
shapes instead), and the `*Data` aliases left in
`packages/client-runtime/src/types.ts`. New endpoints start with a definition in
contracts rather than a generic.
