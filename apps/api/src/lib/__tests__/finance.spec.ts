import { describe, expect, it } from "vitest";
import type { CustomerAddress, CustomerCompliance } from "@calibra-facil/db/schema";
import type { ActiveCommercialAgreementSummary } from "../finance";
import {
  evaluateOrderBlockers,
  syncComplianceWithActiveAgreement,
} from "../finance";

// ---------------------------------------------------------------------------
// Fixture builders — typed, no `as` assertions.
// ---------------------------------------------------------------------------

function makeCustomer(
  overrides: Partial<{
    taxId: string | null;
    email: string | null;
    address: CustomerAddress | null;
  }> = {},
): { taxId: string | null; email: string | null; address: CustomerAddress | null } {
  return {
    taxId: "12.345.678/0001-90",
    email: "financeiro@cliente.com",
    address: { city: "São Paulo", state: "SP" } satisfies CustomerAddress,
    ...overrides,
  };
}

function makeAgreement(
  overrides: Partial<ActiveCommercialAgreementSummary> = {},
): ActiveCommercialAgreementSummary {
  return {
    id: 10,
    agreementCode: "CTR-10",
    title: "Contrato padrão",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2027-01-01T00:00:00.000Z",
    currency: "BRL",
    defaultPaymentTermDays: 28,
    ...overrides,
  };
}

function makeCompliance(
  overrides: Partial<CustomerCompliance> = {},
): CustomerCompliance {
  return {
    qualificationStatus: "qualified",
    qualityRequirementsAcknowledged: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// evaluateOrderBlockers — existing tests (preserved, not modified)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// REQ-BLK-*: evaluateOrderBlockers characterisation tests
// ---------------------------------------------------------------------------

describe("evaluateOrderBlockers — REQ-BLK-*", () => {
  // REQ-BLK-001: null taxId → BLOCKED_BY_CUSTOMER_DATA (CPF/CNPJ ausente)
  it("REQ-BLK-001: null taxId emits BLOCKED_BY_CUSTOMER_DATA for missing CPF/CNPJ", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer({ taxId: null }),
      certificateJobStatuses: ["APPROVED"],
      amountCents: 5000,
    });
    const taxBlocker = blockers.find(
      (b) => b.code === "BLOCKED_BY_CUSTOMER_DATA" && b.label === "CPF/CNPJ do cliente ausente",
    );
    expect(taxBlocker).toBeDefined();
    expect(taxBlocker?.owner).toBe("finance");
    expect(taxBlocker?.scope).toBe("customer");
  });

  // REQ-BLK-001: whitespace-only taxId is treated the same as null
  it("REQ-BLK-001: whitespace-only taxId emits BLOCKED_BY_CUSTOMER_DATA", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer({ taxId: "   " }),
      certificateJobStatuses: ["APPROVED"],
      amountCents: 5000,
    });
    expect(blockers.some(
      (b) => b.code === "BLOCKED_BY_CUSTOMER_DATA" && b.label === "CPF/CNPJ do cliente ausente",
    )).toBe(true);
  });

  // REQ-BLK-002: null email → BLOCKED_BY_CUSTOMER_DATA (e-mail ausente)
  it("REQ-BLK-002: null email emits BLOCKED_BY_CUSTOMER_DATA for missing e-mail", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer({ email: null }),
      certificateJobStatuses: ["APPROVED"],
      amountCents: 5000,
    });
    const emailBlocker = blockers.find(
      (b) => b.code === "BLOCKED_BY_CUSTOMER_DATA" && b.label === "E-mail do cliente ausente",
    );
    expect(emailBlocker).toBeDefined();
    expect(emailBlocker?.owner).toBe("finance");
    expect(emailBlocker?.scope).toBe("customer");
  });

  // REQ-BLK-002: whitespace-only email is treated the same as null
  it("REQ-BLK-002: whitespace-only email emits BLOCKED_BY_CUSTOMER_DATA", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer({ email: "  " }),
      certificateJobStatuses: ["APPROVED"],
      amountCents: 5000,
    });
    expect(blockers.some(
      (b) => b.code === "BLOCKED_BY_CUSTOMER_DATA" && b.label === "E-mail do cliente ausente",
    )).toBe(true);
  });

  // REQ-BLK-003: null address → BLOCKED_BY_CUSTOMER_DATA (endereço incompleto)
  it("REQ-BLK-003: null address emits BLOCKED_BY_CUSTOMER_DATA (endereço incompleto)", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer({ address: null }),
      certificateJobStatuses: ["APPROVED"],
      amountCents: 5000,
    });
    const addrBlocker = blockers.find(
      (b) =>
        b.code === "BLOCKED_BY_CUSTOMER_DATA" &&
        b.label === "Endereço do cliente incompleto",
    );
    expect(addrBlocker).toBeDefined();
    expect(addrBlocker?.owner).toBe("finance");
    expect(addrBlocker?.scope).toBe("customer");
  });

  // REQ-BLK-003: address with empty city → blocked
  it("REQ-BLK-003: address with empty city emits BLOCKED_BY_CUSTOMER_DATA", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer({ address: { city: "", state: "SP" } }),
      certificateJobStatuses: ["APPROVED"],
      amountCents: 5000,
    });
    expect(blockers.some(
      (b) =>
        b.code === "BLOCKED_BY_CUSTOMER_DATA" &&
        b.label === "Endereço do cliente incompleto",
    )).toBe(true);
  });

  // REQ-BLK-003: address with whitespace state → blocked
  it("REQ-BLK-003: address with whitespace state emits BLOCKED_BY_CUSTOMER_DATA", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer({ address: { city: "São Paulo", state: "  " } }),
      certificateJobStatuses: ["APPROVED"],
      amountCents: 5000,
    });
    expect(blockers.some(
      (b) =>
        b.code === "BLOCKED_BY_CUSTOMER_DATA" &&
        b.label === "Endereço do cliente incompleto",
    )).toBe(true);
  });

  // REQ-BLK-004 HIGH RISK: non-empty list with no APPROVED/SUPERSEDED → blocked
  it("REQ-BLK-004: non-empty cert list with no APPROVED/SUPERSEDED emits BLOCKED_BY_CERTIFICATE_STATUS", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer(),
      certificateJobStatuses: ["REVIEW", "DRAFT", "IN_PROGRESS"],
      amountCents: 5000,
    });
    const certBlocker = blockers.find(
      (b) => b.code === "BLOCKED_BY_CERTIFICATE_STATUS",
    );
    expect(certBlocker).toBeDefined();
    expect(certBlocker?.owner).toBe("lab_ops");
    expect(certBlocker?.scope).toBe("order");
  });

  // REQ-BLK-004 HIGH RISK: at least one APPROVED → NOT blocked
  it("REQ-BLK-004: at least one APPROVED certificate clears the cert gate", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer(),
      certificateJobStatuses: ["REVIEW", "APPROVED"],
      amountCents: 5000,
    });
    expect(blockers.some((b) => b.code === "BLOCKED_BY_CERTIFICATE_STATUS")).toBe(false);
  });

  // REQ-BLK-004 HIGH RISK: at least one SUPERSEDED → NOT blocked
  it("REQ-BLK-004: at least one SUPERSEDED certificate clears the cert gate", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer(),
      certificateJobStatuses: ["DRAFT", "SUPERSEDED"],
      amountCents: 5000,
    });
    expect(blockers.some((b) => b.code === "BLOCKED_BY_CERTIFICATE_STATUS")).toBe(false);
  });

  // REQ-BLK-004 HIGH RISK: empty list → NOT blocked (no cert gate when no certs linked)
  it("REQ-BLK-004: empty certificateJobStatuses does NOT emit BLOCKED_BY_CERTIFICATE_STATUS", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer(),
      certificateJobStatuses: [],
      amountCents: 5000,
    });
    expect(blockers.some((b) => b.code === "BLOCKED_BY_CERTIFICATE_STATUS")).toBe(false);
  });

  // REQ-BLK-005 HIGH RISK: amountCents === 0 → BLOCKED_BY_UNMAPPED_SERVICE
  it("REQ-BLK-005: amountCents === 0 emits BLOCKED_BY_UNMAPPED_SERVICE (owner=admin, scope=all_future)", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer(),
      certificateJobStatuses: ["APPROVED"],
      amountCents: 0,
    });
    const svcBlocker = blockers.find(
      (b) => b.code === "BLOCKED_BY_UNMAPPED_SERVICE",
    );
    expect(svcBlocker).toBeDefined();
    expect(svcBlocker?.owner).toBe("admin");
    expect(svcBlocker?.scope).toBe("all_future");
  });

  // REQ-BLK-005 HIGH RISK: negative amount → BLOCKED_BY_UNMAPPED_SERVICE
  it("REQ-BLK-005: negative amountCents emits BLOCKED_BY_UNMAPPED_SERVICE", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer(),
      certificateJobStatuses: ["APPROVED"],
      amountCents: -1,
    });
    expect(blockers.some((b) => b.code === "BLOCKED_BY_UNMAPPED_SERVICE")).toBe(true);
  });

  // REQ-BLK-005 HIGH RISK: positive amount → NOT blocked by service
  it("REQ-BLK-005: positive amountCents does NOT emit BLOCKED_BY_UNMAPPED_SERVICE", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer(),
      certificateJobStatuses: ["APPROVED"],
      amountCents: 1,
    });
    expect(blockers.some((b) => b.code === "BLOCKED_BY_UNMAPPED_SERVICE")).toBe(false);
  });

  // REQ-BLK-006 HIGH RISK: fully billable → empty array
  it("REQ-BLK-006: fully billable order (complete customer, approved cert, positive amount) returns empty array", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer(),
      certificateJobStatuses: ["APPROVED"],
      amountCents: 10000,
    });
    expect(blockers).toHaveLength(0);
  });

  // REQ-BLK-006 HIGH RISK: no certs + complete data + positive amount → still empty (no cert gate)
  it("REQ-BLK-006: fully billable repair-only order (no certs) returns empty array", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer(),
      certificateJobStatuses: [],
      amountCents: 5000,
    });
    expect(blockers).toHaveLength(0);
  });

  // REQ-BLK-007: multiple failures → ALL blockers accumulated, exact count
  it("REQ-BLK-007: all three conditions failing yields exactly 5 blockers (taxId + email + address + cert + service)", () => {
    // taxId=null → +1, email=null → +1, address=null → +1, no approved cert → +1, amount=0 → +1
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer({ taxId: null, email: null, address: null }),
      certificateJobStatuses: ["REVIEW"],
      amountCents: 0,
    });

    expect(blockers).toHaveLength(5);

    const codes = blockers.map((b) => b.code);
    const customerDataCount = codes.filter((c) => c === "BLOCKED_BY_CUSTOMER_DATA").length;
    expect(customerDataCount).toBe(3); // taxId + email + address each emit one
    expect(codes.filter((c) => c === "BLOCKED_BY_CERTIFICATE_STATUS")).toHaveLength(1);
    expect(codes.filter((c) => c === "BLOCKED_BY_UNMAPPED_SERVICE")).toHaveLength(1);
  });

  // REQ-BLK-007: two customer-data failures + one other
  it("REQ-BLK-007: two customer-data failures (taxId + email) accumulate independently", () => {
    const blockers = evaluateOrderBlockers({
      customer: makeCustomer({ taxId: null, email: null }),
      certificateJobStatuses: ["APPROVED"],
      amountCents: 5000,
    });

    expect(blockers).toHaveLength(2);
    const labels = blockers.map((b) => b.label);
    expect(labels).toContain("CPF/CNPJ do cliente ausente");
    expect(labels).toContain("E-mail do cliente ausente");
  });
});

// ---------------------------------------------------------------------------
// REQ-CMP-*: syncComplianceWithActiveAgreement characterisation tests
// ---------------------------------------------------------------------------

describe("syncComplianceWithActiveAgreement — REQ-CMP-*", () => {
  // REQ-CMP-001 HIGH RISK: null activeAgreement clears ALL contract fields + resets ack
  it("REQ-CMP-001: null activeAgreement clears all contract fields and sets qualityRequirementsAcknowledged=false", () => {
    const result = syncComplianceWithActiveAgreement(
      makeCompliance({
        qualificationStatus: "qualified",
        contractAgreementId: 7,
        contractNumber: "CTR-7",
        contractSignedAt: "2026-03-01T00:00:00.000Z",
        contractExpiresAt: "2026-12-31T00:00:00.000Z",
        qualityRequirementsAcknowledged: true,
        qualityRequirementsAcknowledgedAt: "2026-03-02T00:00:00.000Z",
        notes: "nota de teste",
      }),
      null,
    );

    // All four contract fields must be undefined (not just falsy)
    expect(result.contractAgreementId).toBeUndefined();
    expect(result.contractNumber).toBeUndefined();
    expect(result.contractSignedAt).toBeUndefined();
    expect(result.contractExpiresAt).toBeUndefined();
    // Acknowledgement must be reset
    expect(result.qualityRequirementsAcknowledged).toBe(false);
    expect(result.qualityRequirementsAcknowledgedAt).toBeUndefined();
    // Base fields must be preserved
    expect(result.qualificationStatus).toBe("qualified");
    expect(result.notes).toBe("nota de teste");
  });

  // REQ-CMP-002 HIGH RISK: agreement id changed → reset contractSignedAt + ack
  it("REQ-CMP-002: changed agreement id resets contractSignedAt and acknowledgement fields", () => {
    const result = syncComplianceWithActiveAgreement(
      makeCompliance({
        qualificationStatus: "qualified",
        contractAgreementId: 5,           // OLD agreement id
        contractSignedAt: "2025-12-01T00:00:00.000Z",
        qualityRequirementsAcknowledged: true,
        qualityRequirementsAcknowledgedAt: "2025-12-02T00:00:00.000Z",
      }),
      makeAgreement({ id: 99 }),            // NEW agreement id differs
    );

    // contractSignedAt must be cleared to force re-signature
    expect(result.contractSignedAt).toBeUndefined();
    // Acknowledgement must be reset for the new contract
    expect(result.qualityRequirementsAcknowledged).toBe(false);
    expect(result.qualityRequirementsAcknowledgedAt).toBeUndefined();
    // New agreement id is applied
    expect(result.contractAgreementId).toBe(99);
  });

  // REQ-CMP-003: same agreement id → keep contractSignedAt + ack as-is
  it("REQ-CMP-003: unchanged agreement id preserves contractSignedAt and qualityRequirementsAcknowledged", () => {
    const agreement = makeAgreement({
      id: 42,
      agreementCode: "CTR-42",
      effectiveTo: "2027-06-30T00:00:00.000Z",
    });
    const result = syncComplianceWithActiveAgreement(
      makeCompliance({
        qualificationStatus: "qualified",
        contractAgreementId: 42,
        contractSignedAt: "2026-01-15T00:00:00.000Z",
        qualityRequirementsAcknowledged: true,
        qualityRequirementsAcknowledgedAt: "2026-01-16T00:00:00.000Z",
      }),
      agreement,
    );

    // Signature state must be preserved
    expect(result.contractSignedAt).toBe("2026-01-15T00:00:00.000Z");
    expect(result.qualityRequirementsAcknowledged).toBe(true);
    expect(result.qualityRequirementsAcknowledgedAt).toBe("2026-01-16T00:00:00.000Z");
    // Agreement fields updated from agreement
    expect(result.contractAgreementId).toBe(42);
    expect(result.contractNumber).toBe("CTR-42");
    expect(result.contractExpiresAt).toBe("2027-06-30T00:00:00.000Z");
  });

  // REQ-CMP-003: null effectiveTo → contractExpiresAt becomes undefined
  it("REQ-CMP-003: null effectiveTo on unchanged agreement sets contractExpiresAt=undefined", () => {
    const result = syncComplianceWithActiveAgreement(
      makeCompliance({ contractAgreementId: 1 }),
      makeAgreement({ id: 1, effectiveTo: null }),
    );
    expect(result.contractExpiresAt).toBeUndefined();
  });

  // REQ-CMP-003: null agreementCode → falls back to "Contrato #<id>"
  it("REQ-CMP-003: null agreementCode formats contractNumber as Contrato #<id>", () => {
    const result = syncComplianceWithActiveAgreement(
      makeCompliance({ contractAgreementId: 55 }),
      makeAgreement({ id: 55, agreementCode: null }),
    );
    expect(result.contractNumber).toBe("Contrato #55");
  });

  // REQ-CMP-004: null currentCompliance → valid defaults
  it("REQ-CMP-004: null currentCompliance with null activeAgreement returns valid defaults", () => {
    const result = syncComplianceWithActiveAgreement(null, null);

    expect(result.qualificationStatus).toBe("pending");
    expect(result.qualityRequirementsAcknowledged).toBe(false);
    expect(result.contractAgreementId).toBeUndefined();
    expect(result.contractNumber).toBeUndefined();
    expect(result.contractSignedAt).toBeUndefined();
    expect(result.contractExpiresAt).toBeUndefined();
  });

  // REQ-CMP-004: undefined currentCompliance + active agreement → valid object
  it("REQ-CMP-004: undefined currentCompliance with active agreement returns valid compliance object", () => {
    const result = syncComplianceWithActiveAgreement(
      undefined,
      makeAgreement({ id: 3 }),
    );

    expect(result.qualificationStatus).toBe("pending");
    expect(result.qualityRequirementsAcknowledged).toBe(false);
    expect(result.contractAgreementId).toBe(3);
    expect(result.contractNumber).toBe("CTR-10"); // agreementCode from makeAgreement default
  });
});
