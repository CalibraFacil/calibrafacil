import { describe, expect, it } from "vitest";

import {
  buildCoverageStatement,
  formatCoveragePercent,
  frozenCoverageProbability,
  type FrozenCoverageProbability,
} from "./coverage-statement";

/**
 * REQ-C1-1 golden tests. The sentences are pinned verbatim: they give the
 * numbers in the results table their meaning (NIT-DICLA-021 A.6.1.1 / A.6.2), so
 * a changed word is a change an assessor would see.
 */

const BASE =
  "A incerteza de medição relatada é a incerteza expandida, obtida " +
  "multiplicando-se a incerteza padrão combinada pelo fator de abrangência k";

const P95 = {
  kind: "recorded",
  value: 0.95,
} satisfies FrozenCoverageProbability;

describe("REQ-C1-1: the coverage sentence (golden)", () => {
  it("k = 2, ν_eff = ∞: the standard wording, normal distribution", () => {
    expect(
      buildCoverageStatement({
        rows: [
          { coverageFactor: "2,00", effectiveDegreesOfFreedom: "∞" },
          { coverageFactor: "2,00", effectiveDegreesOfFreedom: "∞" },
        ],
        probability: P95,
      }),
    ).toBe(
      `${BASE} = 2,00, o qual para uma distribuição normal corresponde a ` +
        "uma probabilidade de abrangência de aproximadamente 95 %.",
    );
  });

  it("k = 2 with no ν_eff column at all: the same standard wording", () => {
    expect(
      buildCoverageStatement({
        rows: [{ coverageFactor: "2,00", effectiveDegreesOfFreedom: null }],
        probability: P95,
      }),
    ).toBe(
      `${BASE} = 2,00, o qual para uma distribuição normal corresponde a ` +
        "uma probabilidade de abrangência de aproximadamente 95 %.",
    );
  });

  it("k ≠ 2 with a finite ν_eff: k and ν_eff are stated (A.6.2)", () => {
    expect(
      buildCoverageStatement({
        rows: [
          { coverageFactor: "2,31", effectiveDegreesOfFreedom: "8" },
          { coverageFactor: "2,31", effectiveDegreesOfFreedom: "8" },
        ],
        probability: P95,
      }),
    ).toBe(
      `${BASE} = 2,31, o qual para uma distribuição t com ν_eff = 8 graus de ` +
        "liberdade efetivos corresponde a uma probabilidade de abrangência de " +
        "aproximadamente 95 %.",
    );
  });

  it("k ≠ 2 with ν_eff = ∞: k stated, ν_eff = ∞, normal distribution", () => {
    expect(
      buildCoverageStatement({
        rows: [{ coverageFactor: "2,58", effectiveDegreesOfFreedom: "∞" }],
        probability: { kind: "recorded", value: 0.99 },
      }),
    ).toBe(
      `${BASE} = 2,58, com ν_eff = ∞ graus de liberdade efetivos, o qual ` +
        "para uma distribuição normal corresponde a uma probabilidade de " +
        "abrangência de aproximadamente 99 %.",
    );
  });

  it("k ≠ 2 with no ν_eff recorded: k stated, t distribution, no invented ν_eff", () => {
    expect(
      buildCoverageStatement({
        rows: [{ coverageFactor: "2,45", effectiveDegreesOfFreedom: null }],
        probability: P95,
      }),
    ).toBe(
      `${BASE} = 2,45, o qual para uma distribuição t corresponde a uma ` +
        "probabilidade de abrangência de aproximadamente 95 %.",
    );
  });

  it("k that differs by point: the sentence refers to the table, which carries k and ν_eff", () => {
    expect(
      buildCoverageStatement({
        rows: [
          { coverageFactor: "2,00", effectiveDegreesOfFreedom: "∞" },
          { coverageFactor: "2,18", effectiveDegreesOfFreedom: "12" },
        ],
        probability: P95,
      }),
    ).toBe(
      `${BASE}, indicado para cada ponto na tabela de resultados, o qual ` +
        "para uma distribuição t com os graus de liberdade efetivos ν_eff " +
        "indicados na tabela de resultados corresponde a uma probabilidade de " +
        "abrangência de aproximadamente 95 %.",
    );
  });

  it("same k but different ν_eff per point: k stated, ν_eff by the table", () => {
    expect(
      buildCoverageStatement({
        rows: [
          { coverageFactor: "2,10", effectiveDegreesOfFreedom: "15" },
          { coverageFactor: "2,10", effectiveDegreesOfFreedom: "17" },
        ],
        probability: P95,
      }),
    ).toBe(
      `${BASE} = 2,10, o qual para uma distribuição t com os graus de ` +
        "liberdade efetivos ν_eff indicados para cada ponto na tabela de " +
        "resultados corresponde a uma probabilidade de abrangência de " +
        "aproximadamente 95 %.",
    );
  });

  it("no k in the results at all: per point in the table, nothing invented", () => {
    expect(
      buildCoverageStatement({
        rows: [{ coverageFactor: null, effectiveDegreesOfFreedom: null }],
        probability: P95,
      }),
    ).toBe(
      `${BASE}, indicado para cada ponto na tabela de resultados, ` +
        "correspondendo a uma probabilidade de abrangência de aproximadamente 95 %.",
    );
  });
});

describe("REQ-C1-1: the probability is the frozen one, in pt-BR", () => {
  it("prints the recorded probability, with a decimal comma", () => {
    expect(formatCoveragePercent(0.95)).toBe("95");
    expect(formatCoveragePercent(0.9545)).toBe("95,45");
    expect(formatCoveragePercent(0.99)).toBe("99");
    expect(
      buildCoverageStatement({
        rows: [{ coverageFactor: "2,00", effectiveDegreesOfFreedom: "∞" }],
        probability: { kind: "recorded", value: 0.9545 },
      }),
    ).toContain("aproximadamente 95,45 %");
  });

  it("falls back to the engine default only when the calculation recorded none", () => {
    expect(
      buildCoverageStatement({
        rows: [{ coverageFactor: "2,00", effectiveDegreesOfFreedom: "∞" }],
        probability: { kind: "unrecorded" },
      }),
    ).toContain("aproximadamente 95 %");
  });

  it("asserts no number when the frozen models disagree", () => {
    const text = buildCoverageStatement({
      rows: [{ coverageFactor: "2,00", effectiveDegreesOfFreedom: "∞" }],
      probability: { kind: "conflict" },
    });
    expect(text).toContain("registrada para cada ponto no cálculo");
    expect(text).not.toContain("95");
  });

  const model = (coverageProbability: number) => ({
    key: "m",
    result: { coverageProbability, value: "1" },
  });

  it("reads the probability from __compiledExecution.measurementModelResults", () => {
    expect(
      frozenCoverageProbability({
        __compiledExecution: { measurementModelResults: [model(0.99)] },
      }),
    ).toEqual({ kind: "recorded", value: 0.99 });
    // A row-scoped model carries an array of results.
    expect(
      frozenCoverageProbability({
        __compiledExecution: {
          measurementModelResults: [
            { key: "m", result: [model(0.95).result, model(0.95).result] },
          ],
        },
      }),
    ).toEqual({ kind: "recorded", value: 0.95 });
  });

  it("is unrecorded for formula-declared k, conflicting when models differ", () => {
    expect(frozenCoverageProbability(null)).toEqual({ kind: "unrecorded" });
    expect(frozenCoverageProbability({ k: ["2"] })).toEqual({
      kind: "unrecorded",
    });
    expect(
      frozenCoverageProbability({
        __compiledExecution: { measurementModelResults: [] },
      }),
    ).toEqual({ kind: "unrecorded" });
    expect(
      frozenCoverageProbability({
        __compiledExecution: {
          measurementModelResults: [model(0.95), model(0.99)],
        },
      }),
    ).toEqual({ kind: "conflict" });
  });

  it("ignores a recorded probability that is not a probability", () => {
    expect(
      frozenCoverageProbability({
        __compiledExecution: { measurementModelResults: [model(95)] },
      }),
    ).toEqual({ kind: "unrecorded" });
  });
});
