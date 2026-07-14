# Public Quote Approval — Access Code + Token Lifecycle — Spec

> Author: spec-driven session. Consumes the `ears-spec` + `calibrafacil-domain`
> skills. Drives `feature-implementer` → `spec-verifier` per mini-spec.
> Decisions confirmed with the operator (2026-07-14):
>
> 1. **Entry point** = keep the one-click magic link AND add a short,
>    human-typeable approval code printed in the quote email, with a portal page
>    to enter it. The link token keeps its existing 256-bit entropy + SHA-256
>    hashed-at-rest storage (already implemented — retained, not rebuilt).
> 2. **"One-time use"** = revoke-on-decision: unlimited views until the quote is
>    approved or rejected (by any path), then the token/code stops granting
>    access. Plus a default expiry.
> 3. **Default expiry** = quote `validUntil` + 7 days grace; fallback 30 days
>    from send when the quote has no validity date.
> 4. **UI** = the public page's UX is substantially improved and ported to the
>    instrument-panel design system in the same spec.

## Intent

Customers must be able to view and approve/reject a quote (orçamento) **without
signing in to the client portal**. The magic-link flow already exists end-to-end
(token minted on send → "novo orçamento" email → public portal page → public
approve/reject API with audit trail). What is missing: a paste-able short code
as a second entry point, and a trustworthy credential lifecycle — today the
link never expires by default, is never revoked (even after the decision), and
the raw token sits forever in the email-outbox payload. "Done" = a customer can
click the link **or** type the emailed code, decide exactly once, and the
credential dies with the decision or its expiry — proven by tests.

## Current state (what exists / what doesn't)

Works today — reuse, do not rebuild:

- Token mint on quote send: `sendServiceOrderQuote`
  (`apps/api/src/modules/service-orders/service-order.quotes.ts`) →
  `createPublicServiceOrderAccessToken`
  (`apps/api/src/lib/service-order-workflow.ts`): 32 CSPRNG bytes (256-bit),
  stored only as SHA-256 in `service_order_public_access_token`
  (`packages/db/src/schema.ts`), scoped to org + service order + quote.
- Public API mounted unauthenticated at `/api/public/service-order-access`
  (`apps/api/src/server/route-mounts.ts`): `GET /:token`,
  `POST /:token/approve-quote`, `POST /:token/reject-quote`
  (`apps/api/src/routes/service-orders.ts`, `service-order.tokens.ts`), with
  audit events (`actorType: "public_token"`, IP, user-agent) and the
  `canApproveServiceOrderQuote` status guard making the decision one-shot.
- Durable "novo orçamento" email (outbox + drain, idempotent per quote version)
  rendering `${PORTAL_APP_URL}/service-order-access/<token>`
  (`novo-orcamento-email-dispatch.ts`; see `specs/service-order-emails/`).
- Public portal page `apps/portal/src/routes/service-order-access/$token.tsx`
  (outside `_authenticated`): renders OS, evaluation, quote items/totals,
  approve/reject.

Gaps this spec closes:

1. No code-entry surface — link-only access.
2. `expiresAt` defaults to `null` → links never expire.
3. `revokedAt` is dead code — nothing ever revokes these tokens; access
   outlives the decision and superseded quote versions keep live tokens.
4. Raw token persisted indefinitely in the email-outbox payload jsonb.
5. Public view returns `quotes` ordered by latest version while approval acts
   on the token's pinned `quoteId` — display/action can diverge.
6. Page uses plain shadcn `Card` (violates `docs/architecture/portal-frontend.md`),
   and its post-decision UX refetches through a token that will now be revoked.

## Constraints

- **Do not weaken the existing link token**: 256-bit CSPRNG, hashed (SHA-256)
  at rest, raw value never stored in the token table. The short code is
  **additive** and low-entropy by design, so it gets compensating controls
  (peppered hash + throttling) instead of entropy.
- **Reuse the existing grant row**: the short code is a second credential for
  the same `service_order_public_access_token` row (new columns), not a new
  token system. Schema changes via forward-only Drizzle migration
  (`cd packages/db && pnpm db:generate`); never hand-edit applied SQL.
- **Do not touch the RBAC layer** (`packages/auth/src/access.ts`,
  `apps/api/src/middleware/permission.ts`). These endpoints are public by
  design; their access control is the credential lifecycle specified here.
  Preserve `organizationId` scoping on every query.
- **Do not change the decision semantics**: `canApproveServiceOrderQuote`
  remains the single status guard; manual and portal-user approval paths keep
  working and now also trigger revocation.
- **Throttle state must survive serverless**: `apps/api` runs as Vercel
  functions — in-memory counters do not persist across invocations. Back the
  rate limiter with a Postgres table (or equivalent durable store already in
  the stack). No new external service.
- Email changes go through the existing outbox payloads + drain
  (`email-outbox-payloads.ts`, `service-order-email-drain.ts`) and respect
  REQ-SOEMAIL-023 (credential captured at send, never re-minted at drain).
- Portal page follows `docs/architecture/portal-frontend.md`: instrument-panel
  design system, pt-BR copy, `.portal-shell` roots, no `useEffect` import, no
  `as` assertions (remove the existing oxlint-disable by parsing the response
  with a Zod schema from `@calibra-facil/schemas`).
- Tests are Vitest `*.spec.ts`; API integration tests follow the existing
  `service-orders*.int.spec.ts` patterns.

## Acceptance Criteria (EARS)

### A — Token lifecycle: default expiry + revoke-on-decision (mini-spec A)

- REQ-QPUB-001: WHEN `sendServiceOrderQuote` mints a public access token and the
  lab supplied no explicit `expiresAt`, the API SHALL persist
  `expiresAt = quote.validUntil + 7 days` when `validUntil` is set, otherwise
  `sentAt + 30 days`.
- REQ-QPUB-002: The public access token SHALL be generated with 256 bits of
  CSPRNG entropy and persisted only as its SHA-256 hash (regression guard on
  the existing behaviour). [HIGH RISK]
- REQ-QPUB-003: WHEN a quote transitions to `approved` or `rejected` through
  ANY path (public token, public code, portal user, or manual lab approval),
  the API SHALL set `revokedAt` and `revokedReason = "decided"` on every
  unrevoked `service_order_public_access_token` row whose `quoteId` is that
  quote, inside the same transaction as the status change. [HIGH RISK]
- REQ-QPUB-004: WHEN `sendServiceOrderQuote` issues a token for a new quote
  version of a service order, the API SHALL set `revokedAt` and
  `revokedReason = "superseded"` on all unrevoked tokens of that service
  order's earlier quotes.
- REQ-QPUB-005: IF a presented token is expired or revoked with reason
  `superseded`, THEN `GET /api/public/service-order-access/:token` SHALL
  respond `404` with a generic error body containing no service-order or quote
  data.
- REQ-QPUB-006: IF a presented token is revoked with reason `decided`, THEN
  `GET /api/public/service-order-access/:token` SHALL respond `410` with error
  code `orcamento_respondido` and no quote pricing, item, or diagnosis data.
- REQ-QPUB-007: IF a presented token is expired or revoked (any reason), THEN
  the `approve-quote` and `reject-quote` endpoints SHALL reject without
  mutating any quote or service-order row. [HIGH RISK]
- REQ-QPUB-008: WHEN the email-outbox drain marks an `orcamento_sent` row as
  sent, the drain SHALL redact the raw credential fields (`publicAccessToken`,
  `approvalCode`) from the persisted outbox payload. [HIGH RISK]

### B — Short approval code (mini-spec B)

- REQ-QPUB-010: WHEN a quote is sent, the API SHALL generate an 8-character
  approval code from an unambiguous uppercase alphabet (excluding `0 O 1 I L`)
  using a CSPRNG, stored on the same grant row as the link token.
- REQ-QPUB-011: The approval code SHALL be persisted only as an HMAC-SHA-256
  digest keyed by a server-side pepper (env secret), so a database dump alone
  is insufficient to brute-force codes offline. [HIGH RISK]
- REQ-QPUB-012: WHEN a valid, unexpired, unrevoked code is submitted to
  `POST /api/public/service-order-access/redeem-code`, the API SHALL respond
  with a tokenized `/service-order-access/<token>` access URL for the matching
  grant. (Clarified during implementation: the emailed link token is
  unrecoverable — hash-only at rest — so redemption mints a fresh sibling
  token on the same grant, same org/OS/quote/expiry, `codeHash` NULL. Siblings
  revoke together with the grant because revocation keys on `quoteId`.)
- REQ-QPUB-013: IF a submitted code matches no active grant, THEN the
  redeem-code endpoint SHALL respond `404` with a generic error that does not
  reveal whether the code, the service order, or the quote exists.
- REQ-QPUB-014: IF an IP address exceeds 10 failed redeem-code attempts within
  15 minutes, THEN the API SHALL respond `429` to further redeem-code attempts
  from that IP until the window elapses, using a durable (serverless-safe)
  counter. [HIGH RISK]
- REQ-QPUB-015: WHEN a code redemption succeeds, the API SHALL record a
  `service_order.public_code_redeemed` event with `actorType: "public_token"`,
  IP address, and user-agent.

### C — Quote email carries the code (mini-spec C)

- REQ-QPUB-020: The "novo orçamento" email SHALL render, in addition to the
  existing approval link, the approval code and the code-entry URL
  (`${PORTAL_APP_URL}/access-code`) with pt-BR instructions. (Transitional
  note: `approvalCode` is OPTIONAL in the outbox payload schema — pending rows
  enqueued before deploy carry no code and must still send; the template
  renders the code section conditionally. Applies to every email minted after
  deploy.)
- REQ-QPUB-021: The code rendered in the email SHALL be the exact code minted
  by `sendServiceOrderQuote` for that quote version, captured in the outbox
  payload at enqueue time and never re-minted at drain time. [HIGH RISK]

### D — Public view correctness (mini-spec D)

- REQ-QPUB-030: WHEN a quote-scoped token views the service order, the response
  SHALL identify the token's own quote (`access.quoteId`) as the primary quote,
  regardless of newer quote versions on the same service order.
- REQ-QPUB-031: The public view SHALL return only data belonging to the token's
  own `serviceOrderId`/`organizationId` and SHALL NOT include fields from any
  other tenant, order, or customer (regression guard). [HIGH RISK]
- REQ-QPUB-032: The public view SHALL return the client-visible projection only
  (`toClientVisibleServiceOrderDetail`) — `internalNotes` and other lab-internal
  fields are absent from the response body. [HIGH RISK]
- REQ-QPUB-033: IF `canApproveServiceOrderQuote(quote.status)` is false, THEN
  `approve-quote` and `reject-quote` SHALL respond `409` without mutating any
  row (regression guard on the one-shot decision). [HIGH RISK]

### E — Portal UX: code entry + page rework (mini-spec E)

- REQ-QPUB-040: The portal SHALL serve a public code-entry page at
  `/access-code` (outside the `_authenticated` layout) where submitting a valid
  code navigates to the grant's `/service-order-access/$token` page.
  (Route paths are English per the portal routing convention; page copy is
  pt-BR.)
- REQ-QPUB-041: IF the redeem-code endpoint returns `404` or `429`, THEN the
  code-entry page SHALL show the corresponding pt-BR error state (código
  inválido / muitas tentativas) without clearing silently.
- REQ-QPUB-042: The public quote page SHALL render with the instrument-panel
  design system (`Panel`/`PanelHeader`/`SignalTile`/`BlueprintGrid` +
  `SignalTone` vocabulary) instead of plain shadcn `Card`.
- REQ-QPUB-043: WHEN the customer approves or rejects the quote, the page SHALL
  display a terminal confirmation state rendered from the mutation response,
  without re-fetching through the now-revoked token.
- REQ-QPUB-044: IF the view endpoint returns `410 orcamento_respondido`, THEN
  the page SHALL show an "orçamento já respondido" state with the lab's contact
  guidance and no pricing data.
- REQ-QPUB-045: The public quote page and code-entry page SHALL parse API
  responses through Zod schemas from `@calibra-facil/schemas` (removing the
  existing `consistent-type-assertions` oxlint-disable).

## Deploy notes (pre-merge checklist)

> ⚠️ **REMINDER — do not merge/deploy without these:**
>
> 1. **Set `QUOTE_APPROVAL_CODE_PEPPER` in production** (any strong random
>    secret, e.g. `openssl rand -base64 32`). It is in `requiredProductionEnv`
>    (`apps/api/src/lib/runtime-env.ts`), so production deploys **fail-fast at
>    boot** without it — that is the backstop, not the plan. Rotating the
>    pepper later invalidates every outstanding emailed approval code (links
>    keep working; codes stop redeeming).
> 2. Apply migration `0096_public_quote_access_lifecycle`
>    (`cd packages/db && pnpm db:migrate`).

## Out-of-scope / Deferred

- Authenticated portal-user approval and manual lab approval flows: behaviour
  unchanged except for the revocation hook (REQ-QPUB-003).
- Per-code (as opposed to per-IP) lockout counters — failed attempts are not
  attributable to a grant; the per-IP throttle is the control.
- Re-sending / re-issuing a code from the lab dashboard UI ("reenviar código")
  — a follow-up spec; the API groundwork (mint on send) makes it cheap.
- PDF attachment on the quote email (explicitly excluded by
  `specs/service-order-emails/`).
- Desktop/offline parity: `apps/portal` and these public endpoints are
  cloud-only by architecture; no local-server/sync work.
- Cleanup/TTL job for the throttle-counter table (operationally nice; not
  acceptance-gated). No EARS — housekeeping.

## Decomposition

| Mini-spec                                                                           | Layer (real path)                                                                                                                        | Depends on | Risk                                                            | Mode                   |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------- | ---------------------- |
| A. Token lifecycle (expiry default, revoke-on-decision/supersede, outbox redaction) | `packages/db` migration + `apps/api/src/lib/service-order-workflow.ts` + `modules/service-orders/*` + `lib/service-order-email-drain.ts` | —          | **high + critical** (binding financial action, confidentiality) | **pair-don't-loop**    |
| B. Short code mint + redeem endpoint + throttle                                     | `packages/db` (same migration) + `apps/api/src/routes/service-orders.ts` + new throttle store                                            | A          | **high + critical** (public low-entropy credential)             | **pair-don't-loop**    |
| C. Email template + outbox payload carries code                                     | `packages/email` + `apps/api/src/modules/service-orders/email-outbox-payloads.ts`, `novo-orcamento-email-dispatch.ts`                    | B          | med                                                             | loopable-with-verifier |
| D. Public view correctness (pinned quote, projections)                              | `apps/api/src/modules/service-orders/service-order.tokens.ts`, `service-order.read-model.ts`                                             | A          | med                                                             | loopable-with-verifier |
| E. Portal `/access-code` page + instrument-panel rework + terminal states           | `apps/portal/src/routes/` + `apps/portal/src/features/`                                                                                  | B, D       | low                                                             | loopable-with-verifier |
