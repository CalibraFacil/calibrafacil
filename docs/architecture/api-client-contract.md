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
3. Update `packages/contracts/src/api-app.ts` if the browser-facing raw route
   surface changes.
4. Run `pnpm --filter @calibra-facil/contracts check-types`.
5. Run `pnpm check-types` before pushing.
