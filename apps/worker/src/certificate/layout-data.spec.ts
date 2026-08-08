import type { CertificateJobData } from "@calibra-facil/certificate-data";
import { describe, expect, it } from "vitest";

import { buildCertificateLayoutData } from "./layout-data";

/**
 * The adapter's contract is "read only what the method declares". These tests
 * are written so that a regression toward heuristics fails loudly: the fixture
 * deliberately uses output keys whose SPELLING contradicts their declared
 * metadata, so anything that sniffs `_antes`/`_apos` produces the wrong table.
 *
 * Shapes mirror production (Neon neon-project-id, calibration_job
 * id 29): row-scoped formulas yield parallel arrays, and the math engine writes
 * every number as a string.
 */

function massJob(
  overrides: Partial<CertificateJobData> = {},
): CertificateJobData {
  return {
    jobId: "CAL-2026-9001",
    verificationToken: "tok-1",
    organizationId: "org-1",
    unitId: 1,
    performedAt: new Date("2026-06-25T12:00:00Z"),
    approvedAt: new Date("2026-06-26T12:00:00Z"),
    approverName: "Fulano de Tal",
    lab: {
      name: "Laboratório Teste",
      city: "Canoas",
      state: "RS",
      accreditationNumber: "9999",
      accreditationActive: true,
      technicalManagerTitle: "Signatário Autorizado",
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
      methodName: "Massa — balança",
      methodVersion: 1,
      accreditedScope: true,
      dataFields: [
        {
          // The real shape: a table field whose COLUMNS carry quantityKind.
          // The adapter used to look for flattened `<table>_<column>` entries
          // here, found none, and silently numbered every row "Ponto N".
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
        // NOTE the spelling: the "before" phase formulas are named *_apos and
        // vice versa. Only the declared `phase` is correct. A suffix heuristic
        // swaps the two tables and this test catches it.
        {
          outputKey: "media_apos",
          expression: "x",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: {
            role: "mean_indication",
            group: "calibration_result",
            phase: "before",
          },
        },
        {
          outputKey: "erro_apos",
          expression: "x",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: {
            role: "primary_result",
            group: "calibration_result",
            phase: "before",
          },
        },
        {
          outputKey: "u_apos",
          expression: "x",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: {
            role: "expanded_uncertainty",
            group: "calibration_result",
            phase: "before",
          },
        },
        {
          outputKey: "veff_apos",
          expression: "x",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: {
            role: "auxiliary",
            group: "uncertainty_budget",
            phase: "before",
          },
        },
        {
          outputKey: "k_apos",
          expression: "if_zero(u_rep, 2, student_t(veff_apos))",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: {
            role: "coverage_factor",
            group: "uncertainty_budget",
            phase: "before",
          },
        },
        {
          outputKey: "dispersao",
          expression: "x",
          unit: "g",
          scope: { kind: "table_row", tableKey: "repeticoes" },
          reporting: { role: "primary_result", group: "calibration_result" },
        },
        {
          outputKey: "desvio_exc",
          expression: "x",
          unit: "g",
          scope: { kind: "table_row", tableKey: "excentric" },
          reporting: { role: "primary_result", group: "calibration_result" },
        },
        {
          outputKey: "erro_antes",
          expression: "x",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: {
            role: "primary_result",
            group: "calibration_result",
            phase: "after",
          },
        },
        {
          outputKey: "u_antes",
          expression: "x",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: {
            role: "expanded_uncertainty",
            group: "calibration_result",
            phase: "after",
          },
        },
      ],
    },
    standardsSnapshot: [
      {
        id: 1,
        name: "Massa padrão",
        certificateNumber: "CERT-1",
        calibratedBy: "RBC Padrões",
        calibrationDate: "2026-01-01T00:00:00.000Z",
        nextCalibrationDate: "2027-01-01T00:00:00.000Z",
        uncertainty: 0.001,
        uncertaintyUnit: "g",
        coverageFactor: 2,
      },
    ],
    data: {
      pontos: [{ carga_nominal: "500" }, { carga_nominal: "1000" }],
      repeticoes: [
        {
          condicao: "1000 kg",
          leitura_1: "999000",
          leitura_2: "999000",
          leitura_3: "999000",
        },
      ],
      excentric: [{ posicao: "A", antes: "499500", apos: "500000" }],
    },
    results: {
      media_apos: ["499500.4", "999000.4"],
      erro_apos: ["-500.4", "-1000.4"],
      u_apos: ["290.56691857412756", "296.16977678124834"],
      veff_apos: ["1000000000", "12"],
      k_apos: ["2", "2.179"],
      erro_antes: ["-1.2", "-2.3"],
      u_antes: ["12.345", "13.456"],
      dispersao: ["0.5"],
      desvio_exc: ["-500"],
    },
    ...overrides,
  };
}

function unwrap(result: ReturnType<typeof buildCertificateLayoutData>) {
  if (!result.ok) throw new Error(`expected ok: ${result.reasons.join("; ")}`);
  return result.data;
}

describe("buildCertificateLayoutData", () => {
  it("orders the tables by DECLARED phase, not by output-key spelling", () => {
    const data = unwrap(buildCertificateLayoutData(massJob()));
    expect(data.resultTables.map((table) => table.title)).toEqual([
      "Resultados antes do ajuste",
      "Resultados após o ajuste",
    ]);
    // The *_apos-named formulas are declared phase "before", so their values
    // must land in the as-found table. Suffix sniffing puts them second.
    expect(data.resultTables[0]?.rows[0]?.error).toBe("-500");
    // U = 12,345 -> 12 (2 s.f.), whose last significant figure is the units
    // digit, so -1,2 correctly rounds to -1. The point of the assertion is
    // WHICH table it landed in, not the rounding.
    expect(data.resultTables[1]?.rows[0]?.error).toBe("-1");
    expect(data.resultTables[1]?.rows[0]?.expandedUncertainty).toBe("12");
  });

  it("applies the A.6.3 rounding rule across the whole row", () => {
    const data = unwrap(buildCertificateLayoutData(massJob()));
    const row = data.resultTables[0]?.rows[0];
    // U = 290,56... -> 290 (2 s.f., last figure in the tens), so the error is
    // rounded to the tens too: -500,4 prints as -500, not -500,4.
    expect(row?.expandedUncertainty).toBe("290");
    expect(row?.error).toBe("-500");
    expect(row?.indication).toBe("499500");
  });

  it("prints ν = ∞ rather than the engine's sentinel", () => {
    const data = unwrap(buildCertificateLayoutData(massJob()));
    expect(data.resultTables[0]?.rows[0]?.effectiveDegreesOfFreedom).toBe("∞");
    expect(data.resultTables[0]?.rows[1]?.effectiveDegreesOfFreedom).toBe("12");
  });

  it("labels rows from the declared reference column", () => {
    const data = unwrap(buildCertificateLayoutData(massJob()));
    // No thousands separator: "1.000" is a pt-BR grouping but reads as a
    // decimal point, and the results table prints the same magnitudes ungrouped.
    expect(data.resultTables[0]?.rows.map((row) => row.point)).toEqual([
      "500 g",
      "1000 g",
    ]);
  });

  it("renders a single untitled-by-phase table when no phase is declared", () => {
    // A genuinely single-phase method: ONE formula per column, no phase. Just
    // stripping `phase` from the two-phase fixture would leave two error
    // formulas over one table, which is the ambiguous case below, not this one.
    const job = massJob();
    job.methodSnapshot.formulas = (job.methodSnapshot.formulas ?? [])
      .filter((formula) => formula.reporting?.phase !== "after")
      .map((formula) => {
        if (formula.reporting) delete formula.reporting.phase;
        return formula;
      });
    const data = unwrap(buildCertificateLayoutData(job));
    expect(data.resultTables).toHaveLength(1);
    expect(data.resultTables[0]?.title).toBe("Resultados da calibração");
  });

  // The pre-#865 shape, still frozen into every snapshot taken before the
  // method was re-seeded: media_indicacao and erro_indicacao BOTH declared
  // "primary_result" for the same phase. Taking the first would print the mean
  // indication under the "Erro" heading — a wrong number under a right label,
  // which is the worst possible failure for a regulated document.
  it("refuses when two formulas claim the same column in the same phase", () => {
    const job = massJob();
    const formulas = job.methodSnapshot.formulas ?? [];
    const indication = formulas.find(
      (formula) => formula.reporting?.role === "mean_indication",
    );
    if (!indication?.reporting) throw new Error("fixture must have one");
    indication.reporting.role = "primary_result";

    const result = buildCertificateLayoutData(job);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const why = result.reasons.join(" ");
    // The message must name BOTH culprits so an operator can act on it.
    expect(why).toContain("media_apos");
    expect(why).toContain("erro_apos");
    expect(why).toContain("Reexecute");
  });

  it("refuses to build when the method declares no reported uncertainty", () => {
    const job = massJob();
    job.methodSnapshot.formulas = (job.methodSnapshot.formulas ?? []).filter(
      (formula) => formula.reporting?.role !== "expanded_uncertainty",
    );
    const result = buildCertificateLayoutData(job);
    // A blocked issuance is recoverable; a table built by guessing is not.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reasons.join(" ")).toContain("expanded_uncertainty");
  });

  it("refuses to build without an approver or an approval date", () => {
    const noApprover = buildCertificateLayoutData(
      massJob({ approverName: null }),
    );
    expect(noApprover.ok).toBe(false);
    const noDate = buildCertificateLayoutData(massJob({ approvedAt: null }));
    expect(noDate.ok).toBe(false);
  });

  it("prints the repeatability dispersion the method computed", () => {
    // cg-18 §6.1: the readings exist to produce s. This column was hardcoded
    // to null, so every certificate showed an em dash while the engine had the
    // number all along.
    const data = unwrap(buildCertificateLayoutData(massJob()));
    expect(data.repeatability?.rows[0]?.value).toBe("0,5");
    expect(data.repeatability?.rows[0]?.readings).toHaveLength(3);
  });

  it("formats block values exactly like the results table", () => {
    // toLocaleString's default grouping renders 499500 as "499.500", which is a
    // pt-BR thousands separator but reads as a decimal point — and the very
    // same magnitude prints ungrouped in the results table two sections above.
    const data = unwrap(buildCertificateLayoutData(massJob()));
    expect(data.eccentricity?.rows[0]?.before).toBe("499500");
    expect(data.repeatability?.rows[0]?.readings[0]).toBe("999000");
    expect(data.eccentricity?.rows[0]?.before).not.toContain(".");
  });

  it("passes the approver's visual signature through to the layout", () => {
    const data = unwrap(
      buildCertificateLayoutData(
        massJob({ approverSignatureUrl: "data:image/png;base64,SIG" }),
      ),
    );
    expect(data.signatory.signatureImageDataUrl).toBe("data:image/png;base64,SIG");
  });

  it("never invents a conformity verdict", () => {
    // §7.8.6.2 needs a decision rule the method must declare. None do, so no
    // certificate may carry a verdict — PR #587 printed one anyway.
    const data = unwrap(buildCertificateLayoutData(massJob()));
    expect(data.conformity).toBeNull();
  });

  it("states traceability from the standards' calibrating bodies only", () => {
    const data = unwrap(buildCertificateLayoutData(massJob()));
    expect(data.traceabilityStatementText).toContain("RBC Padrões");

    const unattributed = massJob();
    unattributed.standardsSnapshot = [
      {
        id: 1,
        name: "Padrão",
        certificateNumber: "CERT-1",
        calibrationDate: "2026-01-01T00:00:00.000Z",
        nextCalibrationDate: "2027-01-01T00:00:00.000Z",
        uncertainty: 0.001,
        uncertaintyUnit: "g",
        coverageFactor: 2,
      },
    ];
    // §7.8.4.1(c) cannot be evidenced without a calibrating body, and guessing
    // one from the certificate number is worse than omitting the sentence.
    expect(
      unwrap(buildCertificateLayoutData(unattributed))
        .traceabilityStatementText,
    ).toBeNull();
  });

  it("suppresses the seal when the scope was overridden at approval", () => {
    const data = unwrap(
      buildCertificateLayoutData(
        massJob({ scopeOverrideJustification: "Fora do escopo acreditado." }),
      ),
    );
    expect(data.accredited).toBe(false);
  });

  it("carries the §7.8.2.1 g/h/n fields the XLSX layout never printed", () => {
    const data = unwrap(
      buildCertificateLayoutData(
        massJob({
          methodDeviations: "Ponto de 2000 kg não executado.",
          serviceOrder: {
            receivedAt: "2026-06-20T12:00:00.000Z",
            intakeCondition: "Sujo, sem avarias.",
            accessories: "Cabo de força",
          },
        }),
      ),
    );
    expect(data.methodDeviations).toBe("Ponto de 2000 kg não executado.");
    expect(data.item.conditionOnReceipt).toBe("Sujo, sem avarias.");
    expect(data.dates.receivedAtText).toBe("20/06/2026");
  });
});
