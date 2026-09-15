# <Feature name> — Spec

> Copy this folder to `specs/<feature-slug>/` and fill it in. The spec is the
> prompt: implementation runs against the Acceptance Criteria below, and the
> `spec-verifier` agent checks them. Author criteria with the `ears-spec` skill;
> ground every reference in real paths/commands via the `calibrafacil-domain`
> skill.

## Intent

<2–4 sentences. What user/lab problem does this solve, and what does "done" look
like? Plain language — the WHY. No solution detail here.>

## Constraints

<Hard boundaries this feature must respect. Cite the real ones, e.g.:>

- Reuse the RBAC layer (`packages/auth/src/access.ts` +
  `apps/api/src/middleware/permission.ts`); do not add inline access rules.
- Preserve `organizationId` + `unitId` tenant scoping.
- Schema changes via forward-only Drizzle migration (`pnpm db:generate`); never
  hand-edit applied SQL.
- Regulatory strings verbatim (NBR ISO/IEC 17025, Inmetro, Cgcre/RBC, MP 2.200-2, DOC-ICP-15.03).
- No `useEffect` import; no `as` assertions.

## Acceptance Criteria (EARS)

<One SHALL per criterion. Stable REQ IDs. Tag [HIGH RISK] where failure is
regulatory/legal/data-loss or touches a pair-don't-loop surface. Each REQ ID maps
to at least one `*.spec.ts` test that fails on regression.>

- REQ-<DOMAIN>-001: WHEN <trigger>, the <system> SHALL <measurable response>.
- REQ-<DOMAIN>-002: IF <bad condition>, THEN the <system> SHALL <reject with named reason>. [HIGH RISK]
- REQ-<DOMAIN>-003: The <system> SHALL <invariant>.
- REQ-<UNC>-00x (metrology): WHEN <inputs>, the engine SHALL report <value> with
  U = <expanded uncertainty> at k = <coverage factor> (<distribution/νeff>).
- REQ-<ACCESS>-00x (access): IF a <role without permission> calls <action>, THEN
  the API SHALL reject with <HTTP code> via <real guard>. [HIGH RISK]

## Out-of-scope / Deferred

<Explicitly list what this spec does NOT cover, and anything punted. Note any
throwaway parts as "no EARS — throwaway" so the verifier won't demand tests.>

## Decomposition

> Break the feature into mini-specs (one surface each). A mini-spec that is BOTH
> on the critical path AND high-risk is **pair-don't-loop** — implement it with a
> human, not an unattended /goal or /loop. Loopable minis go through
> feature-implementer → spec-verifier.

| Mini-spec               | Layer (real path)                | Depends on | Risk                | Mode                                      |
| ----------------------- | -------------------------------- | ---------- | ------------------- | ----------------------------------------- |
| <e.g. result DTO + Zod> | `packages/schemas`               | —          | low                 | loopable-with-verifier                    |
| <e.g. uncertainty calc> | `packages/math-engine`           | schema     | med                 | loopable-with-verifier (oracle + dossier) |
| <e.g. approve endpoint> | `apps/api/src/routes` + RBAC     | calc       | **high + critical** | **pair-don't-loop**                       |
| <e.g. feature page>     | `apps/web/src/features/<domain>` | api        | low                 | loopable-with-verifier                    |

**Rule:** flag every critical-path + high-risk mini as **pair-don't-loop** in the
Mode column. Anything touching calibration approval, ICP-Brasil signing, or
RBAC/tenancy is pair-don't-loop by default (see `calibrafacil-domain` cut lines).
