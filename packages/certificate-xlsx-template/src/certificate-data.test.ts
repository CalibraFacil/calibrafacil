import { describe, expect, it } from "vitest";

import {
  buildCertificateData,
  type CertificateJobData,
} from "./certificate-data.js";

/**
 * The first direct coverage of the job → certificate-cell mapping. Every
 * assertion here answers "why did this certificate cell get this value"
 * without a database, R2 or LibreOffice.
 */

function goldenJob(): CertificateJobData {
  return {
    jobId: "CAL-2026-0042",
    verificationToken: "tok-abc123",
    certificateName: "Certificado CAL-2026-0042",
    organizationId: "org-1",
    unitId: 7,
    performedAt: new Date("2026-06-10T12:00:00Z"),
    approvedAt: new Date("2026-06-12T15:30:00Z"),
    environmentalSnapshot: {
      temperature: 20.4,
      humidity: 55.2,
      pressure: 1013.6,
      recordedAt: "2026-06-10T12:05:00Z",
      recordedBy: "tech-1",
      limits: null,
      withinLimits: true,
      outOfLimitsJustification: null,
    },
    calibrationLocationSnapshot: {
      type: "lab",
      addressText: "Laboratório central",
    },
    lab: {
      name: "Calibra Fácil Lab",
      cnpj: "00.000.000/0001-00",
      accreditationNumber: "CAL 1234",
      accreditationActive: false,
      street: "Rua A",
      number: "10",
      city: "Porto Alegre",
      state: "RS",
      cep: "90000-000",
    },
    customer: {
      name: "Cliente XYZ",
      taxId: "11.111.111/0001-11",
      address: {
        street: "Av. B",
        number: "200",
        city: "Canoas",
        state: "RS",
        cep: "92000-000",
      },
    },
    asset: {
      name: "Balança analítica",
      serialNumber: "SN-9",
      tag: "TAG-9",
      model: "XP-205",
      manufacturer: "Mettler",
    },
    methodSnapshot: {
      methodId: 3,
      methodName: "Calibração de balança",
      methodVersion: 2,
      dataFields: [
        {
          key: "indicacao",
          label: "Indicação",
          type: "number",
          unit: "g",
        },
      ],
      formulas: [
        {
          outputKey: "erro",
          expression: "indicacao - referencia",
          label: "Erro de indicação",
          unit: "mg",
          reporting: { role: "primary_result", group: "calibration_result" },
        },
        {
          outputKey: "U",
          expression: "2 * uc",
          label: "Incerteza expandida",
          unit: "mg",
          reporting: {
            role: "expanded_uncertainty",
            group: "uncertainty_budget",
          },
        },
      ],
      certificateContent: {
        procedureCode: "PC-01",
        referenceStandards: ["OIML R76", " ", "Portaria 157"],
      },
    },
    assetSnapshot: {
      assetId: 9,
      assetTypeId: 1,
      assetTypeName: "Balança",
      assetTypeSlug: "balanca",
      baseMeasurementUnit: "g",
      name: "Balança analítica",
      tag: "TAG-9",
      serialNumber: "SN-9",
      manufacturer: "Mettler",
      model: "XP-205",
      specifications: {
        capacity: 220,
        capacityUnit: "g",
        resolution: 0.1,
        resolutionUnit: "mg",
      },
      capturedAt: "2026-06-10T00:00:00Z",
    },
    standardsSnapshot: [
      {
        id: 5,
        name: "Massa padrão E2",
        certificateNumber: "RBC-777",
        calibratedBy: "Inmetro",
        calibrationDate: "2026-01-15T00:00:00Z",
        nextCalibrationDate: "2027-01-15T00:00:00Z",
        uncertainty: 0.05,
        uncertaintyUnit: "mg",
        coverageFactor: 2,
        certifiedValues: [
          {
            nominal: "200 g",
            value: 200.0000015,
            uncertainty: 5e-7,
            unit: "g",
          },
        ],
      },
    ],
    data: { indicacao: "200.0001" },
    results: { erro: 0.0001, U: 0.00021, veff: 2_000_000_000 },
    approverName: "Maria Souza",
    approverSignatureUrl: "data:image/png;base64,AAAA",
  };
}

describe("buildCertificateData", () => {
  const data = buildCertificateData(goldenJob());

  function section(key: string): Record<string, unknown> {
    const value = Reflect.get(data, key);
    if (value === null || typeof value !== "object") {
      throw new Error(`Expected object section: ${key}`);
    }
    return Object.fromEntries(Object.entries(value));
  }

  it("maps certificate identity, verification URL and pt-BR dates", () => {
    const certificate = section("certificate");
    expect(certificate.number).toBe("CAL-2026-0042");
    expect(certificate.verificationUrl).toBe(
      "https://verify.calibrafacil.com/v/tok-abc123",
    );
    expect(certificate.issuedAtText).toBe("12/06/2026");
    expect(section("job").performedAtText).toBe("10/06/2026");
  });

  it("formats environment readings with fixed decimals and units", () => {
    const environment = section("environment");
    expect(environment.temperatureText).toBe("20,4 ºC");
    expect(environment.relativeHumidityText).toBe("55,2 %");
    expect(environment.pressureText).toBe("1013,6 hPa");
  });

  it("converts asset capacity and division to the base measurement unit", () => {
    const asset = section("asset");
    expect(asset.capacityText).toBe("220 g");
    // 0.1 mg → 0.0001 g in the asset's base unit.
    expect(asset.divisionText).toBe("0,0001 g");
  });

  it("normalizes standards with derived issuer and flattened certified values", () => {
    const standards = data.standards;
    if (!Array.isArray(standards)) throw new Error("standards missing");
    const standard = Object.fromEntries(Object.entries(standards[0] ?? {}));
    expect(standard.issuer).toBe("Inmetro");
    expect(standard.calibrationDateText).toBe("15/01/2026");
    expect(standard.validUntilText).toBe("15/01/2027");

    const certifiedValues = data.certifiedValues;
    if (!Array.isArray(certifiedValues)) throw new Error("missing");
    expect(certifiedValues).toHaveLength(1);
    expect(
      Object.fromEntries(Object.entries(certifiedValues[0] ?? {}))
        .certificateNumber,
    ).toBe("RBC-777");
  });

  it("routes results into calibration vs uncertainty-budget groups and formats veff", () => {
    const uncertainty = section("uncertainty");
    const expanded = Object.fromEntries(
      Object.entries(
        uncertainty.expanded && typeof uncertainty.expanded === "object"
          ? uncertainty.expanded
          : {},
      ),
    );
    expect(expanded.key).toBe("U");

    const resultsDisplay = section("resultsDisplay");
    // ≥1e9 effective degrees of freedom render as "infinito".
    expect(resultsDisplay.veff).toBe("infinito");
    // Characterizes current behavior: derived decimals clamp at 6, so an
    // 0.0001 mg error converted to the g base unit (1e-7) displays as zero.
    expect(resultsDisplay.erro).toBe("0,000000");
  });

  it("joins reference standards with 'e' skipping blank entries", () => {
    const method = section("method");
    expect(method.referenceStandardsText).toBe("OIML R76 e Portaria 157");
  });

  it("omits the accreditation seal outside the accreditation window and without a renderer", () => {
    const lab = section("lab");
    expect(lab.accreditationSealPng).toBeNull();
    expect(section("accreditation").accredited).toBe(false);
  });

  it("injects the accreditation seal when accredited and a renderer is provided", () => {
    const job = goldenJob();
    job.lab.accreditationActive = true;
    job.methodSnapshot.accreditedScope = true;
    const withSeal = buildCertificateData(job, {
      renderAccreditationSeal: (accreditationNumber) =>
        `data:image/svg+xml;base64,${accreditationNumber ?? ""}`,
    });
    const lab = Object.fromEntries(
      Object.entries(
        Reflect.get(withSeal, "lab") &&
          typeof Reflect.get(withSeal, "lab") === "object"
          ? Object(Reflect.get(withSeal, "lab"))
          : {},
      ),
    );
    expect(lab.accreditationSealPng).toBe("data:image/svg+xml;base64,CAL 1234");
  });
});
