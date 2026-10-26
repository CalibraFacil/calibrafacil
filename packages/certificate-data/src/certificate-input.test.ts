import { describe, expect, it } from "vitest";
import {
  assembleCertificateJobData,
  buildCertificateInput,
  canonicalJson,
  CERTIFICATE_INPUT_SCHEMA_VERSION,
  CERTIFICATE_LAYOUT_KEY,
  CERTIFICATE_LAYOUT_VERSION,
  certificateInputSha256,
  imageDataUrl,
  isCertificateInput,
  type CertificateJobSource,
} from "./index";

const APPROVED_AT = new Date("2026-03-10T12:00:00.000Z");

function source(
  overrides: Partial<CertificateJobSource> = {},
): CertificateJobSource {
  return {
    jobId: "CAL-2026-0001",
    verificationToken: "tok-abc",
    certificateName: "CAL-2026-0001",
    organizationId: "org-1",
    organizationSlug: "lab-um",
    unitId: 7,
    performedAt: new Date("2026-03-09T09:00:00.000Z"),
    approvedAt: APPROVED_AT,
    methodSnapshot: {
      methodId: 3,
      methodName: "Calibração de balança",
      methodVersion: 2,
      accreditedScope: true,
      engineVersion: "1.4.0",
      methodFingerprint: "fp-123",
      certificateContent: {
        procedureCode: "PO-CAL-001",
        referenceStandards: ["NIT-DICLA-021"],
      },
      formulas: [],
    },
    methodAccreditedScopeCurrent: null,
    assetSnapshot: null,
    standardsSnapshot: [
      {
        id: 11,
        name: "Massa padrão 1 kg",
        certificateNumber: "RBC-777",
        calibratedBy: "Laboratório RBC",
        calibrationDate: "2025-12-01",
        nextCalibrationDate: "2027-12-01",
        uncertainty: 0.001,
        uncertaintyUnit: "g",
        coverageFactor: 2,
      },
    ],
    environmentalSnapshot: null,
    calibrationLocationSnapshot: null,
    calibrationPhaseSnapshot: null,
    data: { pontos: [{ carga_nominal: "500" }] },
    results: { erro: ["-0.52"], u_expandida: ["0.12"], fator_k: ["2"] },
    scopeOverrideJustification: null,
    methodDeviations: null,
    supersedesId: null,
    supersededById: null,
    amendmentNumber: null,
    amendmentReason: null,
    lab: {
      name: "Laboratório Um",
      cnpj: "12345678000199",
      accreditationNumber: "0123",
      accreditationBody: "Cgcre",
      accreditationActive: true,
      accreditationValidFrom: new Date("2025-01-01T00:00:00.000Z"),
      accreditationValidUntil: new Date("2026-06-30T00:00:00.000Z"),
      street: "Rua A",
      number: "10",
      complement: null,
      neighbourhood: "Centro",
      city: "Curitiba",
      state: "PR",
      cep: "80000-000",
      phone: "4130000000",
      email: "lab@um.test",
      website: null,
      logo: "data:image/png;base64,AAAA",
      technicalManagerName: "Maria Responsável",
      technicalManagerTitle: "Gerente Técnica",
    },
    customer: {
      name: "Cliente SA",
      taxId: "98765432000100",
      phone: null,
      email: null,
      address: null,
    },
    asset: {
      name: "Balança Analítica",
      serialNumber: "SN-1",
      tag: "TAG-1",
      model: "MOD-100",
      manufacturer: "Fab",
    },
    approver: {
      name: "Ana Aprovadora",
      signatureDataUrl: "data:image/png;base64,BBBB",
    },
    original: null,
    serviceOrder: null,
    ...overrides,
  };
}

const PASS_EVALUATION = { status: "PASS", findings: [] };

function frozen(
  overrides: Partial<CertificateJobSource> = {},
  scopeEvaluation: Parameters<
    typeof buildCertificateInput
  >[1] = PASS_EVALUATION,
) {
  return buildCertificateInput(
    assembleCertificateJobData(source(overrides)),
    scopeEvaluation,
  );
}

describe("REQ-CIN-1: the frozen certificate input carries everything the renderer needs", () => {
  it("REQ-CIN-1: holds lab, signatory, customer, asset, results, standards, method, layout and engine identity", () => {
    const input = frozen();

    expect(input.schemaVersion).toBe(CERTIFICATE_INPUT_SCHEMA_VERSION);
    expect(input.layout).toEqual({
      key: CERTIFICATE_LAYOUT_KEY,
      version: CERTIFICATE_LAYOUT_VERSION,
    });
    expect(input.engineVersion).toBe("1.4.0");
    expect(input.verificationUrl).toMatch(/\/v\/tok-abc$/);

    // lab identity and accreditation
    expect(input.job.lab).toMatchObject({
      name: "Laboratório Um",
      cnpj: "12345678000199",
      accreditationNumber: "0123",
      accreditationBody: "Cgcre",
      accreditationActive: true,
      logo: "data:image/png;base64,AAAA",
      technicalManagerTitle: "Gerente Técnica",
    });
    // signatory identity, role and drawn signature
    expect(input.job.approverName).toBe("Ana Aprovadora");
    expect(input.job.approverSignatureUrl).toBe("data:image/png;base64,BBBB");
    // customer, asset
    expect(input.job.customer.name).toBe("Cliente SA");
    expect(input.job.asset).toMatchObject({
      serialNumber: "SN-1",
      tag: "TAG-1",
    });
    // execution results and the standards snapshot
    expect(input.job.results).toEqual({
      erro: ["-0.52"],
      u_expandida: ["0.12"],
      fator_k: ["2"],
    });
    expect(input.job.standardsSnapshot?.[0]?.certificateNumber).toBe("RBC-777");
    // method / procedure identification
    expect(input.job.methodSnapshot).toMatchObject({
      methodName: "Calibração de balança",
      methodVersion: 2,
      certificateContent: { procedureCode: "PO-CAL-001" },
    });
    // instants are JSON-safe (ISO strings), never Date objects
    expect(input.job.approvedAt).toBe("2026-03-10T12:00:00.000Z");
    expect(input.seal.evaluatedAt).toBe("2026-03-10T12:00:00.000Z");
  });

  it("REQ-CIN-1: the seal decision is taken as of approved_at, not as of today", () => {
    // Vigência ends 2026-06-30; approved 2026-03-10: sealed, however late it
    // is rendered.
    expect(frozen().seal.accredited).toBe(true);
    // Approved after the vigência ended: no seal.
    expect(
      frozen({ approvedAt: new Date("2026-07-15T12:00:00.000Z") }).seal
        .accredited,
    ).toBe(false);
  });

  it("REQ-CIN-1: a documented scope override or a non-accredited method suppresses the seal", () => {
    expect(
      frozen({ scopeOverrideJustification: "fora do escopo CMC" }).seal
        .accredited,
    ).toBe(false);
    const nonAccredited = source();
    expect(
      frozen({
        methodSnapshot: {
          ...nonAccredited.methodSnapshot,
          accreditedScope: false,
        },
      }).seal.accredited,
    ).toBe(false);
  });

  it.each([
    ["OUT_OF_SCOPE", "scope_out_of_scope"],
    ["U_BELOW_CMC", "scope_u_below_cmc"],
    ["PARTIALLY_EVALUATED", "scope_partially_evaluated"],
    ["NOT_EVALUATED", "scope_not_evaluated"],
    ["NO_SCOPE_LINES", "scope_no_scope_lines"],
  ])(
    "Q42: a %s scope evaluation freezes the certificate WITHOUT the seal and says why",
    (status, reason) => {
      const input = frozen({}, { status, findings: [] });
      expect(input.seal.accredited).toBe(false);
      expect(input.seal.withheldReason).toBe(reason);
      expect(input.seal.scopeEvaluation).toEqual({ status, findings: [] });
    },
  );

  it("Q42: a PASS freezes the seal together with the evaluation it rests on", () => {
    const input = frozen();
    expect(input.seal).toEqual({
      accredited: true,
      evaluatedAt: "2026-03-10T12:00:00.000Z",
      withheldReason: null,
      scopeEvaluation: PASS_EVALUATION,
    });
  });

  it("Q42: no scope evaluation at all (null) never seals", () => {
    const input = frozen({}, null);
    expect(input.seal.accredited).toBe(false);
    expect(input.seal.withheldReason).toBe("scope_not_assessed");
    expect(input.seal.scopeEvaluation).toBeNull();
  });

  it("Q42: the frozen evaluation is part of the hashed document", () => {
    expect(certificateInputSha256(frozen())).not.toBe(
      certificateInputSha256(
        frozen({}, { status: "NOT_EVALUATED", findings: [] }),
      ),
    );
  });

  it("REQ-CIN-1: an old snapshot without the accredited flag falls back to the method's current flag", () => {
    const { accreditedScope: _flag, ...legacySnapshot } =
      source().methodSnapshot;
    expect(
      frozen({
        methodSnapshot: legacySnapshot,
        methodAccreditedScopeCurrent: true,
      }).job.methodSnapshot.accreditedScope,
    ).toBe(true);
    expect(
      frozen({
        methodSnapshot: legacySnapshot,
        methodAccreditedScopeCurrent: null,
      }).job.methodSnapshot.accreditedScope,
    ).toBe(false);
  });

  it("REQ-CIN-1: a job without an approval instant cannot be frozen", () => {
    expect(() =>
      buildCertificateInput(
        assembleCertificateJobData(source({ approvedAt: null })),
        PASS_EVALUATION,
      ),
    ).toThrow(/approval/);
  });

  it("REQ-CIN-1: the amendment link and the service-order receipt data are frozen too", () => {
    const input = frozen({
      supersedesId: 5,
      amendmentNumber: 1,
      amendmentReason: "erro de digitação",
      original: {
        jobId: "CAL-2026-0000",
        approvedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      serviceOrder: {
        inmetroRepairMarkNumber: null,
        receivedAt: new Date("2026-03-08T10:00:00.000Z"),
        intakeCondition: "Sem avarias",
        accessories: "Cabo de força",
      },
    });
    expect(input.job.originalJobId).toBe("CAL-2026-0000");
    expect(input.job.originalApprovedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(input.job.amendmentReason).toBe("erro de digitação");
    expect(input.job.serviceOrder).toEqual({
      inmetroRepairMarkNumber: null,
      receivedAt: "2026-03-08T10:00:00.000Z",
      intakeCondition: "Sem avarias",
      accessories: "Cabo de força",
    });
  });
});

describe("REQ-CIN-4: the input hash is stable", () => {
  it("REQ-CIN-4: the same document hashes the same however the keys are ordered, and across a JSON round trip", () => {
    const input = frozen();
    const reordered = JSON.parse(
      JSON.stringify(input, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).reverse())
          : value,
      ),
    );
    expect(certificateInputSha256(reordered)).toBe(
      certificateInputSha256(input),
    );
    expect(certificateInputSha256(input)).toMatch(/^[0-9a-f]{64}$/);
    // building twice from the same rows is deterministic too
    expect(certificateInputSha256(frozen())).toBe(
      certificateInputSha256(input),
    );
  });

  it("REQ-CIN-4: any change to the content changes the hash", () => {
    const base = certificateInputSha256(frozen());
    expect(
      certificateInputSha256(
        frozen({ lab: { ...source().lab, name: "Outro" } }),
      ),
    ).not.toBe(base);
    expect(
      certificateInputSha256(frozen({ results: { erro: ["-0.53"] } })),
    ).not.toBe(base);
  });

  it("REQ-CIN-4: canonicalJson sorts keys, drops undefined members and nulls undefined array items", () => {
    expect(
      canonicalJson({ b: 1, a: [undefined, { d: 2, c: undefined }] }),
    ).toBe('{"a":[null,{"d":2}],"b":1}');
  });

  it("REQ-CIN-4: an instant hashes as the ISO string JSON makes of it", () => {
    const at = new Date("2026-03-10T12:00:00.000Z");
    expect(canonicalJson({ at })).toBe(
      canonicalJson(JSON.parse(JSON.stringify({ at }))),
    );
  });
});

describe("isCertificateInput", () => {
  it("accepts a built document and rejects other shapes", () => {
    expect(isCertificateInput(frozen())).toBe(true);
    expect(isCertificateInput(null)).toBe(false);
    expect(isCertificateInput({ ...frozen(), schemaVersion: 2 })).toBe(false);
    expect(isCertificateInput({ ...frozen(), job: null })).toBe(false);
  });
});

describe("imageDataUrl", () => {
  it("encodes the bytes and sniffs the type when none is stored", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(imageDataUrl(png, null)).toBe("data:image/png;base64,iVBORw==");
    expect(imageDataUrl(png, "image/x-custom")).toBe(
      "data:image/x-custom;base64,iVBORw==",
    );
  });
});
