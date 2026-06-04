# Financeiro revamp — architecture & decision record

Status: **in progress** (Wave 1). Branch: `pr-333-merge-main` (folded onto the
native Conta Azul PR #333). Tracking goal: `.goals/financeiro-revamp.md`.

## Context

The Financeiro module is operationally functional but carries structural UX
debt: a flat information hierarchy (every card the same weight), form-driven
flows where timeline/workflow-driven ones belong, opaque IDs instead of names,
no list filtering or bulk actions, and a Conta Azul ERP surface that feels
"laggy/buggy" — the concrete reason PR #333 is being held back from merge.

Separately, a large slice of finance capability is **shipped but invisible**:
four analytics pages (`cash-forecast`, `margin-dashboards`, `operations-to-cash`,
`revenue-leakage`) are fully implemented but have **no navigation entry**, and
certificate-release policies + automatic-send rules have full backend CRUD with
**no UI at all**.

This redesign reworks the experience from first principles — benchmarked against
Linear / Stripe / Mercury / Ramp — rather than reskinning the existing screens.
It ships in **waves** so each is independently reviewable and the already-large
PR #333 stays mergeable.

## What the audit found (summary)

- **Console (`overview`)**: KPIs are bare numbers with no trend/drill-down;
  recent-documents table and aging buckets are not actionable.
- **Documents / Receipts**: two separate pages for one mental model
  (receivables); no status filter, no bulk export/issue; receipt registration is
  modal-only; discount entered as raw cents with no currency formatting; service
  / unit shown as opaque IDs (`Serviço #123`).
- **Document detail**: six equal-weight cards; no scannable state summary.
- **Contracts**: no inline lifecycle actions; `new-contract` duplicates the
  "Condições comerciais" block and the service-terms editor is tedious.
- **Conta Azul ERP**: broad query invalidations cause refetch storms (a single
  `send`/mutation invalidates 3–4 prefix keys, each matching every cached list
  variant); no optimistic state for sync/poll/token-refresh; error states hidden
  inside dropdowns/modals; drift queue only handles `REMOTE_MISSING`.

## Information architecture (new)

Finance nav is regrouped around operator jobs (single-level nav, the only depth
the sidebar supports), in `apps/web/src/app/router/route-meta.ts`:

| Label      | Route                                   | Notes |
|------------|-----------------------------------------|-------|
| Painel     | `/dashboard/finance`                    | overview → actionable operator console |
| Cobrança   | `/dashboard/finance/billing-readiness`  | renamed from "Pronto para faturar" |
| Recebíveis | `/dashboard/finance/receivables`        | **new** unified workspace (merges documents + receipts) |
| Contratos  | `/dashboard/finance/contracts`          | unchanged URL |
| Análises   | `/dashboard/finance/analytics`          | **new** hub surfacing the 4 orphaned analytics |
| Automação  | `/dashboard/finance/automation`         | **new** — release policies + auto-send rules UI |
| ERP        | `/dashboard/finance/erp`                | unchanged |

Old links keep working via redirects (`documents/index`, `receipts` →
`receivables`) registered in `dashboardRedirectRouteMeta`. `documents/$id` and
`documents/new` stay as deep/power-user routes (and for shareable links).

## Design system

Build on the shared instrument-panel primitives
(`apps/web/src/components/instrument-panel.tsx`: `Panel`, `PanelHeader`,
`SignalTile`, `BlueprintGrid/Field`, `StaggerGroup/Item`, `InfoHint`,
`ACTION_BUTTON_CLASS`) and existing `components/ui/*` leaves (`Sheet` drawer,
`DataTable`/TanStack, `Popover`, `Command`, `Checkbox`, `Timeline`, `Tabs`).

New finance-scoped conventions:

- **`features/finance/finance-display.tsx`** — `Money` (mono tabular, tone-tinted)
  and `*Tone(status)` maps (`satisfies Record<Union, SignalTone>`, so a new enum
  member fails type-check until classified). Single source of finance status
  semantics, complementing the existing `finance-status-badges.tsx`.
- **`components/ui/currency-input.tsx`** — controlled `valueCents` money input;
  edits a plain decimal string and emits parsed cents via the existing
  `parseFinanceCurrencyInputToCents`. Replaces raw cents inputs.
- _(landing with their first consumer in Wave 1e)_ a finance data-table pattern
  with URL-synced filter state + row selection + bulk-action bar, a
  `preview-drawer` over `Sheet`, and an `inline-edit-field` (keyed-remount, not
  `useEffect`).

Constraints honored throughout: no `useEffect` (derived state / event handlers /
keyed remount / `use-mount-effect`), no `as` assertions (`satisfies` / type
guards / schema parse), thin route adapters, schema-first regulated forms,
`head` metadata on every renderable route.

## The query-invalidation fix (Conta Azul "lag")

Current anti-pattern (e.g. `document-detail-page.tsx`, `receipts-page.tsx`,
`billing-readiness-page.tsx`, `integrations-page.tsx`): each mutation fires
several `invalidateQueries({ queryKey: ['finance','documents'] })`-style **prefix**
invalidations. A bare prefix matches every cached list variant
(`['finance','documents', search]`) *and* detail keys, so one action refetches N
lists + detail + receipts + overview. `integrations-page.tsx` even carries a
`predicate: query.queryKey[3] !== 'catalog'` band-aid to dampen the storm.

Corrected pattern (already proven in
`features/settings/integrations/conta-azul-mutations.ts`'s config mutation):
`onMutate` snapshot + optimistic `setQueryData`; `onSuccess` writes the server
payload into the **specific** detail key and patches the visible list row in
place via `setQueryData`; aggregate views (overview) invalidate **once** with
`refetchType: 'active'`; `onError` rolls back. Centralized in a new
`features/finance/mutations.ts`. The catalog-exclusion band-aid is then removed.

## Phased roadmap

> **Execution reference:** detailed, file-grounded implementation specs for every
> remaining surface — plus the critic's build order and append-only rules for the
> shared registries (`mutations.ts`, `forms.ts`, `route-meta.ts`,
> `finance-display.tsx`, `queries.ts`) — live in
> [`finance-revamp-specs.md`](./finance-revamp-specs.md).
>
> Critic build order: **`mutations.ts` → Conta Azul lag fix → shared primitives
> (`finance-data-table`, `inline-edit-field`) → Receivables (1e) → Contracts (2)
> → Automação (2) → Analytics (3) → Document detail (4) → forms (5)**.

- **Wave 1** — design-system foundation; **operator console** (actionable vitals
  + worklists); **unified Receivables workspace** (filter + bulk + preview drawer
  + inline receipt); **Conta Azul lag/bug fixes** (targeted `setQueryData`,
  optimistic sync state, surfaced errors).
- **Wave 2** — Contracts redesign + **Automação** UIs (release policies,
  auto-send rules — backend exists, no UI today).
- **Wave 3** — actionable Analytics hub (drill-downs from cards into filtered
  receivables; clickable aging buckets).
- **Wave 4** — document-detail timeline redesign (status summary + `Timeline` +
  inline edit) replacing the six-card layout.
- **Wave 5** — `new-document`/`new-contract` form redesigns, saved views,
  command-palette finance actions, keyboard nav.

## Migration / rollout

- `overview-page.tsx` keeps its exported `FinanceOverviewPage` symbol (delegates
  internally) so route adapters don't churn during Wave 1.
- Redirects added rather than routes deleted — old bookmarks survive.
- Conta Azul invalidation fixes are behavior-preserving (same endpoints, fewer
  refetches) and can ship/verify independently of the UI restructure.
- A consolidated `listReceivables` (documents joined with installments) is a
  flagged **server-side ask** for Wave 1e; until then the workspace composes
  `listDocuments` + `listReceipts`.

## Verification

CI parity is Node 22 + `TZ=UTC` (see the local-test-run note). Each wave:
`pnpm --dir apps/web check-types` (tsgo), `oxlint` (incl. the no-useEffect rule),
and `vitest run` under `TZ=UTC`. `dashboard-route-heads.test.ts` must stay green
(every new renderable route carries `head` title metadata).
