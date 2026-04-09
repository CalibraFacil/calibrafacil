import { describe, expect, it } from "vitest";
import { syncComplianceWithActiveAgreement } from "../finance";

describe("syncComplianceWithActiveAgreement", () => {
  it("clears contract linkage when no active agreement exists", () => {
    expect(
      syncComplianceWithActiveAgreement(
        {
          qualificationStatus: "qualified",
          contractAgreementId: 42,
          contractNumber: "CTR-42",
          contractSignedAt: "2026-04-01T00:00:00.000Z",
          contractExpiresAt: "2026-12-31T00:00:00.000Z",
          qualityRequirementsAcknowledged: true,
          qualityRequirementsAcknowledgedAt: "2026-04-02T00:00:00.000Z",
          notes: "cliente validado",
        },
        null,
      ),
    ).toEqual({
      qualificationStatus: "qualified",
      contractAgreementId: undefined,
      contractNumber: undefined,
      contractSignedAt: undefined,
      contractExpiresAt: undefined,
      qualityRequirementsAcknowledged: false,
      qualityRequirementsAcknowledgedAt: undefined,
      qualificationDate: undefined,
      qualificationExpiresAt: undefined,
      notes: "cliente validado",
    });
  });

  it("resets signature state when the active agreement changed", () => {
    expect(
      syncComplianceWithActiveAgreement(
        {
          qualificationStatus: "qualified",
          contractAgreementId: 41,
          contractSignedAt: "2026-04-01T00:00:00.000Z",
          qualityRequirementsAcknowledged: true,
          qualityRequirementsAcknowledgedAt: "2026-04-02T00:00:00.000Z",
        },
        {
          id: 99,
          agreementCode: "CTR-99",
          title: "Contrato financeiro",
          effectiveFrom: "2026-04-09T00:00:00.000Z",
          effectiveTo: "2027-04-09T00:00:00.000Z",
          currency: "BRL",
          defaultPaymentTermDays: 28,
        },
      ),
    ).toEqual({
      qualificationStatus: "qualified",
      qualificationDate: undefined,
      qualificationExpiresAt: undefined,
      contractAgreementId: 99,
      contractNumber: "CTR-99",
      contractSignedAt: undefined,
      contractExpiresAt: "2027-04-09T00:00:00.000Z",
      qualityRequirementsAcknowledged: false,
      qualityRequirementsAcknowledgedAt: undefined,
      notes: undefined,
    });
  });

  it("preserves signature state when the active agreement is unchanged", () => {
    expect(
      syncComplianceWithActiveAgreement(
        {
          qualificationStatus: "pending",
          contractAgreementId: 99,
          contractSignedAt: "2026-04-01T00:00:00.000Z",
          qualityRequirementsAcknowledged: true,
          qualityRequirementsAcknowledgedAt: "2026-04-02T00:00:00.000Z",
        },
        {
          id: 99,
          agreementCode: null,
          title: "Contrato sem codigo",
          effectiveFrom: "2026-04-09T00:00:00.000Z",
          effectiveTo: null,
          currency: "BRL",
          defaultPaymentTermDays: 28,
        },
      ),
    ).toEqual({
      qualificationStatus: "pending",
      qualificationDate: undefined,
      qualificationExpiresAt: undefined,
      contractAgreementId: 99,
      contractNumber: "Contrato #99",
      contractSignedAt: "2026-04-01T00:00:00.000Z",
      contractExpiresAt: undefined,
      qualityRequirementsAcknowledged: true,
      qualityRequirementsAcknowledgedAt: "2026-04-02T00:00:00.000Z",
      notes: undefined,
    });
  });
});
