import { describe, expect, it } from "vitest";
import {
  buildFinancialFreshness,
  deriveFinancialContinuityStatus,
  getFinancialContinuityStatusLabel,
} from "./finance";

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
