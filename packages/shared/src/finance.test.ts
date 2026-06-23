import { describe, expect, it } from "vitest";
import {
  DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
  type FinancialInstallmentStatus,
  buildFinancialFreshness,
  calculateFinancialDueDate,
  deriveFinancialContinuityStatus,
  formatMoney,
  getFinancialContinuityStatusLabel,
  summarizeInstallments,
} from "./finance";

// ---------------------------------------------------------------------------
// Typed fixture builder — avoids `as` assertions (banned by repo rules)
// ---------------------------------------------------------------------------
type InstallmentFixture = Pick<FinancialInstallmentStatus, "status" | "amountCents">;

function installment(
  status: InstallmentFixture["status"],
  amountCents: number,
): InstallmentFixture {
  return { status, amountCents };
}

// The non-breaking space (U+00A0) that Intl.NumberFormat emits between the
// currency symbol and the number in pt-BR locale. Using the literal character
// here so assertions are legible even though 0xA0 ≠ 0x20.
const NBSP = " ";

// =============================================================================
// REQ-FIN-001 … REQ-FIN-006  summarizeInstallments
// =============================================================================

describe("summarizeInstallments", () => {
  // REQ-FIN-001: empty array returns a fully-zeroed summary
  it("REQ-FIN-001: empty array → all-zero summary", () => {
    const result = summarizeInstallments([]);
    expect(result).toStrictEqual({
      total: 0,
      totalCents: 0,
      paidCents: 0,
      openCents: 0,
      overdueCents: 0,
      paidCount: 0,
      openCount: 0,
      overdueCount: 0,
      voidCount: 0,
    });
  });

  // REQ-FIN-002: VOID increments voidCount + counts toward total but is excluded
  // from totalCents.  [HIGH RISK]
  it("REQ-FIN-002: VOID installment increments voidCount and total but NOT totalCents", () => {
    const result = summarizeInstallments([
      installment("VOID", 10000),
    ]);
    expect(result.total).toBe(1);          // VOID still counted in total (row count)
    expect(result.voidCount).toBe(1);
    expect(result.totalCents).toBe(0);     // excluded from money total
    expect(result.paidCents).toBe(0);
    expect(result.openCents).toBe(0);
    expect(result.overdueCents).toBe(0);
  });

  // REQ-FIN-003: PAID installment → paidCents + totalCents, paidCount++
  it("REQ-FIN-003: PAID installment adds to paidCents and totalCents", () => {
    const result = summarizeInstallments([
      installment("PAID", 50000),
    ]);
    expect(result.paidCents).toBe(50000);
    expect(result.totalCents).toBe(50000);
    expect(result.paidCount).toBe(1);
    expect(result.openCents).toBe(0);
    expect(result.overdueCents).toBe(0);
    expect(result.openCount).toBe(0);
  });

  // REQ-FIN-004: OPEN installment → openCents + totalCents, openCount++
  it("REQ-FIN-004: OPEN installment adds to openCents and totalCents", () => {
    const result = summarizeInstallments([
      installment("OPEN", 30000),
    ]);
    expect(result.openCents).toBe(30000);
    expect(result.totalCents).toBe(30000);
    expect(result.openCount).toBe(1);
    expect(result.paidCents).toBe(0);
    expect(result.overdueCents).toBe(0);
    expect(result.paidCount).toBe(0);
  });

  // REQ-FIN-005: OVERDUE contributes to BOTH openCents AND overdueCents (subset
  // relationship).  [HIGH RISK] — assert the double-attribution explicitly.
  it("REQ-FIN-005: OVERDUE amount is counted in BOTH openCents and overdueCents", () => {
    const result = summarizeInstallments([
      installment("OVERDUE", 25000),
    ]);
    expect(result.overdueCents).toBe(25000);  // dedicated overdue bucket
    expect(result.openCents).toBe(25000);     // ALSO in open (overdue ⊆ open)
    expect(result.totalCents).toBe(25000);
    expect(result.overdueCount).toBe(1);
    // open count does NOT increment for overdue (separate counter)
    expect(result.openCount).toBe(0);
    expect(result.paidCents).toBe(0);
    expect(result.paidCount).toBe(0);
  });

  // REQ-FIN-006: mixed scenario — full object assertion  [HIGH RISK]
  // Hand-computed:
  //   total      = 5 (all rows incl. VOID)
  //   voidCount  = 1
  //   paidCents  = 60000 (one PAID 60000)
  //   openCents  = 40000 (OPEN 15000) + 25000 (OVERDUE 25000) = 40000
  //   overdueCents = 25000
  //   totalCents = 60000 + 15000 + 25000 = 100000 (VOID excluded)
  //   paidCount  = 1, openCount = 1, overdueCount = 1
  it("REQ-FIN-006: mixed paid+open+overdue+void produces correct full summary", () => {
    const fixtures: InstallmentFixture[] = [
      installment("PAID", 60000),
      installment("OPEN", 15000),
      installment("OVERDUE", 25000),
      installment("VOID", 99999),   // should not affect any money total
      installment("PAID", 0),       // zero-amount PAID — still counted
    ];
    const result = summarizeInstallments(fixtures);
    expect(result).toStrictEqual({
      total: 5,
      totalCents: 100000,   // 60000 + 15000 + 25000 + 0 (VOID excluded, 0-amt PAID included)
      paidCents: 60000,     // 60000 + 0
      openCents: 40000,     // OPEN 15000 + OVERDUE 25000
      overdueCents: 25000,
      paidCount: 2,
      openCount: 1,
      overdueCount: 1,
      voidCount: 1,
    });
  });

  // Extra: two OVERDUE rows confirm accumulation
  it("REQ-FIN-005 (multi): two OVERDUE rows both count in openCents and overdueCents", () => {
    const result = summarizeInstallments([
      installment("OVERDUE", 10000),
      installment("OVERDUE", 5000),
    ]);
    expect(result.overdueCents).toBe(15000);
    expect(result.openCents).toBe(15000);
    expect(result.totalCents).toBe(15000);
    expect(result.overdueCount).toBe(2);
    expect(result.openCount).toBe(0);
  });
});

// =============================================================================
// REQ-FIN-007 … REQ-FIN-008  calculateFinancialDueDate
// =============================================================================

describe("calculateFinancialDueDate", () => {
  // REQ-FIN-007: constant is 28, default term adds 28 days
  it("REQ-FIN-007: DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS is 28 and is the default term", () => {
    expect(DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS).toBe(28);

    const issue = new Date(Date.UTC(2026, 0, 1)); // 2026-01-01
    const due = calculateFinancialDueDate(issue);
    expect(due.toISOString().slice(0, 10)).toBe("2026-01-29"); // +28 days
  });

  // REQ-FIN-008: month rollover and no mutation  [HIGH RISK]
  it("REQ-FIN-008: rolls over month boundary and does NOT mutate the input Date", () => {
    const issue = new Date(Date.UTC(2026, 0, 20)); // 2026-01-20
    const originalTime = issue.getTime();

    const due = calculateFinancialDueDate(issue);

    // 2026-01-20 + 28 = 2026-02-17
    expect(due.toISOString().slice(0, 10)).toBe("2026-02-17");

    // input must be unchanged
    expect(issue.getTime()).toBe(originalTime);
    expect(issue.toISOString().slice(0, 10)).toBe("2026-01-20");
  });

  // Additional rollover: end of January into February
  it("REQ-FIN-008 (extra): 2026-01-31 + 28 days → 2026-02-28", () => {
    const issue = new Date(Date.UTC(2026, 0, 31));
    const due = calculateFinancialDueDate(issue);
    expect(due.toISOString().slice(0, 10)).toBe("2026-02-28");
    // verify input untouched
    expect(issue.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  // Custom term works
  it("REQ-FIN-007 (custom term): respects explicit paymentTermDays", () => {
    const issue = new Date(Date.UTC(2026, 2, 1)); // 2026-03-01
    const due = calculateFinancialDueDate(issue, 30);
    expect(due.toISOString().slice(0, 10)).toBe("2026-03-31");
  });
});

// =============================================================================
// REQ-FIN-009 … REQ-FIN-010  formatMoney
// =============================================================================

describe("formatMoney", () => {
  // REQ-FIN-009: exact pt-BR BRL strings incl. non-breaking space  [HIGH RISK]
  it("REQ-FIN-009: formats cents as pt-BR BRL with correct separators", () => {
    // 123456 cents = R$ 1.234,56
    expect(formatMoney(123456)).toBe(`R$${NBSP}1.234,56`);
    // zero
    expect(formatMoney(0)).toBe(`R$${NBSP}0,00`);
    // single cent
    expect(formatMoney(1)).toBe(`R$${NBSP}0,01`);
  });

  it("REQ-FIN-009 (negative): negative cents render with minus sign", () => {
    // -50099 cents = -R$ 500,99
    expect(formatMoney(-50099)).toBe(`-R$${NBSP}500,99`);
  });

  // REQ-FIN-010: non-default currency code is honored
  it("REQ-FIN-010: honors a non-default currency code (USD)", () => {
    const result = formatMoney(100, "USD");
    // Must contain "US$" or "USD" and the amount 1,00 in pt-BR format.
    // Exact Intl output on Node 24: "US$ 1,00" with NBSP
    expect(result).toBe(`US$${NBSP}1,00`);
  });
});

// =============================================================================
// Existing tests (unchanged)
// =============================================================================

describe("deriveFinancialContinuityStatus", () => {
  it("uses readiness blockers before a document exists", () => {
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: false,
        blockers: [],
      }),
    ).toBe("READY_FOR_BILLING");

    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: false,
        blockers: [
          {
            code: "BLOCKED_BY_CUSTOMER_DATA",
            label: "Dados incompletos",
            owner: "finance",
            fixAction: "Completar cadastro",
            scope: "customer",
          },
        ],
      }),
    ).toBe("BLOCKED");
  });

  it("derives payment states from installments", () => {
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        exportStatus: "EXPORTED",
        installmentStatuses: ["OPEN"],
      }),
    ).toBe("AWAITING_PAYMENT");
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        installmentStatuses: ["PAID", "OPEN"],
      }),
    ).toBe("PARTIALLY_PAID");
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        installmentStatuses: ["PAID", "PAID"],
      }),
    ).toBe("PAID");
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        installmentStatuses: ["OPEN", "OVERDUE"],
      }),
    ).toBe("OVERDUE");
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        installmentStatuses: ["VOID", "VOID"],
      }),
    ).toBe("VOID");
  });

  it("lets terminal billing document statuses short-circuit installments", () => {
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        billingDocumentStatus: "VOID",
        installmentStatuses: ["OPEN"],
      }),
    ).toBe("VOID");
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        billingDocumentStatus: "PAID",
        installmentStatuses: ["OPEN"],
      }),
    ).toBe("PAID");
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        billingDocumentStatus: "OVERDUE",
        installmentStatuses: ["PAID"],
      }),
    ).toBe("OVERDUE");
  });

  it("derives sent and not-sent states when no installments exist", () => {
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        billingDocumentStatus: "DRAFT",
        exportStatus: "EXPORTED",
        installmentStatuses: [],
      }),
    ).toBe("SENT_TO_FINANCE");
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        billingDocumentStatus: "ISSUED",
        exportStatus: "EXPORTED",
        installmentStatuses: [],
      }),
    ).toBe("INVOICE_AVAILABLE");
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        exportStatus: "NOT_EXPORTED",
        installmentStatuses: [],
      }),
    ).toBe("NOT_SENT");
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        exportStatus: "FAILED",
        installmentStatuses: [],
      }),
    ).toBe("SYNCHRONIZED_WITH_WARNINGS");
  });

  it("uses an explicit not-configured status for pre-document local-only summaries", () => {
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: false,
        blockers: [],
        isConfigured: false,
      }),
    ).toBe("NOT_CONFIGURED");
  });

  it("keeps terminal payment status when freshness is stale", () => {
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        installmentStatuses: ["PAID"],
        isStale: true,
      }),
    ).toBe("PAID");
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        billingDocumentStatus: "VOID",
        installmentStatuses: ["OPEN"],
        isStale: true,
      }),
    ).toBe("VOID");
  });

  it("does not report non-terminal payment status when freshness is stale", () => {
    expect(
      deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        installmentStatuses: ["OPEN"],
        isStale: true,
      }),
    ).toBe("STATUS_UNAVAILABLE");
    expect(getFinancialContinuityStatusLabel("STATUS_UNAVAILABLE")).toBe(
      "Status indisponível",
    );
  });
});

describe("buildFinancialFreshness", () => {
  it("classifies provider evidence as fresh, stale, unknown, or local only", () => {
    const now = new Date("2026-05-25T12:00:00.000Z");

    expect(
      buildFinancialFreshness({
        hasProviderEvidence: false,
        lastSyncedAt: "2026-05-25T11:00:00.000Z",
        now,
      }).status,
    ).toBe("local_only");
    expect(
      buildFinancialFreshness({
        hasProviderEvidence: true,
        lastSyncedAt: null,
        now,
      }).status,
    ).toBe("unknown");
    expect(
      buildFinancialFreshness({
        integrationState: "connected",
        lastSyncedAt: "2026-05-25T11:00:00.000Z",
        now,
      }).status,
    ).toBe("fresh");
    expect(
      buildFinancialFreshness({
        hasProviderEvidence: true,
        lastSyncedAt: "2026-05-23T11:00:00.000Z",
        now,
      }).status,
    ).toBe("stale");
  });
});
