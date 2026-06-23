# Mini-spec [HIGH RISK — money/compliance]: billing gate + compliance sync

Target: `apps/api/src/lib/finance.ts` — `evaluateOrderBlockers`,
`syncComplianceWithActiveAgreement` (both PURE). Test file:
`apps/api/src/lib/__tests__/finance.spec.ts` (apps/api uses `.spec.ts` in `__tests__/`).
The async DB functions in this file are OUT OF SCOPE.

## Discipline
`evaluateOrderBlockers` gates whether an order can be billed; a missed blocker = billing on
bad data, a spurious blocker = stuck revenue. Assert EXACT blocker sets. NOT a cut-line, but
flag anything that looks wrong. Do NOT modify production code. Read the source for the exact
`BillingBlocker` shape (code/label/owner/fixAction/scope).

## Acceptance Criteria

- REQ-BLK-001: WHEN customer `taxId` is null/empty/whitespace, `evaluateOrderBlockers` SHALL
  include a `BLOCKED_BY_CUSTOMER_DATA` blocker for the missing CPF/CNPJ. [HIGH RISK]
- REQ-BLK-002: WHEN customer `email` is null/empty/whitespace, it SHALL include a
  `BLOCKED_BY_CUSTOMER_DATA` blocker for the missing e-mail.
- REQ-BLK-003: WHEN `address` is null OR `city`/`state` is empty/whitespace, it SHALL include
  the "Endereço do cliente incompleto" `BLOCKED_BY_CUSTOMER_DATA` blocker. [HIGH RISK]
- REQ-BLK-004: WHEN `certificateJobStatuses` is non-empty AND none is `APPROVED` or
  `SUPERSEDED`, it SHALL include a `BLOCKED_BY_CERTIFICATE_STATUS` blocker (owner `lab_ops`).
  WHEN at least one is `APPROVED`/`SUPERSEDED`, it SHALL NOT. WHEN the list is empty, it
  SHALL NOT (no certificate gate). [HIGH RISK]
- REQ-BLK-005: WHEN `amountCents <= 0`, it SHALL include a `BLOCKED_BY_UNMAPPED_SERVICE`
  blocker (owner `admin`); WHEN `amountCents > 0` it SHALL NOT. [HIGH RISK]
- REQ-BLK-006: WHEN customer data is complete, a certificate is approved, and amount > 0,
  `evaluateOrderBlockers` SHALL return an EMPTY array (fully billable). [HIGH RISK]
- REQ-BLK-007: WHEN multiple conditions fail at once, it SHALL return ALL applicable blockers
  (assert the exact set/length — no dedup that would hide a fault).
- REQ-CMP-001: IF `syncComplianceWithActiveAgreement` receives `activeAgreement = null`, THEN
  it SHALL clear all contract fields (`contractAgreementId`/`contractNumber`/
  `contractSignedAt`/`contractExpiresAt` → undefined) and set
  `qualityRequirementsAcknowledged = false`, preserving the other base compliance fields.
  [HIGH RISK]
- REQ-CMP-002: WHEN the active agreement's id DIFFERS from the current
  `contractAgreementId` (agreement changed), it SHALL reset `contractSignedAt` and
  `qualityRequirementsAcknowledged`/`...At` (re-acknowledgement required for a new contract).
  [HIGH RISK]
- REQ-CMP-003: WHEN the active agreement id MATCHES the current `contractAgreementId`
  (unchanged), it SHALL keep `qualityRequirementsAcknowledged` and `contractSignedAt` as-is
  and set `contractNumber`/`contractExpiresAt` from the agreement.
- REQ-CMP-004: WHEN `currentCompliance` is null/undefined, it SHALL still return a valid
  compliance object with defaults (`qualificationStatus: "pending"`,
  `qualityRequirementsAcknowledged: false`).

Implementer: assert blocker `code` values exactly. Use a typed fixture builder for the
customer/agreement inputs (no `as`).
