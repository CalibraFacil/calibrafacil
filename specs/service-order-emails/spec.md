# Service-Order Lifecycle Emails — Spec

> Author: spec-driven loop. Consumes the `ears-spec` + `calibrafacil-domain`
> skills. Drives `feature-implementer` → `spec-verifier` per mini-spec.
> Decisions confirmed with the operator (2026-06-19):
> 1. **Recipient** = the customer's contact email directly (no portal account required).
> 2. **Scope** = all service-order lifecycle transitions.
> 3. **Quote email** = full inline summary + highlighted approval link, no PDF attachment.

## Intent

When a service order (ordem de serviço / OS) moves through its lifecycle, the
external customer currently receives nothing by email. We want branded
(white-label), pt-BR transactional emails sent to the customer's contact address
at each relevant transition — most importantly a rich **orçamento** (quote) email
carrying the full quote breakdown and a one-click portal **approval link** — so
customers are informed and can approve quotes without a portal account. "Done" =
each transition below fires exactly one correct, white-label, tenant-safe email
to the right customer, proven by tests.

## Constraints

- **Recipient = customer contact, resolved from the OS**, not a `recipientUserId`.
  The existing `sendNotification(recipientUserId, …)` path (`packages/notifications/src/service.ts`)
  is keyed to a user record; these emails need a **new customer-facing dispatch
  path** that resolves the address from `serviceOrder.clientContactSnapshot.email`
  (jsonb `Record<string, unknown>` — parse defensively) falling back to
  `customer.email`.
- **Reuse, never reinvent, the existing infra:**
  - White-label brand via `getLabEmailBrand(organizationId)` / `createLabEmailBrand`
    + `EmailBrand` (`packages/notifications/src/service.ts`).
  - Transport via the existing Resend + `@react-email/render` path.
  - Email layout + primitives from `packages/email` (`emails/components/email-layout.tsx`:
    `EmailLayout`, `DetailBox`/`DetailRow`, `ActionButton`, `LinkFallback`, etc.).
  - **Approval token already exists**: `sendServiceOrderQuote` (`apps/api/src/modules/service-orders/service-order.quotes.ts:205`)
    calls `createPublicServiceOrderAccessToken` (`apps/api/src/lib/service-order-workflow.ts:338`).
    The quote email MUST consume that token + `serviceOrder.publicId` to build the
    portal URL (base `PORTAL_APP_URL`). Do NOT mint a new token scheme.
- **Tenant isolation (org + unit):** an email may only contain fields of its own
  service order / customer / lab org. Never cross-tenant. Preserve `organizationId`
  scoping when loading data.
- **Do not modify the RBAC layer or the transition handlers' authorization.** Hook
  email dispatch into the existing module functions in
  `apps/api/src/modules/service-orders/` (`service-order.commands.ts`,
  `service-order.quotes.ts`, `service-order.execution.ts`); reuse their existing
  permission guards unchanged.
- **Money is integer cents** (`*_cents` columns). Render BRL from cents with no
  float drift; reuse an existing cents→BRL formatter if one exists in `packages/shared`.
- pt-BR copy. No `useEffect`, no `as` assertions. New templates are React Email
  `.tsx`; tests are `*.spec.ts` (Vitest).
- **Email failure must not break the state transition** — dispatch is best-effort
  / retryable, never rolls back the OS transition.

## Acceptance Criteria (EARS)

### Foundation — customer-facing dispatch + shared template (mini-spec A)

- REQ-SOEMAIL-001: The service-order email dispatcher SHALL resolve the recipient
  address from `serviceOrder.clientContactSnapshot.email` when present and valid,
  otherwise from `customer.email`.
- REQ-SOEMAIL-002: IF no valid recipient address can be resolved, THEN the
  dispatcher SHALL skip sending and SHALL NOT throw (no-op, logged).
- REQ-SOEMAIL-003: WHEN sending any service-order email, the dispatcher SHALL
  apply the lab white-label brand resolved via `getLabEmailBrand(serviceOrder.organizationId)`.
- REQ-SOEMAIL-004: The dispatcher SHALL include only data belonging to the
  service order's own organization and customer, and SHALL NOT render any field
  from another organization, customer, or service order. [HIGH RISK]
- REQ-SOEMAIL-005: IF the Resend transport throws, THEN the dispatcher SHALL
  return a failure result and SHALL NOT propagate the error to the caller's state
  transition (the OS transition still commits). [HIGH RISK]
- REQ-SOEMAIL-006: The shared service-order email layout SHALL render the company
  header (name, address, CNPJ, phone, website, logo) from `EmailBrand`, and WHERE
  `EmailBrand.isWhiteLabel` is set, SHALL NOT render the Calibra Fácil platform
  *marketing* branding (the platform pitch line). A minimal "via CalibraFácil"
  attribution is permitted — this matches the deliberate, platform-wide
  white-label contract already implemented in `packages/email/.../email-layout.tsx`
  and used by every transactional email. (Reconciled 2026-06-19 after the verifier
  flagged the original absolute "no platform branding" wording as inconsistent
  with the shared layout; full-unbranded white-label is a separate product
  decision — see operator note.)

### Nova OS (mini-spec B)

- REQ-SOEMAIL-011: WHEN a service order is created (`createServiceOrder`), the
  system SHALL send a "nova OS" email containing the `serviceOrderNumber`, asset
  brand/model/serial, intake (entrada) date, and claimed defect.
- REQ-SOEMAIL-012: IF the created service order has no resolvable contact email,
  THEN creation SHALL still succeed and the email SHALL be skipped.

### Novo orçamento (mini-spec C) — the rich one

- REQ-SOEMAIL-021: WHEN a quote is sent (`sendServiceOrderQuote` sets quote
  status `sent`), the system SHALL send a "novo orçamento" email whose header
  carries the instrument-agnostic universal fields — OS number, customer name,
  CNPJ/CPF, asset brand/model, serial number, entrada date, and claimed defect.
- REQ-SOEMAIL-025: The orçamento email SHALL render the asset's instrument
  spec rows generically from `serviceOrderAssetSnapshot.displaySpecs`
  (`[{label,value}]`) — NOT hardcoded weighing-instrument fields (no fixed
  "Cap/Div" or "Portaria" rows) — so the email is correct for any instrument
  type (balança, termômetro, paquímetro, manômetro, …); WHERE `displaySpecs`
  is empty, the spec section SHALL be omitted. (Reconciled 2026-06-19: the
  original REQ-021 over-fit the operator's balance example; the data model is
  instrument-agnostic via `assetType` + `displaySpecs` + `specifications`.)
- REQ-SOEMAIL-022: The orçamento email SHALL list every `serviceOrderQuoteItem`
  grouped by type (peças / serviços / opcionais) with quantity, unit price and
  line total, and SHALL render `subtotalPartsCents`, `subtotalServicesCents`,
  optionals and `totalCents` exactly as persisted, WITHOUT recomputing totals in
  the template. [HIGH RISK]
- REQ-SOEMAIL-023: The orçamento email SHALL render a highlighted approval URL
  built from the existing public access token + `serviceOrder.publicId` (+ quote
  id) and base `PORTAL_APP_URL`, and SHALL NOT expose `internalNotes` or any
  internal-only field. [HIGH RISK]
- REQ-SOEMAIL-024: Monetary values SHALL be rendered in BRL from integer cents
  (e.g. `146000` → `"R$ 1.460,00"`) with no floating-point drift.

### Orçamento aprovado / recusado (mini-spec D)

- REQ-SOEMAIL-031: WHEN a quote is approved (manual `approveServiceOrderQuoteManually`
  or portal `approveServiceOrderQuoteByPortalUser`), the system SHALL send an
  "orçamento aprovado" email stating the approved total (`totalApprovedCents`).
- REQ-SOEMAIL-032: WHEN a quote is rejected, the system SHALL send an "orçamento
  recusado" email referencing the OS number and the `rejectionReason` when present.

### Avaliação / execução / andamento (mini-spec E)

- REQ-SOEMAIL-041: WHEN execution starts (`startServiceOrderExecution` →
  `repair_in_progress`), the system SHALL send a "serviço iniciado" email.
- REQ-SOEMAIL-042: WHERE the OS enters `awaiting_calibration` or
  `calibration_in_progress`, the system SHALL send a progress-update email.
- REQ-SOEMAIL-043: WHEN the OS enters `awaiting_tech_evaluation`, the system
  SHALL send an "aguardando avaliação técnica" email.
- REQ-SOEMAIL-044: WHEN the OS enters `under_evaluation`, the system SHALL send
  an "em avaliação técnica" email.

### Conclusão / entrega (mini-spec F)

- REQ-SOEMAIL-051: WHEN the OS becomes `ready_for_pickup`, the system SHALL send
  a "pronto para retirada" email.
- REQ-SOEMAIL-052: WHEN the OS is `delivered`, the system SHALL send an "entregue"
  receipt email.
- REQ-SOEMAIL-053: WHEN the OS is `closed`, the system SHALL send an "OS
  encerrada" email.
- REQ-SOEMAIL-054: WHEN the OS enters `awaiting_final_review`, the system SHALL
  send an "em revisão final" email.

### Cancelamento / garantia (mini-spec G)

- REQ-SOEMAIL-061: WHEN the OS is `canceled`, the system SHALL send a
  cancellation email.
- REQ-SOEMAIL-062: WHEN the OS enters `warranty_return`, the system SHALL send a
  warranty-return email.

### Cross-cutting — idempotency / dedup (mini-spec H, in scope)

- REQ-SOEMAIL-007: The system SHALL record each sent transition email keyed by
  (`serviceOrderId`, `eventKey`).
- REQ-SOEMAIL-008: IF a transition email's (`serviceOrderId`, `eventKey`) is
  already recorded, THEN the system SHALL skip dispatch (send at most once per
  service-order transition event, so a re-executed transition does not double-send).
- REQ-SOEMAIL-009: IF dispatch fails after the key is recorded, THEN the system
  SHALL release the key so a later retry can resend.

**Implementation note (mini-spec H):** a forward-only Drizzle migration adds a
`service_order_email_log` table with a UNIQUE (`service_order_id`, `event_key`)
constraint. An `apps/api` "send-once" helper claims the key (insert-on-conflict)
before dispatch and routes ALL mini-spec B–G sends through it; each caller passes
a stable `eventKey` (e.g. `nova_os`, `orcamento_sent:<quoteId>`,
`quote_approved:<quoteId>`). The `packages/notifications` dispatcher stays
DB-free — dedup lives in the apps/api caller layer to preserve the
tenant-isolation boundary verified in REQ-004. Mini-specs B and C, already built,
are retrofitted to route through the send-once helper as part of H.

### Cross-cutting — durability parity for B/C/D (mini-spec I, in scope)

Mini-specs B (nova OS), C (novo orçamento) and D (orçamento aprovado/recusado)
currently dispatch their customer email **best-effort, fire-and-forget, after the
command transaction commits** (`void (async () => sendServiceOrderEmailOnce(…))`).
On a serverless host the function can be reclaimed before that promise settles, so
the email can be silently dropped. Mini-specs E–G already avoid this via the
transactional outbox (`service_order_email_outbox`) drained by the worker. Mini-spec
I brings B/C/D to the same durability guarantee. **No new migration** — it reuses the
outbox table and the worker drain; routing is by `eventKey` namespace and the
existing per-email payload is stored in the outbox `payload`.

- REQ-SOEMAIL-071: WHEN a nova-OS (`nova_os`), novo-orçamento (`orcamento_sent:<quoteId>`),
  orçamento-aprovado (`quote_approved:<quoteId>`) or orçamento-recusado
  (`quote_rejected:<quoteId>`) email is triggered, the system SHALL persist an outbox
  row (durably, before the request returns) instead of dispatching the email
  best-effort post-commit.
- REQ-SOEMAIL-072: WHERE the triggering command already runs inside a database
  transaction (the quote approve/reject commands), the system SHALL enqueue the outbox
  row using that transaction's executor, so the row commits atomically with the
  command's effect and is rolled back with it.
- REQ-SOEMAIL-073: WHEN the outbox drain processes a `nova_os`, `orcamento_sent:*`,
  `quote_approved:*` or `quote_rejected:*` row, the system SHALL render and send the
  corresponding email from the row's stored payload, routing by the `eventKey`
  namespace and reusing the existing per-email dispatch helpers.
- REQ-SOEMAIL-074: The system SHALL send each of these emails at most once per
  (`serviceOrderId`, `eventKey`) — the outbox UNIQUE constraint dedups enqueue and the
  send-once ledger (REQ-007..009) dedups dispatch.
- REQ-SOEMAIL-075: The drain SHALL resolve each email's recipient only within the
  outbox row's organization (REQ-004 tenant isolation preserved for B/C/D too).

## Out-of-scope / Deferred

- PDF attachment of the quote (decision: link-only). The worker still generates
  the quote PDF; the email does not attach or wait for it.
- Customer notification **preferences / unsubscribe** for these transactional
  emails (transactional, not marketing — revisit if required).
- In-app/portal notifications for these same events (this spec is email-only).

> Resolved 2026-06-19 by the operator: (1) idempotency/dedup is **in scope** now
> (mini-spec H, REQ-007..009); (2) the intermediate statuses
> `awaiting_tech_evaluation`, `under_evaluation`, `awaiting_final_review` **do**
> get customer emails (REQ-043, 044, 054).

## Decomposition

> Loopable minis run `feature-implementer` (worktree) → `spec-verifier`. A mini
> that is BOTH critical-path AND high-risk would be pair-don't-loop — **none here
> are**, because email dispatch is not a cut-line surface (no calibration
> approval, signing, RBAC policy, or math). Mini-spec C carries HIGH RISK
> *criteria* (financial accuracy + approval-link/tenant safety) → it stays
> loopable but gets the verifier's strongest scrutiny.

| Mini-spec | Layer (real path) | Depends on | Risk | Mode |
| --- | --- | --- | --- | --- |
| **A. Dispatch + shared SO email layout** | `packages/notifications/src` (new customer dispatch), `packages/email` (layout/primitives) | — | med (tenant isolation, transport) | loopable-with-verifier |
| **B. Nova OS** | `apps/api/src/modules/service-orders/service-order.commands.ts` + new template | A | low | loopable-with-verifier |
| **C. Novo orçamento** | `service-order.quotes.ts` (`sendServiceOrderQuote`) + new template; reuse token from `service-order-workflow.ts` | A | **HIGH (financial + approval link)** | loopable-with-verifier (max verifier scrutiny) |
| **D. Aprovado / recusado** | `service-order.quotes.ts` (approve/reject handlers) + template | A, C | med (financial total) | loopable-with-verifier |
| **E. Avaliação / execução / andamento** | `service-order.execution.ts` + `service-order.evaluations.ts` (eval-state transitions) + templates | A, H | low | loopable-with-verifier |
| **F. Revisão final / conclusão / entrega** | `service-order.commands.ts` (final-review/ready/deliver/close) + templates | A, H | low | loopable-with-verifier |
| **G. Cancelamento / garantia** | `service-order.commands.ts` + template | A, H | low | loopable-with-verifier |
| **H. Idempotency / dedup** | `packages/db` (forward-only migration: `service_order_email_log`) + `apps/api` send-once helper; retrofit B & C callers | A | med (migration + at-most-once) | loopable-with-verifier |

**Order:** A first (done), then B (done), then C (in flight), then **H** (dedup
foundation; retrofits B & C to the send-once helper), then D, then E/F/G route
through H. Run one mini per loop iteration; verify before proceeding. **Mini-spec
C's HIGH RISK criteria (022, 023) are the ones to pair-review even though the
surface is loopable** — financial figures on a customer email and a portal
approval link both have real error cost. **Mini-spec H adds a Drizzle migration**
— forward-only, generated via `pnpm db:generate`, never hand-edited.
