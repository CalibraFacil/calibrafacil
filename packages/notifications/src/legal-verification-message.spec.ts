import { describe, it, expect } from "vitest";

import { buildLegalVerificationMessage } from "./legal-verification-message";

// REQ-LVRECALL-006: the legal-metrology VERIFICATION reminder copy is pt-BR and,
// WHERE the regulated interval is `operationalizedByDelegate`, presents the date
// as INDICATIVE (cadência operacionalizada pelo Ipem — não é prazo nacional
// fixo), NOT a hard deadline. The fixed-by-regulation case must NOT use the
// indicative wording. Pure builder — directly exercised (no DB / mock).
describe("buildLegalVerificationMessage (REQ-LVRECALL-006)", () => {
  it("REQ-LVRECALL-006 operationalizedByDelegate=true → indicative copy, not a hard deadline", () => {
    const message = buildLegalVerificationMessage({
      assetIdentifier: "BAL-001",
      dueDate: "31/12/2026",
      daysRemaining: 20,
      operationalizedByDelegate: true,
      regulationReference: "Portaria Inmetro nº 157/2022",
    });

    // Indicative cadence — the Ipem runs the cronograma; the date is NOT a fixed
    // national deadline.
    expect(message).toContain("operacionalizada pelo Ipem");
    expect(message).toContain("indicativa");
    expect(message).toContain("não é um prazo nacional fixo");
    // The verbatim regulation reference is preserved.
    expect(message).toContain("Portaria Inmetro nº 157/2022");
    // It must NOT claim a hard "vencendo em N dias" deadline for the indicative case.
    expect(message).not.toContain("vencendo em 20 dias");
  });

  it("REQ-LVRECALL-006 operationalizedByDelegate=false → regulation-fixed deadline copy (no Ipem indicative wording)", () => {
    const message = buildLegalVerificationMessage({
      assetIdentifier: "BAL-002",
      dueDate: "10/07/2026",
      daysRemaining: 12,
      operationalizedByDelegate: false,
      regulationReference: "Portaria Inmetro nº 157/2022",
    });

    expect(message).toContain("fixada por regulamento");
    expect(message).toContain("Inmetro/RBMLQ-I");
    expect(message).toContain("vencendo em 12 dias");
    // The indicative wording must NOT appear when the period is a hard deadline.
    expect(message).not.toContain("operacionalizada pelo Ipem");
    expect(message).not.toContain("indicativa");
  });

  it("omits the regulation reference clause when none is provided", () => {
    const message = buildLegalVerificationMessage({
      assetIdentifier: "BAL-003",
      dueDate: "01/08/2026",
      daysRemaining: 5,
      operationalizedByDelegate: false,
      regulationReference: null,
    });

    expect(message).not.toContain("Regulamento:");
    expect(message).toContain("BAL-003");
  });
});
