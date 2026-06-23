# From-template wizard — URL-driven steps — Spec

> The "Novo método a partir de modelo" wizard (`/dashboard/methods/from-template`)
> currently holds its 3 steps (Modelo → Contexto → Confirmação) in component
> `useState`, so the URL never changes. Browser-back and the breadcrumb therefore
> leave the wizard entirely (dumping the user on `/dashboard/methods`) instead of
> stepping back inside it. This spec makes the wizard step URL-driven.

## Intent

A lab user adopting a curated method template moves Modelo → Contexto →
Confirmação. They expect the browser back button (and an in-wizard control) to
walk back a step — to the template catalog — not to abandon the wizard. "Done"
= the wizard step lives in the URL search params, browser history walks the
steps, deep-links/refresh resolve to a sane step, and the existing compliance
flow (acknowledgements, DRAFT creation, post-adopt navigation) is unchanged.

## Constraints

- **Frontend only — no cut-line surface touched.** No RBAC/tenancy
  (`packages/auth`, `apps/api/.../permission.ts`), no signing, no
  `packages/math-engine`, no calibration state machine. If implementation appears
  to need any of these, STOP and flag.
- Follow the route-adapter contract: the route file
  (`apps/web/src/routes/dashboard/methods/from-template.tsx`) owns
  `validateSearch` and passes the parsed `search` to the feature page as a prop.
  The feature module (`apps/web/src/features/methods/from-template-page.tsx`) MUST
  NOT call `createFileRoute`, `Route.use*`, `useParams`, or `useSearch`; it reads
  search via props and changes steps via `useNavigate`
  (`docs/architecture/web-frontend-architecture.md`).
- No `useEffect` import from `react`; no `as` type assertions (oxlint-enforced).
- Preserve the existing compliance semantics in
  `from-template-page.tsx`: catalog cards expose only "Revisar contexto" (no
  adopt affordance); adoption creates a DRAFT; the three acknowledgements are
  required and recorded; acknowledging is NOT the lab's §7.2.1.5 verification.
- Keep the adoption success path: `calibraApi.methods.fromTemplate(...)` then
  `navigate({ to: '/dashboard/methods/$id', params: { id } })`.

## Acceptance Criteria (EARS)

- REQ-FTPL-001: The from-template route SHALL derive the active wizard step from a
  validated `step` search param with allowed values `catalog`, `context`,
  `confirm`, defaulting to `catalog` when the param is absent.
- REQ-FTPL-002: IF the `step` search param is present but not one of `catalog`,
  `context`, `confirm`, THEN the route SHALL resolve the step to `catalog` without
  throwing.
- REQ-FTPL-003: WHEN the user activates "Revisar contexto" on a template card, the
  page SHALL call `navigate` so the resulting location search is
  `{ step: 'context', template: <that card's templateKey> }` (URL changes; no
  component-local step state).
- REQ-FTPL-004: WHEN the wizard is on the context step reached from the catalog
  and the browser issues a history "back", the page SHALL render the catalog step
  (step transitions push history entries — forward navigations SHALL NOT use
  `replace`).
- REQ-FTPL-005: IF `step` is `context` or `confirm` but the `template` param is
  missing or matches no loaded template, THEN the page SHALL render the catalog
  step.
- REQ-FTPL-006: WHEN the user clicks an already-completed step in the
  `WizardStepper`, the page SHALL navigate to that step's search params, and
  clicking "Modelo" SHALL navigate to `{ step: 'catalog' }`.
- REQ-FTPL-007: WHEN the confirm step is rendered for a template, the three
  acknowledgement checkboxes SHALL start unchecked and "Criar rascunho" SHALL stay
  disabled until all three are checked and the name is ≥ 2 chars.
- REQ-FTPL-008: WHEN the user submits "Criar rascunho" with all acknowledgements
  checked, the page SHALL call `calibraApi.methods.fromTemplate` with the selected
  `templateKey` and, on success, navigate to `/dashboard/methods/$id` for the
  returned method id.
- REQ-FTPL-009: The breadcrumb for the route `/dashboard/methods/from-template`
  SHALL render the label "A partir de modelo" (not the raw `from-template`
  segment).

## Out-of-scope / Deferred

- Persisting partially-typed method name / asset-type choice across a full page
  refresh (component state is fine to reset on hard reload).
- Encoding the acknowledgement state in the URL (acks intentionally reset on
  re-entry per compliance).
- Any change to the catalog/context content, governance panels, or the adoption
  payload shape.
- Server/API behavior, DB schema — untouched.

## Decomposition

| Mini-spec | Layer (real path) | Depends on | Risk | Mode |
| --- | --- | --- | --- | --- |
| URL-driven wizard (route `validateSearch` + search-prop wiring + step→navigate + deep-link guard + stepper nav) | `apps/web/src/routes/dashboard/methods/from-template.tsx` + `apps/web/src/features/methods/from-template-page.tsx` (+ `components/wizard-stepper.tsx`) | — | low (frontend only, no cut line) | loopable-with-verifier |

Single mini-spec; covers REQ-FTPL-001 … 009. No pair-don't-loop surface involved.
