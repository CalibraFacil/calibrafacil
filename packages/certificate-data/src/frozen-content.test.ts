import { describe, expect, it } from "vitest";
import {
  buildCertificateInput,
  calibratingBodyAddressText,
  certificateContentRulesFor,
  evaluateTraceability,
  freezeSignatory,
  isCertificateInput,
  pickSignatoryRecord,
  resolveCalibratingBody,
  type CertificateJobData,
  type TraceabilityStandard,
} from "./index";

const EVALUATED_AT = new Date("2026-03-10T12:00:00.000Z");
const PERFORMED_AT = new Date("2026-03-09T12:00:00.000Z");

function standard(
  overrides: Partial<TraceabilityStandard> = {},
): TraceabilityStandard {
  return {
    id: 1,
    name: "Massa padrão 1 kg",
    certificateNumber: "CAL-0123-2026",
    calibratedBy: "Laboratório RBC",
    calibrationDate: "2025-12-01",
    nextCalibrationDate: "2027-12-01",
    calibrationProvider: {
      accreditationNumber: "CAL 0123",
      mraRecognized: true,
    },
    ...overrides,
  };
}

describe("REQ-C2-2: traceability is verified, never presumed", () => {
  it("verified when every standard has a valid certificate from an accredited MRA provider", () => {
    const result = evaluateTraceability({
      standards: [
        standard(),
        standard({
          id: 2,
          calibratedBy: "Outro Laboratório",
          calibrationProvider: {
            accreditationNumber: "CAL 0456",
            mraRecognized: true,
          },
        }),
      ],
      performedAt: PERFORMED_AT,
      evaluatedAt: EVALUATED_AT,
    });
    expect(result.verified).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.providers).toEqual([
      { name: "Laboratório RBC", accreditationNumber: "CAL 0123" },
      { name: "Outro Laboratório", accreditationNumber: "CAL 0456" },
    ]);
    expect(result.evaluatedAt).toBe("2026-03-10T12:00:00.000Z");
  });

  it("a provider that is only named (free text, no accreditation recorded) is not verified", () => {
    const result = evaluateTraceability({
      standards: [standard({ calibrationProvider: null })],
      performedAt: PERFORMED_AT,
      evaluatedAt: EVALUATED_AT,
    });
    expect(result.verified).toBe(false);
    expect(result.failures).toEqual([
      { standardId: 1, reason: "provider_not_accredited" },
    ]);
    expect(result.providers).toEqual([]);
  });

  it("an accreditation number without the MRA recognition flag is not verified", () => {
    const result = evaluateTraceability({
      standards: [
        standard({
          calibrationProvider: {
            accreditationNumber: "CAL 0123",
            mraRecognized: false,
          },
        }),
      ],
      performedAt: PERFORMED_AT,
      evaluatedAt: EVALUATED_AT,
    });
    expect(result.verified).toBe(false);
  });

  it("the recognition flag without an accreditation number is not verified", () => {
    const result = evaluateTraceability({
      standards: [
        standard({
          calibrationProvider: {
            accreditationNumber: "  ",
            mraRecognized: true,
          },
        }),
      ],
      performedAt: PERFORMED_AT,
      evaluatedAt: EVALUATED_AT,
    });
    expect(result.verified).toBe(false);
  });

  it("one unverified standard among verified ones makes the whole job unverified", () => {
    const result = evaluateTraceability({
      standards: [standard(), standard({ id: 2, calibratedBy: null })],
      performedAt: PERFORMED_AT,
      evaluatedAt: EVALUATED_AT,
    });
    expect(result.verified).toBe(false);
    expect(result.failures).toEqual([
      { standardId: 2, reason: "no_calibration_provider" },
    ]);
  });

  it("no standards at all is not verified", () => {
    for (const standards of [[], null, undefined]) {
      const result = evaluateTraceability({
        standards,
        performedAt: PERFORMED_AT,
        evaluatedAt: EVALUATED_AT,
      });
      expect(result.verified).toBe(false);
      expect(result.failures).toEqual([
        { standardId: null, reason: "no_standards" },
      ]);
    }
  });

  it("the certificate must cover the calibration day, both ends inclusive", () => {
    const at = (day: string) =>
      evaluateTraceability({
        standards: [standard()],
        performedAt: new Date(`${day}T15:00:00.000Z`),
        evaluatedAt: EVALUATED_AT,
      }).verified;
    expect(at("2025-12-01")).toBe(true);
    expect(at("2027-12-01")).toBe(true);
    expect(at("2025-11-30")).toBe(false);
    expect(at("2027-12-02")).toBe(false);
  });

  it("a missing certificate number or an unknown calibration day is not verified", () => {
    expect(
      evaluateTraceability({
        standards: [standard({ certificateNumber: " " })],
        performedAt: PERFORMED_AT,
        evaluatedAt: EVALUATED_AT,
      }).failures,
    ).toEqual([{ standardId: 1, reason: "no_certificate_number" }]);
    expect(
      evaluateTraceability({
        standards: [standard()],
        performedAt: null,
        evaluatedAt: EVALUATED_AT,
      }).verified,
    ).toBe(false);
  });

  it("reads the dates a JSON round trip makes of a stored calendar date", () => {
    const result = evaluateTraceability({
      standards: [
        standard({
          calibrationDate: "2025-12-01T00:00:00.000Z",
          nextCalibrationDate: "2027-12-01T00:00:00.000Z",
        }),
      ],
      performedAt: PERFORMED_AT,
      evaluatedAt: EVALUATED_AT,
    });
    expect(result.verified).toBe(true);
  });
});

describe("REQ-C2-1: the calibrating body", () => {
  const organization = {
    name: "Lab Matriz",
    legalName: null,
    cnpj: "11.111.111/0001-11",
    street: "Rua da Matriz",
    number: "1",
    complement: null,
    neighbourhood: "Centro",
    city: "Canoas",
    state: "RS",
    cep: "92000-000",
  };

  it("is the organization when the unit declares no establishment of its own", () => {
    const body = resolveCalibratingBody({
      organization,
      unit: {
        id: 5,
        name: "Matriz",
        legalName: null,
        cnpj: null,
        street: null,
        number: null,
        complement: null,
        neighbourhood: null,
        city: null,
        state: null,
        cep: null,
      },
    });
    expect(body).toMatchObject({
      source: "organization",
      unitId: 5,
      legalName: "Lab Matriz",
      cnpj: "11.111.111/0001-11",
      street: "Rua da Matriz",
      city: "Canoas",
    });
    expect(calibratingBodyAddressText(body)).toBe(
      "Rua da Matriz, 1 — Centro — Canoas/RS — 92000-000",
    );
  });

  it("is the unit, as a block, when the unit has its own CNPJ", () => {
    const body = resolveCalibratingBody({
      organization,
      unit: {
        id: 6,
        name: "Filial Sul",
        legalName: "Lab Filial Ltda",
        cnpj: "22.222.222/0001-22",
        street: "Av. da Filial",
        number: "200",
        complement: "Sala 3",
        neighbourhood: null,
        city: "Pelotas",
        state: "RS",
        cep: null,
      },
    });
    expect(body).toMatchObject({
      source: "unit",
      unitId: 6,
      unitName: "Filial Sul",
      legalName: "Lab Filial Ltda",
      cnpj: "22.222.222/0001-22",
      city: "Pelotas",
    });
    expect(calibratingBodyAddressText(body)).toBe(
      "Av. da Filial, 200 — Sala 3 — Pelotas/RS",
    );
  });

  it("never borrows the head office's address for a branch that lacks one", () => {
    const body = resolveCalibratingBody({
      organization,
      unit: {
        id: 6,
        name: "Filial Sul",
        legalName: null,
        cnpj: "22.222.222/0001-22",
        street: null,
        number: null,
        complement: null,
        neighbourhood: null,
        city: null,
        state: null,
        cep: null,
      },
    });
    expect(body.source).toBe("unit");
    expect(body.legalName).toBe("Lab Matriz");
    expect(body.street).toBeNull();
    expect(body.city).toBeNull();
    expect(calibratingBodyAddressText(body)).toBeNull();
  });

  it("prefers the organization's legal name over its trade name", () => {
    const body = resolveCalibratingBody({
      organization: { ...organization, legalName: "Lab Matriz Serviços Ltda" },
      unit: null,
    });
    expect(body.legalName).toBe("Lab Matriz Serviços Ltda");
    expect(body.unitId).toBeNull();
  });
});

describe("REQ-C1-2: the signatory comes from the authorized-signatory record", () => {
  const AT = new Date("2026-03-10T12:00:00.000Z");
  const record = (
    id: number,
    assetTypeId: number | null,
    overrides: Partial<Parameters<typeof pickSignatoryRecord>[0][number]> = {},
  ) => ({
    id,
    assetTypeId,
    title: `Título ${id}`,
    scopeDescription: null,
    authorizedAt: new Date("2025-01-01T00:00:00.000Z"),
    expiresAt: null,
    ...overrides,
  });

  it("prefers the record for the asset type over the org-wide one", () => {
    expect(
      pickSignatoryRecord([record(1, null), record(2, 9)], 9, AT)?.id,
    ).toBe(2);
  });

  it("falls back to the org-wide record, and to none when nothing covers the scope", () => {
    expect(pickSignatoryRecord([record(1, null)], 9, AT)?.id).toBe(1);
    expect(pickSignatoryRecord([record(2, 8)], 9, AT)).toBeNull();
    expect(pickSignatoryRecord([], 9, AT)).toBeNull();
  });

  it("skips an expired record", () => {
    expect(
      pickSignatoryRecord(
        [record(1, 9, { expiresAt: new Date("2026-03-01T00:00:00.000Z") })],
        9,
        AT,
      ),
    ).toBeNull();
  });

  it("freezes the record's own title, trimmed, and never invents one", () => {
    expect(
      freezeSignatory(
        record(1, 9, { title: "  Gerente da Qualidade " }),
        "Ana",
      ),
    ).toMatchObject({
      recordId: 1,
      name: "Ana",
      title: "Gerente da Qualidade",
    });
    expect(
      freezeSignatory(record(1, 9, { title: "  " }), "Ana").title,
    ).toBeNull();
    expect(
      freezeSignatory(record(1, 9, { title: null }), "Ana").title,
    ).toBeNull();
  });
});

describe("the frozen input carries the C1/C2 decisions", () => {
  function job(
    overrides: Partial<CertificateJobData> = {},
  ): CertificateJobData {
    return {
      jobId: "CAL-1",
      verificationToken: "tok",
      performedAt: PERFORMED_AT,
      approvedAt: EVALUATED_AT,
      lab: { name: "Lab" },
      customer: { name: "Cliente", address: null },
      asset: {
        name: "Balança",
        serialNumber: "1",
        tag: "T",
        model: null,
        manufacturer: null,
      },
      methodSnapshot: {
        methodId: 1,
        methodName: "M",
        methodVersion: 1,
        accreditedScope: false,
      },
      standardsSnapshot: [
        {
          id: 1,
          name: "Padrão",
          certificateNumber: "N-1",
          calibratedBy: "RBC",
          calibrationProvider: {
            accreditationNumber: "CAL 0123",
            mraRecognized: true,
          },
          calibrationDate: "2025-12-01",
          nextCalibrationDate: "2027-12-01",
          uncertainty: 0.1,
          uncertaintyUnit: "g",
          coverageFactor: 2,
        },
      ],
      data: null,
      results: null,
      approverName: "Ana",
      ...overrides,
    };
  }

  it("freezes the traceability decision as of the approval instant", () => {
    const input = buildCertificateInput(job(), null);
    expect(input.layout.version).toBe("1.1.0");
    expect(input.job.traceability).toMatchObject({
      verified: true,
      evaluatedAt: "2026-03-10T12:00:00.000Z",
    });
    expect(isCertificateInput(input)).toBe(true);
  });

  it("freezes 'not verified' for standards with free-text providers only", () => {
    const input = buildCertificateInput(
      job({
        standardsSnapshot: [
          {
            id: 1,
            name: "Padrão",
            certificateNumber: "N-1",
            calibratedBy: "RBC",
            calibrationDate: "2025-12-01",
            nextCalibrationDate: "2027-12-01",
            uncertainty: 0.1,
            uncertaintyUnit: "g",
            coverageFactor: 2,
          },
        ],
      }),
      null,
    );
    expect(input.job.traceability?.verified).toBe(false);
  });
});

describe("the statement rules a frozen input is rendered under", () => {
  it("1.0.x inputs keep the rules they were issued under; 1.1 and later use the frozen decisions", () => {
    expect(certificateContentRulesFor("1.0.0")).toBe("legacy");
    expect(certificateContentRulesFor("1.0.9")).toBe("legacy");
    expect(certificateContentRulesFor("1.1.0")).toBe("current");
    expect(certificateContentRulesFor("1.2.3")).toBe("current");
    expect(certificateContentRulesFor("2.0.0")).toBe("current");
  });

  it("an unreadable or absent version is rendered as it always was", () => {
    expect(certificateContentRulesFor(undefined)).toBe("legacy");
    expect(certificateContentRulesFor("")).toBe("legacy");
    expect(certificateContentRulesFor("v2")).toBe("legacy");
  });
});
