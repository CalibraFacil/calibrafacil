# @calibra-facil/client-runtime

Client-side runtime for Calibra Facil web and desktop clients.

This package owns the boundary between frontend product code and API transport.
It is the only frontend-facing package that should contain raw Hono RPC calls.

## Responsibilities

- Cloud and desktop transport selection.
- Shared response and error parsing.
- Active organization/unit headers and desktop bridge behavior.
- Product-level API facades grouped by domain.
- Stable exports consumed by `apps/web`, `apps/portal`, and other clients.

## Structure

```txt
src/
  index.ts            # Public facade and compatibility exports
  types.ts            # Public runtime types
  data-policy.ts      # Shared data policy helpers
  modules/            # Domain API implementations
  transport/          # Cloud/desktop clients, response helpers, URL helpers
```

Domain modules should expose product-level methods. Web code should call those
methods instead of raw paths:

```ts
calibraApi.nonConformances.create(input);
calibraApi.capa.create(input);
calibraApi.methods.update(id, input);
```

## Rules

- Keep raw Hono RPC calls inside this package.
- Do not import from `apps/api/*`.
- Keep `packages/contracts` as the source of browser-facing route contracts.
- Reuse `transport/response.ts` helpers for JSON and error handling.
- Keep `index.ts` compatible for existing consumers when moving
  implementation into `modules/*`.
- Add tests in `src/index.test.ts` or focused transport tests for new facades.

See `../../docs/architecture/api-client-contract.md` and
`../../docs/architecture/web-frontend-architecture.md`.
