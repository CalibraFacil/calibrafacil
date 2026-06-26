import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  BillingDocumentStatus,
  CertificateReleasePolicyMode,
  ReceivableInstallmentStatus,
} from "@calibra-facil/shared";

const mocks = vi.hoisted(
  (): {
    policyRows: Array<{
      id: number;
      mode: CertificateReleasePolicyMode;
      customerId: number | null;
      commercialAgreementId: number | null;
      serviceCategory: string | null;
      priority: number;
    }>;
  } => ({
    policyRows: [],
  }),
);

vi.mock("@calibra-facil/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => mocks.policyRows),
      })),
    })),
  },
}));

import {
  evaluateReleaseStatus,
  resolveCertificateReleasePolicy,
  type CertificateReleaseEvaluatorPaymentState,
} from "../certificate-release";

function paymentState(
  overrides: Partial<CertificateReleaseEvaluatorPaymentState> = {},
): CertificateReleaseEvaluatorPaymentState {
  return {
    hasBillingDocument: false,
    billingDocumentStatus: null,
    installmentStatuses: [],
    anyInstallmentPaid: false,
    allActiveInstallmentsPaid: false,
    continuityStatus: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.policyRows = [];
});

describe("evaluateReleaseStatus", () => {
  it("returns RELEASED_BY_EXCEPTION when an exception release is active regardless of mode", () => {
    const modes: CertificateReleasePolicyMode[] = [
      "release_after_invoice",
      "release_after_first_installment",
      "release_after_full_payment",
      "trusted_customer",
      "manual_only",
    ];
    for (const mode of modes) {
      expect(
        evaluateReleaseStatus({
          mode,
          paymentState: paymentState(),
          hasExceptionRelease: true,
        }),
      ).toBe("RELEASED_BY_EXCEPTION");
    }
  });

  it("returns RELEASED for manual_only and trusted_customer regardless of payment state", () => {
    const modes: CertificateReleasePolicyMode[] = [
      "manual_only",
      "trusted_customer",
    ];
    for (const mode of modes) {
      expect(
        evaluateReleaseStatus({
          mode,
          paymentState: paymentState(),
          hasExceptionRelease: false,
        }),
      ).toBe("RELEASED");
      expect(
        evaluateReleaseStatus({
          mode,
          paymentState: paymentState({
            hasBillingDocument: true,
            billingDocumentStatus: "OVERDUE",
          }),
          hasExceptionRelease: false,
        }),
      ).toBe("RELEASED");
    }
  });

  describe("release_after_invoice", () => {
    it("HELD_FOR_BILLING when no billing document exists", () => {
      expect(
        evaluateReleaseStatus({
          mode: "release_after_invoice",
          paymentState: paymentState(),
          hasExceptionRelease: false,
        }),
      ).toBe("HELD_FOR_BILLING");
    });

    it.each<BillingDocumentStatus>(["ISSUED", "PAID", "OVERDUE"])(
      "RELEASED when billing document is %s",
      (status) => {
        expect(
          evaluateReleaseStatus({
            mode: "release_after_invoice",
            paymentState: paymentState({
              hasBillingDocument: true,
              billingDocumentStatus: status,
            }),
            hasExceptionRelease: false,
          }),
        ).toBe("RELEASED");
      },
    );

    it.each<BillingDocumentStatus>(["DRAFT", "VOID"])(
      "HELD_FOR_BILLING when billing document is %s",
      (status) => {
        expect(
          evaluateReleaseStatus({
            mode: "release_after_invoice",
            paymentState: paymentState({
              hasBillingDocument: true,
              billingDocumentStatus: status,
            }),
            hasExceptionRelease: false,
          }),
        ).toBe("HELD_FOR_BILLING");
      },
    );
  });

  describe("release_after_first_installment", () => {
    it("HELD_FOR_BILLING when no billing document exists", () => {
      expect(
        evaluateReleaseStatus({
          mode: "release_after_first_installment",
          paymentState: paymentState(),
          hasExceptionRelease: false,
        }),
      ).toBe("HELD_FOR_BILLING");
    });

    it("HELD_FOR_PAYMENT when document exists but no installment has paid", () => {
      expect(
        evaluateReleaseStatus({
          mode: "release_after_first_installment",
          paymentState: paymentState({
            hasBillingDocument: true,
            billingDocumentStatus: "ISSUED",
            installmentStatuses: ["OPEN", "OPEN"],
            anyInstallmentPaid: false,
            allActiveInstallmentsPaid: false,
          }),
          hasExceptionRelease: false,
        }),
      ).toBe("HELD_FOR_PAYMENT");
    });

    it("RELEASED once the first installment is paid even if others remain open", () => {
      expect(
        evaluateReleaseStatus({
          mode: "release_after_first_installment",
          paymentState: paymentState({
            hasBillingDocument: true,
            billingDocumentStatus: "ISSUED",
            installmentStatuses: ["PAID", "OPEN"],
            anyInstallmentPaid: true,
            allActiveInstallmentsPaid: false,
          }),
          hasExceptionRelease: false,
        }),
      ).toBe("RELEASED");
    });
  });

  describe("release_after_full_payment", () => {
    it("HELD_FOR_BILLING when no billing document exists", () => {
      expect(
        evaluateReleaseStatus({
          mode: "release_after_full_payment",
          paymentState: paymentState(),
          hasExceptionRelease: false,
        }),
      ).toBe("HELD_FOR_BILLING");
    });

    it("HELD_FOR_PAYMENT when document is ISSUED with a mix of paid + open installments", () => {
      expect(
        evaluateReleaseStatus({
          mode: "release_after_full_payment",
          paymentState: paymentState({
            hasBillingDocument: true,
            billingDocumentStatus: "ISSUED",
            installmentStatuses: ["PAID", "OPEN"],
            anyInstallmentPaid: true,
            allActiveInstallmentsPaid: false,
          }),
          hasExceptionRelease: false,
        }),
      ).toBe("HELD_FOR_PAYMENT");
    });

    it("RELEASED when billing document status reaches PAID", () => {
      expect(
        evaluateReleaseStatus({
          mode: "release_after_full_payment",
          paymentState: paymentState({
            hasBillingDocument: true,
            billingDocumentStatus: "PAID",
            installmentStatuses: ["PAID"],
            anyInstallmentPaid: true,
            allActiveInstallmentsPaid: true,
          }),
          hasExceptionRelease: false,
        }),
      ).toBe("RELEASED");
    });

    it("RELEASED when every non-VOID installment is PAID even if the billing document is still ISSUED", () => {
      expect(
        evaluateReleaseStatus({
          mode: "release_after_full_payment",
          paymentState: paymentState({
            hasBillingDocument: true,
            billingDocumentStatus: "ISSUED",
            installmentStatuses: ["PAID", "PAID"],
            anyInstallmentPaid: true,
            allActiveInstallmentsPaid: true,
          }),
          hasExceptionRelease: false,
        }),
      ).toBe("RELEASED");
    });

    it("HELD_FOR_PAYMENT when billing document is OVERDUE without full payment", () => {
      expect(
        evaluateReleaseStatus({
          mode: "release_after_full_payment",
          paymentState: paymentState({
            hasBillingDocument: true,
            billingDocumentStatus: "OVERDUE",
            installmentStatuses: ["OVERDUE", "OPEN"],
            anyInstallmentPaid: false,
            allActiveInstallmentsPaid: false,
          }),
          hasExceptionRelease: false,
        }),
      ).toBe("HELD_FOR_PAYMENT");
    });
  });

  it("table-driven coverage over (mode × billingDocument×installmentMix) lands on a defined status", () => {
    const modes: CertificateReleasePolicyMode[] = [
      "release_after_invoice",
      "release_after_first_installment",
      "release_after_full_payment",
      "trusted_customer",
      "manual_only",
    ];
    const docStatuses: Array<BillingDocumentStatus | null> = [
      null,
      "DRAFT",
      "ISSUED",
      "OVERDUE",
      "PAID",
      "VOID",
    ];
    const installmentMixes: Array<ReceivableInstallmentStatus[]> = [
      [],
      ["OPEN"],
      ["PAID"],
      ["OPEN", "PAID"],
      ["OVERDUE"],
      ["VOID"],
    ];
    const allowed = new Set<string>([
      "RELEASED",
      "RELEASED_BY_EXCEPTION",
      "HELD_FOR_BILLING",
      "HELD_FOR_PAYMENT",
    ]);
    for (const mode of modes) {
      for (const docStatus of docStatuses) {
        for (const mix of installmentMixes) {
          const active = mix.filter((s) => s !== "VOID");
          const result = evaluateReleaseStatus({
            mode,
            paymentState: paymentState({
              hasBillingDocument: docStatus !== null,
              billingDocumentStatus: docStatus,
              installmentStatuses: active,
              anyInstallmentPaid: active.some((s) => s === "PAID"),
              allActiveInstallmentsPaid:
                active.length > 0 && active.every((s) => s === "PAID"),
            }),
            hasExceptionRelease: false,
          });
          expect(allowed.has(result)).toBe(true);
        }
      }
    }
  });
});

describe("resolveCertificateReleasePolicy", () => {
  it("returns the fallback policy when no rows match", async () => {
    mocks.policyRows = [];
    const result = await resolveCertificateReleasePolicy({
      organizationId: "org_1",
      customerId: 10,
      commercialAgreementId: null,
      serviceName: null,
    });
    expect(result).toEqual({
      id: null,
      mode: "manual_only",
      scope: "fallback",
    });
  });

  it("returns the org-default policy when only the default is present", async () => {
    mocks.policyRows = [
      {
        id: 1,
        mode: "release_after_invoice",
        customerId: null,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
    ];
    const result = await resolveCertificateReleasePolicy({
      organizationId: "org_1",
      customerId: 10,
      commercialAgreementId: null,
      serviceName: null,
    });
    expect(result.id).toBe(1);
    expect(result.mode).toBe("release_after_invoice");
    expect(result.scope).toBe("organization");
  });

  it("prefers a customer-scoped override over the org default", async () => {
    mocks.policyRows = [
      {
        id: 1,
        mode: "manual_only",
        customerId: null,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
      {
        id: 2,
        mode: "release_after_full_payment",
        customerId: 10,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
    ];
    const result = await resolveCertificateReleasePolicy({
      organizationId: "org_1",
      customerId: 10,
      commercialAgreementId: null,
      serviceName: null,
    });
    expect(result.id).toBe(2);
    expect(result.scope).toBe("customer");
    expect(result.mode).toBe("release_after_full_payment");
  });

  it("prefers an agreement-scoped override over a service-name override", async () => {
    mocks.policyRows = [
      {
        id: 1,
        mode: "manual_only",
        customerId: null,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
      {
        id: 2,
        mode: "release_after_first_installment",
        customerId: null,
        commercialAgreementId: null,
        serviceCategory: "Calibracao de Paquimetro",
        priority: 0,
      },
      {
        id: 3,
        mode: "release_after_invoice",
        customerId: null,
        commercialAgreementId: 99,
        serviceCategory: null,
        priority: 0,
      },
    ];
    const result = await resolveCertificateReleasePolicy({
      organizationId: "org_1",
      customerId: null,
      commercialAgreementId: 99,
      serviceName: "Calibracao de Paquimetro",
    });
    expect(result.id).toBe(3);
    expect(result.scope).toBe("agreement");
  });

  it("matches a service-name override case-insensitively", async () => {
    mocks.policyRows = [
      {
        id: 1,
        mode: "manual_only",
        customerId: null,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
      {
        id: 2,
        mode: "release_after_first_installment",
        customerId: null,
        commercialAgreementId: null,
        serviceCategory: "Calibração de Paquímetro",
        priority: 0,
      },
    ];
    const result = await resolveCertificateReleasePolicy({
      organizationId: "org_1",
      customerId: null,
      commercialAgreementId: null,
      serviceName: "  CALIBRAÇÃO DE PAQUÍMETRO  ",
    });
    expect(result.id).toBe(2);
    expect(result.scope).toBe("service");
  });

  it("falls back to the org default when the customer / agreement / service do not match", async () => {
    mocks.policyRows = [
      {
        id: 1,
        mode: "release_after_invoice",
        customerId: null,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
      {
        id: 2,
        mode: "release_after_full_payment",
        customerId: 999,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
    ];
    const result = await resolveCertificateReleasePolicy({
      organizationId: "org_1",
      customerId: 10,
      commercialAgreementId: null,
      serviceName: null,
    });
    expect(result.id).toBe(1);
    expect(result.scope).toBe("organization");
  });

  it("breaks ties within a specificity tier by higher priority, then higher id", async () => {
    mocks.policyRows = [
      {
        id: 5,
        mode: "manual_only",
        customerId: 10,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
      {
        id: 7,
        mode: "release_after_invoice",
        customerId: 10,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 10,
      },
      {
        id: 8,
        mode: "release_after_first_installment",
        customerId: 10,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
    ];
    const result = await resolveCertificateReleasePolicy({
      organizationId: "org_1",
      customerId: 10,
      commercialAgreementId: null,
      serviceName: null,
    });
    expect(result.id).toBe(7);
    expect(result.scope).toBe("customer");
  });
});
