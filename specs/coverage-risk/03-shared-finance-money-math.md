# Mini-spec [HIGH RISK — money]: shared finance money math

Target: `packages/shared/src/finance.ts` — `summarizeInstallments`,
`calculateFinancialDueDate`, `formatMoney`, `DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS`
(and, if reachable without heavy fixtures, `deriveFinancialContinuityStatus`,
`buildFinancialFreshness`).
Test file: `packages/shared/src/finance.test.ts`

## Discipline

Money correctness. Assert EXACT computed values. NOT a cut-line, but if any computed
value looks wrong (esp. the installment aggregation), FLAG it in your report rather than
silently asserting it. Do NOT modify production code.

## Acceptance Criteria

- REQ-FIN-001: WHEN `summarizeInstallments` receives an empty array, it SHALL return the
  zeroed summary (all counts and \*Cents fields 0).
- REQ-FIN-002: `summarizeInstallments.total` SHALL equal the COUNT of all installments
  including `VOID`; a `VOID` installment SHALL increment `voidCount` and SHALL be excluded
  from `totalCents`. [HIGH RISK]
- REQ-FIN-003: WHEN an installment is `PAID`, `summarizeInstallments` SHALL add its
  amountCents to `paidCents` and `totalCents` and increment `paidCount`.
- REQ-FIN-004: WHEN an installment is `OPEN`, it SHALL add to `openCents` + `totalCents` and
  increment `openCount`.
- REQ-FIN-005: WHEN an installment is `OVERDUE`, it SHALL add its amount to BOTH `openCents`
  AND `overdueCents` (and `totalCents`) and increment `overdueCount` (overdue is a subset of
  open). Assert the double-attribution into openCents explicitly. [HIGH RISK]
- REQ-FIN-006: WHEN `summarizeInstallments` receives a MIX (paid+open+overdue+void), every
  field SHALL equal the hand-computed totals (assert the whole returned summary object).
  [HIGH RISK]
- REQ-FIN-007: `calculateFinancialDueDate(issueDate)` SHALL default to a 28-day term
  (`DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS === 28`) and return `issueDate + termDays`.
- REQ-FIN-008: `calculateFinancialDueDate` SHALL roll over month boundaries via Date
  arithmetic (e.g. `2026-01-20 + 28d → 2026-02-17`) and SHALL NOT mutate the passed
  `issueDate` (it copies). Assert the input Date is unchanged. [HIGH RISK]
- REQ-FIN-009: `formatMoney(cents)` SHALL format `cents/100` as pt-BR BRL currency
  (e.g. `123456 → "R$ 1.234,56"`, `0 → "R$ 0,00"`, negative handled). Assert the
  exact string (account for the non-breaking space in `Intl` output). [HIGH RISK]
- REQ-FIN-010: `formatMoney(cents, currency)` SHALL honor a non-default currency code
  (e.g. `"USD"`).

Implementer: run with `TZ=UTC`. Construct dates with `new Date(Date.UTC(...))`. If the ICU
locale data isn't present and `formatMoney` output differs, report it (do not weaken the
assertion to a substring unless you document why).
