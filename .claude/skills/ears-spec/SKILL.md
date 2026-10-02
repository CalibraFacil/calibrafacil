---
name: ears-spec
description: >-
  Author acceptance criteria in EARS (Easy Approach to Requirements Syntax) so a
  spec can drive implementation and a separate verifier can check it. Use when
  writing or reviewing a feature spec, a mini-spec for /goal, or the Acceptance
  Criteria section of specs/. Encodes the six EARS patterns, the one-SHALL rule,
  stable REQ IDs, HIGH RISK flagging, and Calibra Fácil domain rules (access
  criteria bind the real RBAC layer; metrology criteria state value AND
  uncertainty/coverage factor).
---

# EARS Acceptance-Criteria Skill

EARS turns prose intent into testable, unambiguous criteria. "The spec is the
prompt": loops implement against criteria a human wrote and a verifier checks —
loops never decide WHAT to build. Each criterion must be something a test can
pass or fail on.

## The six patterns

1. **Ubiquitous** (always true, no trigger):
   `The <system> SHALL <response>.`
2. **Event-driven (WHEN)** — a triggering event:
   `WHEN <trigger>, the <system> SHALL <response>.`
3. **State-driven (WHILE)** — a sustained condition:
   `WHILE <state>, the <system> SHALL <response>.`
4. **Unwanted behaviour (IF/THEN)** — error / undesired condition:
   `IF <condition>, THEN the <system> SHALL <response>.`
5. **Optional feature (WHERE)** — only when a feature/config is present:
   `WHERE <feature is included>, the <system> SHALL <response>.`
6. **Complex** — combine keywords for compound conditions:
   `WHILE <state>, WHEN <trigger>, the <system> SHALL <response>.`

## Rules (every criterion)

- **Exactly one `SHALL` per criterion.** One behaviour, one criterion. Split
  compound requirements into separate IDs.
- **Keywords UPPERCASE:** `WHEN`, `WHILE`, `IF`, `THEN`, `WHERE`, `SHALL`.
- **No `should` / `must` / `may`.** Only `SHALL` is normative. No "etc.",
  "as appropriate", "handle gracefully".
- **Measurable response.** State the observable result (a value, a status, an
  HTTP code, a persisted row, a rejection with a named reason) — not an
  intention. "SHALL reject with `403`" not "SHALL be secure".
- **Stable REQ IDs.** Prefix per domain + number, e.g. `REQ-CAL-001`,
  `REQ-ACCESS-003`, `REQ-UNC-002`. IDs are append-only: never renumber a shipped
  ID; deprecate instead. Tests and the verifier reference these IDs.
- **Flag `HIGH RISK`.** Append `[HIGH RISK]` to any criterion whose failure is a
  regulatory/legal/data-loss event, or that touches a **pair-don't-loop** surface
  (see the `calibrafacil-domain` skill). HIGH RISK criteria force pair-don't-loop
  on their mini-spec and get extra scrutiny from the verifier.
- **One criterion = one test.** If you can't picture the failing test, the
  criterion is too vague.

## Calibra Fácil domain rules for criteria

- **Access-control criteria bind the REAL RBAC layer — never a new inline rule.**
  Phrase them against `packages/auth/src/access.ts` roles and the
  `apps/api/src/middleware/permission.ts` guards (`requirePermission`,
  `requireRole`, `requireCalibrationAction`, `requireOrgType`)
  and the org+unit scope (`resolveMemberUnitScope`). Name the role and the
  guard. These are almost always `[HIGH RISK]`.
  - Good: `REQ-ACCESS-002: IF a member without the admin or owner role calls
approve on a calibration in_review, THEN the API SHALL reject with 403 via
requireCalibrationAction. [HIGH RISK]`
  - Bad: `The system SHALL only let authorized users approve.`
- **Metrology criteria state value AND uncertainty.** A result criterion must
  specify the value **and** its expanded uncertainty plus the coverage factor
  `k` (and distribution/νeff where relevant) — never value-only. Bind the real
  engine (`packages/math-engine`, decimal backend).
  - Good: `REQ-UNC-001: WHEN combining the given Type A and Type B components,
the engine SHALL report y = 10.000 g with U = 0.012 g at k = 2.00
(≈95%, normal), matching the oracle in type-b.spec.ts.`
  - Bad: `The engine SHALL compute the correct result.`
- **Don't over-spec throwaways.** Prototypes, internal dashboards, one-off
  scripts, and disposable spikes get light or no EARS — reserve full criteria
  for regulated/durable surfaces (certificates, accreditation, access, money,
  uncertainty, sync). Note "no EARS — throwaway" explicitly so the verifier
  doesn't demand tests for them.

## Shape of an acceptance-criteria block

```
### Acceptance Criteria

- REQ-<DOMAIN>-001: WHEN <trigger>, the <system> SHALL <measurable response>.
- REQ-<DOMAIN>-002: IF <bad condition>, THEN the <system> SHALL <reject/handle>. [HIGH RISK]
- REQ-<DOMAIN>-003: The <system> SHALL <invariant>.
```

Each REQ ID later maps to at least one `*.spec.ts` test that would FAIL if the
behaviour regressed (the verifier rejects tautologies). See the `spec-verifier`
agent and `specs/_TEMPLATE/spec.md`.
