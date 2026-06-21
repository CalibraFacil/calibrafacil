# On-site Calibration (in loco) Follow-ups — Spec

> Author: spec-driven loop. Consumes the `ears-spec` + `calibrafacil-domain`
> skills. Drives `feature-implementer` → `spec-verifier` per mini-spec.
> Source: issue #486 (CAL-45), follow-ups deferred from the on-site epic PR #485.

## Intent

The on-site (calibração in loco) núcleo shipped in PR #485: a `calibration_visit`
lifecycle (PROPOSED → CONFIRMED → … → COMPLETED/CANCELLED) where one trip covers
many instruments, each a `calibration_job` linked by `calibration_job.visit_id`,
location pre-frozen to the customer site. Two polish items remain:

1. **Editable instrument set on a PROPOSED visit.** Today the instrument set is
   frozen at convert time; before the trip is confirmed an operator must be able
   to add an instrument the customer forgot or drop one no longer needed, without
   cancelling the whole visit. "Done" = add/remove endpoints + lab-web UI, scoped
   strictly to PROPOSED visits and DRAFT jobs, tenant-safe, with tests.
2. **Dedicated visit email templates.** Visit lifecycle emails currently use the
   generic `NotificationEmail` fallback. "Done" = a branded, white-label
   `VisitNotificationEmail` (5 variants) wired through the notifications service,
   proven by a render test per variant.

## Constraints

- **Reuse the RBAC layer, never add inline rules.** Add/remove endpoints reuse
  `withLabPermission({ request: ["update"] })` (`apps/api/src/middleware/permission.ts`),
  identical to the existing visit mutation routes (`apps/api/src/routes/visits.ts`).
- **Preserve org + unit tenant scoping.** Load the visit via the existing
  `getScopedVisit` pattern (`eq(organizationId)` + `buildUnitScopeCondition(unitId, member)`).
  Never touch a row outside the caller's scope.
- **Reuse, never reinvent, job creation/location freezing.** Adding an instrument
  goes through `createCalibrationJob` (`apps/api/src/lib/jobs.ts`) with `visitId` +
  `onsiteLocation` derived from the visit's `address` via the same
  `formatOnsiteAddressText` helper used at convert time
  (`apps/api/src/routes/calibration-requests.ts`). `createCalibrationJob` already
  validates org/unit/service-active/method-published/asset-type compatibility.
- **No hard delete (ISO/IEC 17025 posture).** Removing an instrument soft-cancels
  the job (`status = 'CANCELED'`, the real `JobStatus` value — single L), never a
  `DELETE`.
- **Scope guard is the whole point:** add/remove are allowed ONLY when the visit
  is `PROPOSED` and (for remove) the job is `DRAFT` and belongs to that visit.
  Never mutate an executed/approved job or a confirmed/in-progress/terminal visit.
- **Contract boundary:** new browser-facing routes registered in
  `packages/contracts/src/api-app.ts` `BrowserRoutePath`; client calls go through
  `@calibra-facil/client-runtime` `VisitsApi`; desktop stubs + `cloud-only`
  data-policy entries added (visits are already entirely cloud-only).
- **Email infra reuse:** white-label brand via `getLabEmailBrand` / `EmailBrand`;
  layout + primitives from `packages/email` (`emails/components/email-layout.tsx`);
  Resend + `@react-email/render` transport unchanged.
- **No new notification types.** `VISIT_SCHEDULED|VISIT_CONFIRMED|VISIT_RESCHEDULED|
  VISIT_CANCELLED|VISIT_REMINDER` already exist (PR #485). This spec adds an email
  *template*, not a notification type, so the notification-type registries
  (db union, zod, DEFAULT_PREFERENCES, settings page) are NOT touched.
- pt-BR copy. No `useEffect` import; no `as` assertions. Tests are `*.spec.ts`
  (Vitest); regulated API test files are `*.spec.ts`.

## Acceptance Criteria (EARS)

### Mini-spec 1 — Add / remove instruments on a PROPOSED visit

Domain prefix `REQ-VISITJOB`. The testable guard logic is extracted into a pure
helper (mirroring the codebase's `portal-customer-scope` test pattern: a mocked
drizzle queue + a pure resolver) so each criterion maps to a `*.spec.ts` test
that fails on regression.

- REQ-VISITJOB-001: WHEN an operator POSTs `/api/visits/:id/jobs` with
  `{ assetId, serviceId }` and the target visit's status is `PROPOSED`, the API
  SHALL create exactly one `calibration_job` with `status = 'DRAFT'` and
  `visit_id = :id` via `createCalibrationJob`.
- REQ-VISITJOB-002: WHEN a job is added to a PROPOSED on-site visit, the API
  SHALL set the new job's `calibrationLocationSnapshot` to `type = "customer_site"`
  with `addressText` derived from the visit's `address` via `formatOnsiteAddressText`.
- REQ-VISITJOB-003: IF the target visit's status is not `PROPOSED`, THEN the API
  SHALL reject the add with HTTP `409` and SHALL NOT create any job. [HIGH RISK]
- REQ-VISITJOB-004: IF the requested asset's `customerId` does not equal the
  visit's `customerId`, THEN the API SHALL reject the add with HTTP `400` and
  SHALL NOT create any job. [HIGH RISK]
- REQ-VISITJOB-005: IF the visit is not within the caller's `organizationId` +
  unit scope (`buildUnitScopeCondition`), THEN the add/remove endpoints SHALL
  respond `404` and SHALL NOT mutate any row. [HIGH RISK]
- REQ-VISITJOB-006: WHEN an operator DELETEs `/api/visits/:id/jobs/:jobId` where
  the visit is `PROPOSED`, the job's `status` is `DRAFT`, and the job's `visit_id`
  equals `:id`, the API SHALL set that job's `status = 'CANCELED'` and SHALL NOT
  issue a SQL `DELETE` for the job row.
- REQ-VISITJOB-007: IF the target job's `status` is not `DRAFT`, THEN the API
  SHALL reject the remove with HTTP `409` and SHALL leave the job's status
  unchanged. [HIGH RISK]
- REQ-VISITJOB-008: IF the target visit's status is not `PROPOSED`, THEN the API
  SHALL reject the remove with HTTP `409` and SHALL leave the job unchanged.
  [HIGH RISK]
- REQ-VISITJOB-009: IF the target job's `visit_id` does not equal the `:id` path
  param, THEN the API SHALL reject the remove with HTTP `404`.
- REQ-VISITJOB-010: IF a member without the `request:["update"]` permission calls
  the add or remove endpoint, THEN the API SHALL reject with `403` via
  `withLabPermission` — the same guard already on `POST /api/visits/:id/confirm`.
  [HIGH RISK]
- REQ-VISITJOB-011: The `AddVisitJobSchema` (`packages/schemas`) SHALL require a
  positive-integer `assetId` and a positive-integer `serviceId`, and SHALL reject
  a body missing or non-positive in either field with a Zod validation error.
- REQ-VISITJOB-012: The `@calibra-facil/client-runtime` `VisitsApi` SHALL expose
  `addJob(id, { assetId, serviceId })` and `removeJob(id, jobId)`, the two new
  routes SHALL be listed in `BrowserRoutePath` (`packages/contracts/src/api-app.ts`),
  and the desktop transport SHALL stub both as cloud-only-unsupported, matching
  the existing visit methods.

### Mini-spec 2 — Dedicated `VisitNotificationEmail` templates

Domain prefix `REQ-VISITEMAIL`. Each variant maps to a render-to-HTML test that
asserts the customer-facing fields actually appear in the output (the
non-tautology guard used by `nova-os-email.spec.ts`).

- REQ-VISITEMAIL-001: `packages/email` SHALL export a `VisitNotificationEmail`
  React Email component accepting `variant` ∈ `{ scheduled, confirmed,
  rescheduled, cancelled, reminder }`.
- REQ-VISITEMAIL-002: WHEN rendered for any variant with the supplied fields, the
  email HTML SHALL contain the scheduled date, the customer name, and (when
  provided) the técnico name and the on-site address.
- REQ-VISITEMAIL-003: The email SHALL render the lab white-label brand from the
  supplied `EmailBrand` (lab name in the header) and SHALL render a CTA link to
  the supplied `actionUrl`.
- REQ-VISITEMAIL-004: WHEN the notifications service builds an email for a
  `VISIT_SCHEDULED|VISIT_CONFIRMED|VISIT_RESCHEDULED|VISIT_CANCELLED|VISIT_REMINDER`
  notification carrying an `emailContext` of `type: "visit"`, the service SHALL
  render `VisitNotificationEmail` with the matching variant instead of the generic
  `NotificationEmail` fallback.
- REQ-VISITEMAIL-005: WHEN `notifyVisitConfirmed`, `notifyVisitRescheduled`,
  `notifyVisitCancelled`, and `notifyVisitReminder` send to the customer, each
  SHALL pass a `type: "visit"` `emailContext` (so the customer email uses the
  dedicated template). [the technician in-app notifications keep the generic path]

## Out-of-scope / Deferred

- New notification types or changes to the notification-type registries — none
  needed (types already exist).
- Editing the instrument set on a CONFIRMED/IN_PROGRESS/terminal visit, or
  touching non-DRAFT jobs — explicitly forbidden, not deferred.
- Reschedule/confirm/cancel behavior changes — unchanged.
- Visit reminder cron logic (`apps/worker/src/scheduled.ts`) — unchanged; only the
  email rendered by `notifyVisitReminder` gains the template.

## Decomposition

> Loopable minis run `feature-implementer` (worktree, base-synced) →
> `spec-verifier`. Neither mini touches a cut-line surface: add/remove reuses the
> existing `request:update` RBAC guard unchanged and `createCalibrationJob`
> unchanged, operating only on DRAFT jobs / PROPOSED visits (never the calibration
> approval workflow, signing, GUM math, or RBAC policy). Email is not a cut-line
> surface (same reasoning as the service-order-emails spec). Both are
> **loopable-with-verifier**; the HIGH RISK *criteria* (state/scope guards) get the
> verifier's strongest scrutiny.

| Mini-spec | Layer (real path) | Depends on | Risk | Mode |
| --- | --- | --- | --- | --- |
| **1. Add/remove instruments** | `packages/schemas` (AddVisitJobSchema) + `apps/api/src/routes/visits.ts` + extracted guard helper + `packages/contracts` + `packages/client-runtime` + `apps/web/src/features/visits` | — | med (state/scope guards) | loopable-with-verifier (max scrutiny on 003/004/005/007/008/010) |
| **2. Visit email templates** | `packages/email` (new template) + `packages/notifications/src/service.ts` (visit EmailContext + render branch + pass context) | — | low | loopable-with-verifier |

**Order:** the two minis are independent and can run in parallel worktrees. Each
maker worktree base-syncs (`git fetch` + `git reset --hard
origin/claude/on-site-calibration-followups-epuavr`) before starting. Integrate
mini 1, then mini 2 (or vice-versa); run `pnpm lint` + `pnpm check-types` +
the touched packages' tests before pushing.
