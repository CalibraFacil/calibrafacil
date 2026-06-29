# Legal-metrology verification recall notifications — Spec

> The spec is the prompt. Implementation runs against the Acceptance Criteria below;
> `spec-verifier` checks them. Authored with `ears-spec` + `calibrafacil-domain`.
> Deferred item #1 of the legal-metrology epic (#423). Stacks on PR #597.
> Source feature: `specs/legal-metrology-regime/spec.md` (Track 2 = `next_legal_verification_date`).

## Intent

The legal-metrology feature derives and displays `asset.next_legal_verification_date` for
LEGAL instruments, but the worker recall cron (`processScheduledNotifications` in
`apps/worker/src/scheduled.ts`) only reminds on the **calibration** date
(`next_calibration_date`). For a permissionária whose fleet is regulated, the **legal
verification** (Ipem-mandated, e.g. annual for balanças) is the date that carries legal
weight — it must get its own proactive reminder. This adds a parallel, **independent**
reminder track, mirroring the existing `checkAssetsDueForRecalibration` /
`checkStandardsExpiring` pattern (windowed query + `scheduled_notification` dedup +
dispatch + record `sent_at`), with a **distinct** notification type so it never collides
with the calibration reminder.

## Constraints

- **Reuse the existing pattern**, do not invent a new scheduler: a new `check*` query in
  `apps/worker/src/scheduled.ts` invoked from `processScheduledNotifications`, deduped via
  the `scheduled_notification` table exactly like the sibling checks. Add a new value to the
  notification `type` (do not overload `ASSET_DUE_FOR_RECALIBRATION`).
- **Track independence:** this reminder is keyed on `next_legal_verification_date` +
  `metrology_regime = 'LEGAL'` ONLY; it must not read, alter, or suppress the calibration
  reminder (which stays keyed on `next_calibration_date`).
- **Idempotent:** at most one reminder per asset per dedup window (mirror the 7-day
  `sent_at` window of the sibling checks).
- **No interval recommendation leaks** — the reminder is about a *regulation-fixed* date,
  not a lab recommendation; §7.8.4.3 is not engaged (it's a different regime), but the copy
  must say the period is fixed by regulation (Inmetro/RBMLQ-I), and **indicative** when the
  asset's `regulated_interval.operationalizedByDelegate` is true (Ipem runs the cadence).
- pt-BR copy. Tests are `*.int.spec.ts` (real DB), mirroring
  `apps/worker/src/scheduled-notifications.int.spec.ts` (the `REQ-WSN-*` suite). Run under
  the worker integration tier. No `useEffect`/`as`.

## Acceptance Criteria (EARS)

- REQ-LVRECALL-001: WHEN `processScheduledNotifications` runs, the system SHALL select
  assets WHERE `metrology_regime = 'LEGAL'` AND `next_legal_verification_date` is within the
  lead-time window (`BETWEEN CURRENT_DATE AND CURRENT_DATE + lead`) and enqueue a
  legal-verification reminder for each.
- REQ-LVRECALL-002: The reminder SHALL be deduped via `scheduled_notification`
  (`entity_type='asset'`, a NEW `type` for legal verification, matching `lead_time_days`,
  `sent_at` within the dedup window) so at most one reminder is sent per asset per window.
- REQ-LVRECALL-003: IF an asset has `metrology_regime <> 'LEGAL'` OR
  `next_legal_verification_date IS NULL` (e.g. a `not_nationally_fixed` regulated interval),
  THEN the system SHALL NOT enqueue a legal-verification reminder. [HIGH RISK]
- REQ-LVRECALL-004: The legal-verification reminder SHALL use a notification `type` DISTINCT
  from the calibration reminder (`ASSET_DUE_FOR_RECALIBRATION`), and processing it SHALL NOT
  create, suppress, or alter the calibration reminder for the same asset. [HIGH RISK]
- REQ-LVRECALL-005: WHEN `processScheduledNotifications` runs a second time within the dedup
  window with no state change, it SHALL NOT send a duplicate legal-verification reminder
  (idempotent — mirror `REQ-WSN`).
- REQ-LVRECALL-006: WHERE the asset's `regulated_interval.operationalizedByDelegate` is
  true, the reminder copy SHALL present the date as indicative (cadência operacionalizada
  pelo Ipem — não é prazo nacional fixo), not a hard deadline.

## Out-of-scope / Deferred

- Customer-facing portal digest inclusion of the legal-verification date (the lab-side
  reminder is the deliverable here).
- An "overdue legal verification" escalation (past-due daily nag) — a follow-up; this spec
  covers the lead-time reminder.

## Decomposition

| Mini-spec | Layer (real path) | Risk | Mode |
| --- | --- | --- | --- |
| Legal-verification recall check + wiring | `apps/worker/src/scheduled.ts` (+ notification `type`, template) | med (compliance reminder) | loopable-with-verifier |
| Int coverage | `apps/worker/src/scheduled-notifications.int.spec.ts` (mirror `REQ-WSN`) | med | loopable-with-verifier |

**Pairing note:** the worker recall is loopable-with-verifier. The HIGH-RISK criteria
(003 no-spurious-reminder, 004 track independence) MUST each have an int test that fails on
regression.
