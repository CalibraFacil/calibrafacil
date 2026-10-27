import {
  buildCertificateInput,
  certificateContentRulesFor,
  type CertificateJobData,
  type StandardSnapshot,
} from "@calibra-facil/certificate-data";
import { describe, expect, it } from "vitest";

import { buildCertificateLayoutData } from "./layout-data";

/**
 * Roadmap 2 C1/C2 at the layout: what a certificate frozen under the CURRENT
 * rules says (coverage sentence from the frozen result, the signatory's
 * authorized-signatory title, the calibrating body, SI traceability only when
 * verified), and that an input frozen under the earlier layout re-renders as it
 * always did.
 */

const VERIFIED_STANDARD: StandardSnapshot = {
  id: 1,
  name: "Massa padrão",
  certificateNumber: "CAL-0123-2026",
  calibratedBy: "Laboratório RBC",
  calibrationProvider: { accreditationNumber: "CAL 0123", mraRecognized: true },
  calibrationDate: "2026-01-01T00:00:00.000Z",
  nextCalibrationDate: "2027-01-01T00:00:00.000Z",
  uncertainty: 0.001,
  uncertaintyUnit: "g",
  coverageFactor: 2,
};

function job(overrides: Partial<CertificateJobData> = {}): CertificateJobData {
  return {
    jobId: "CAL-2026-9001",
    verificationToken: "tok-1",
    organizationId: "org-1",
    unitId: 1,
    performedAt: new Date("2026-06-25T12:00:00Z"),
    approvedAt: new Date("2026-06-26T12:00:00Z"),
    approverName: "Ana Aprovadora",
    lab: {
      name: "Laboratório Teste",
      cnpj: "11.111.111/0001-11",
      street: "Rua da Matriz",
      number: "1",
      city: "Canoas",
      state: "RS",
      accreditationNumber: "9999",
      accreditationActive: true,
      // The manager's title: must never appear under another person's signature.
      technicalManagerTitle: "Gerente Técnico",
    },
    customer: { name: "Cliente Teste", address: null },
    asset: {
      name: "Balança",
      serialNumber: "SN-1",
      tag: "TAG-1",
      model: null,
      manufacturer: null,
    },
    methodSnapshot: {
      methodId: 6,
      methodName: "Massa",
      methodVersion: 1,
      accreditedScope: true,
      dataFields: [
        {
          key: "pontos",
          label: "Pontos",
          type: "table",
          columns: [
            {
              key: "carga_nominal",
              label: "Carga nominal",
              type: "number",
              unit: "g",
              quantityKind: "reference",
            },
          ],
        },
      ],
      formulas: [
        {
          outputKey: "erro",
          expression: "x",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: { role: "primary_result", group: "calibration_result" },
        },
        {
          outputKey: "u",
          expression: "x",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: {
            role: "expanded_uncertainty",
            group: "calibration_result",
          },
        },
        {
          outputKey: "veff",
          expression: "x",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: { role: "auxiliary", group: "uncertainty_budget" },
        },
        {
          outputKey: "k",
          expression: "if_zero(u_rep, 2, student_t(veff))",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: {
            role: "coverage_factor",
            group: "uncertainty_budget",
          },
        },
      ],
    },
    standardsSnapshot: [VERIFIED_STANDARD],
    data: { pontos: [{ carga_nominal: "500" }, { carga_nominal: "1000" }] },
    results: {
      erro: ["-0.4", "-1.4"],
      u: ["0.31", "0.42"],
      veff: ["1000000000", "1000000000"],
      k: ["2", "2"],
    },
    ...overrides,
  };
}

function unwrap(result: ReturnType<typeof buildCertificateLayoutData>) {
  if (!result.ok) throw new Error(`expected ok: ${result.reasons.join("; ")}`);
  return result.data;
}

/** Freezes the way approval does and reads back through JSON, like the worker. */
function frozen(source: CertificateJobData) {
  const input = buildCertificateInput(source, null);
  const reread: unknown = JSON.parse(JSON.stringify(input));
  if (!isFrozen(reread)) throw new Error("unexpected shape");
  return reread;
}
function isFrozen(
  value: unknown,
): value is ReturnType<typeof buildCertificateInput> {
  return typeof value === "object" && value !== null && "job" in value;
}

function renderCurrent(source: CertificateJobData) {
  const input = frozen(source);
  return unwrap(
    buildCertificateLayoutData(input.job, {
      contentRules: certificateContentRulesFor(input.layout.version),
      accredited: input.seal.accredited,
      verificationUrl: input.verificationUrl,
    }),
  );
}

describe("REQ-C1-1: the coverage sentence on the certificate comes from the frozen result", () => {
  it("k = 2, ν_eff = ∞", () => {
    expect(renderCurrent(job()).uncertaintyStatement).toBe(
      "A incerteza de medição relatada é a incerteza expandida, obtida " +
        "multiplicando-se a incerteza padrão combinada pelo fator de " +
        "abrangência k = 2,00, o qual para uma distribuição normal corresponde " +
        "a uma probabilidade de abrangência de aproximadamente 95 %.",
    );
  });

  it("k ≠ 2 with a finite ν_eff states k and ν_eff", () => {
    const text = renderCurrent(
      job({
        results: {
          erro: ["-0.4", "-1.4"],
          u: ["0.31", "0.42"],
          veff: ["8.2", "8.3"],
          k: ["2.306", "2.306"],
        },
      }),
    ).uncertaintyStatement;
    expect(text).toContain("k = 2,31");
    expect(text).toContain("ν_eff = 8 graus de liberdade efetivos");
    expect(text).toContain("distribuição t");
  });

  it("k ≠ 2 with ν_eff = ∞", () => {
    const text = renderCurrent(
      job({
        results: {
          erro: ["-0.4", "-1.4"],
          u: ["0.31", "0.42"],
          veff: ["1000000000", "1000000000"],
          k: ["2.576", "2.576"],
        },
      }),
    ).uncertaintyStatement;
    expect(text).toContain("k = 2,58, com ν_eff = ∞");
  });

  it("the probability is the one the frozen calculation recorded, not a constant", () => {
    const text = renderCurrent(
      job({
        results: {
          erro: ["-0.4", "-1.4"],
          u: ["0.31", "0.42"],
          veff: ["1000000000", "1000000000"],
          k: ["2.576", "2.576"],
          __compiledExecution: {
            measurementModelResults: [
              { key: "m", result: { coverageProbability: 0.99 } },
            ],
          },
        },
      }),
    ).uncertaintyStatement;
    expect(text).toContain("aproximadamente 99 %");
    expect(text).not.toContain("95 %");
  });

  it("is built from the frozen results only: the method snapshot's formulas play no part", () => {
    const source = job();
    const withOtherFormulaText = job();
    const factor = withOtherFormulaText.methodSnapshot.formulas?.find(
      (formula) => formula.outputKey === "k",
    );
    if (!factor) throw new Error("fixture");
    factor.expression = "student_t_inverse_2t(0.01, veff)";
    expect(renderCurrent(withOtherFormulaText).uncertaintyStatement).toBe(
      renderCurrent(source).uncertaintyStatement,
    );
  });
});

describe("REQ-C1-2: the signatory's title is the authorized-signatory record's", () => {
  const signatory = {
    recordId: 4,
    name: "Ana Aprovadora",
    title: "Signatária Autorizada — Massa",
    assetTypeId: null,
    scopeDescription: null,
    authorizedAt: "2025-01-01T00:00:00.000Z",
  };

  it("prints the record's name and title, not the manager's title", () => {
    const data = renderCurrent(job({ signatory }));
    expect(data.signatory.name).toBe("Ana Aprovadora");
    expect(data.signatory.role).toBe("Signatária Autorizada — Massa");
    expect(data.signatory.role).not.toBe("Gerente Técnico");
  });

  it("prints no title when the record has none, rather than the manager's", () => {
    const data = renderCurrent(
      job({ signatory: { ...signatory, title: null } }),
    );
    expect(data.signatory.role).toBeNull();
  });

  it("prints no title when the approver has no record at all", () => {
    expect(renderCurrent(job({ signatory: null })).signatory.role).toBeNull();
    expect(renderCurrent(job()).signatory.role).toBeNull();
  });

  it("the legacy rules still print what they always printed", () => {
    const data = unwrap(buildCertificateLayoutData(job({ signatory })));
    expect(data.signatory.role).toBe("Gerente Técnico");
  });
});

describe("REQ-C2-1: the calibrating body on the certificate", () => {
  const unitBody = {
    source: "unit",
    unitId: 2,
    unitName: "Filial Sul",
    legalName: "Lab Filial Ltda",
    cnpj: "22.222.222/0001-22",
    street: "Av. da Filial",
    number: "200",
    complement: null,
    neighbourhood: null,
    city: "Pelotas",
    state: "RS",
    cep: null,
  } satisfies NonNullable<CertificateJobData["calibratingBody"]>;

  it("shows the unit's legal name, CNPJ and address, and the header follows", () => {
    const data = renderCurrent(job({ calibratingBody: unitBody }));
    expect(data.calibratingBody).toEqual({
      legalName: "Lab Filial Ltda",
      cnpj: "22.222.222/0001-22",
      addressText: "Av. da Filial, 200 — Pelotas/RS",
    });
    expect(data.lab.cnpj).toBe("22.222.222/0001-22");
    expect(data.lab.addressText).toBe("Av. da Filial, 200 — Pelotas/RS");
  });

  it("shows the organization when that is the calibrating body", () => {
    const data = renderCurrent(
      job({
        calibratingBody: {
          ...unitBody,
          source: "organization",
          legalName: "Laboratório Teste",
          cnpj: "11.111.111/0001-11",
          street: "Rua da Matriz",
          number: "1",
        },
      }),
    );
    expect(data.calibratingBody?.cnpj).toBe("11.111.111/0001-11");
  });

  it("is not printed for an input frozen before it was modelled", () => {
    const data = unwrap(
      buildCertificateLayoutData(job({ calibratingBody: unitBody })),
    );
    expect(data.calibratingBody).toBeUndefined();
    expect(data.lab.cnpj).toBe("11.111.111/0001-11");
  });
});

describe("REQ-C2-2: the SI-traceability sentence (golden, both cases)", () => {
  it("verified: printed, naming the accredited provider", () => {
    expect(renderCurrent(job()).traceabilityStatementText).toBe(
      "As medições realizadas são metrologicamente rastreáveis ao Sistema " +
        "Internacional de Unidades (SI) por meio dos padrões relacionados " +
        "neste certificado, calibrados por laboratórios acreditados: " +
        "Laboratório RBC (acreditação CAL 0123).",
    );
  });

  it("not verified (free-text provider only): omitted, never asserted", () => {
    const { calibrationProvider: _omitted, ...freeText } = VERIFIED_STANDARD;
    const data = renderCurrent(job({ standardsSnapshot: [freeText] }));
    expect(data.traceabilityStatementText).toBeNull();
    // The standards table itself is still printed.
    expect(data.standards).toHaveLength(1);
  });

  it("not verified (certificate not valid on the calibration day): omitted", () => {
    const data = renderCurrent(
      job({
        standardsSnapshot: [
          {
            ...VERIFIED_STANDARD,
            nextCalibrationDate: "2026-06-01T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(data.traceabilityStatementText).toBeNull();
  });

  it("not verified when any one of several standards is unverified", () => {
    const data = renderCurrent(
      job({
        standardsSnapshot: [
          VERIFIED_STANDARD,
          { ...VERIFIED_STANDARD, id: 2, calibrationProvider: null },
        ],
      }),
    );
    expect(data.traceabilityStatementText).toBeNull();
  });

  it("the decision is the frozen one: the render never re-decides it", () => {
    const input = frozen(job());
    // Tampering with the standards after the freeze changes nothing printed.
    const tampered = {
      ...input.job,
      standardsSnapshot: [{ ...VERIFIED_STANDARD, calibrationProvider: null }],
    };
    const data = unwrap(
      buildCertificateLayoutData(tampered, { contentRules: "current" }),
    );
    expect(data.traceabilityStatementText).toContain("rastreáveis ao Sistema");
  });
});

describe("existing certificates re-render byte-identically from their frozen input", () => {
  /** An input frozen before C1/C2: no signatory, calibrating body or traceability. */
  function legacyFrozen() {
    const source = job({
      standardsSnapshot: [
        { ...VERIFIED_STANDARD, calibrationProvider: undefined },
      ],
    });
    const input = frozen(source);
    const { traceability: _t, ...oldJob } = input.job;
    return {
      ...input,
      layout: { ...input.layout, version: "1.0.0" },
      job: oldJob,
    };
  }

  it("a 1.0.0 input renders under the legacy rules", () => {
    const input = legacyFrozen();
    expect(certificateContentRulesFor(input.layout.version)).toBe("legacy");
    const data = unwrap(
      buildCertificateLayoutData(input.job, {
        contentRules: certificateContentRulesFor(input.layout.version),
        accredited: input.seal.accredited,
      }),
    );
    // The statements it was issued with, verbatim.
    expect(data.uncertaintyStatement).toBe(
      "A incerteza de medição relatada é a incerteza expandida, obtida " +
        "multiplicando-se a incerteza padrão combinada pelo fator de " +
        "abrangência k = 2,00, que para uma distribuição t com os graus de " +
        "liberdade efetivos indicados corresponde a uma probabilidade de " +
        "abrangência de aproximadamente 95 %.",
    );
    expect(data.traceabilityStatementText).toBe(
      "As medições realizadas são metrologicamente rastreáveis ao Sistema " +
        "Internacional de Unidades (SI) por meio dos padrões relacionados " +
        "neste certificado, calibrados por Laboratório RBC.",
    );
    expect(data.signatory.role).toBe("Gerente Técnico");
    expect(data.calibratingBody).toBeUndefined();
    expect(data.lab.cnpj).toBe("11.111.111/0001-11");
    expect(data.lab.addressText).toBe("Rua da Matriz, 1 — Canoas/RS");
  });

  it("the legacy output is unaffected by fields only a newer input carries", () => {
    const input = legacyFrozen();
    const options = {
      contentRules: "legacy",
      accredited: input.seal.accredited,
    } as const;
    const plain = buildCertificateLayoutData(input.job, options);
    const withNewFields = buildCertificateLayoutData(
      {
        ...input.job,
        signatory: {
          recordId: 1,
          name: "Outra Pessoa",
          title: "Outro título",
          assetTypeId: null,
          scopeDescription: null,
          authorizedAt: "2025-01-01T00:00:00.000Z",
        },
        traceability: {
          verified: true,
          evaluatedAt: "2026-06-26T12:00:00.000Z",
          providers: [{ name: "X", accreditationNumber: "CAL 1" }],
          failures: [],
        },
      },
      options,
    );
    expect(JSON.stringify(withNewFields)).toBe(JSON.stringify(plain));
  });
});
