/**
 * The coverage sentence of a certificate (NIT-DICLA-021 A.6.1.1 / A.6.2, ILAC
 * P14 §5), built ONLY from the frozen result: the coverage factor and the
 * effective degrees of freedom exactly as the results table prints them, and
 * the coverage probability the frozen calculation recorded. Nothing here reads
 * the method definition, the lab or the clock.
 *
 * Forms (Q46):
 *   - k = 2 (about 95 %): the standard wording, "distribuição normal";
 *   - k ≠ 2 with a finite ν_eff: `k = XX` and `ν_eff = YY` are stated, "distribuição t";
 *   - k ≠ 2 with ν_eff = ∞: `k = XX`, "distribuição normal", ν_eff = ∞;
 *   - per-point values that differ: the sentence refers to the table, which
 *     carries k and ν_eff on every row.
 *
 * Numbers use the pt-BR decimal comma (Q47), formatted by the same functions as
 * the table so the sentence and the table cannot disagree.
 */

import { formatNumber } from "@calibra-facil/shared/format";

/** What the engine assumes when a calculation records no coverage probability. */
const DEFAULT_COVERAGE_PROBABILITY = 0.95;

export type CoverageRowFacts = {
  /** The coverage factor as the table prints it ("2,00"), null when none. */
  coverageFactor?: string | null;
  /** ν_eff as the table prints it ("8", "∞"), null when none. */
  effectiveDegreesOfFreedom?: string | null;
};

const BASE =
  "A incerteza de medição relatada é a incerteza expandida, obtida " +
  "multiplicando-se a incerteza padrão combinada pelo fator de abrangência k";

function uniqueNonNull(
  values: ReadonlyArray<string | null | undefined>,
): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string => value !== null && value !== undefined,
      ),
    ),
  ];
}

/** "95", "95,45": the probability as a percentage, at most two decimals. */
export function formatCoveragePercent(probability: number): string {
  return formatNumber(Math.round(probability * 10000) / 100, {
    maxDecimals: 2,
  });
}

/**
 * What the frozen calculation recorded about the coverage probability:
 * `recorded` (one value), `unrecorded` (formula-declared k: the engine default
 * applies) or `conflict` (measurement models disagree: no number is asserted).
 */
export type FrozenCoverageProbability =
  | { kind: "recorded"; value: number }
  | { kind: "unrecorded" }
  | { kind: "conflict" };

/**
 * The coverage probability recorded by the frozen calculation
 * (`__compiledExecution.measurementModelResults[].result.coverageProbability`).
 */
export function frozenCoverageProbability(
  results: Record<string, unknown> | null | undefined,
): FrozenCoverageProbability {
  const compiled = results?.__compiledExecution;
  if (!isRecord(compiled)) return { kind: "unrecorded" };
  const models = compiled.measurementModelResults;
  if (!Array.isArray(models)) return { kind: "unrecorded" };

  const found = new Set<number>();
  for (const model of models) {
    if (!isRecord(model)) continue;
    const entries = Array.isArray(model.result) ? model.result : [model.result];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const probability = entry.coverageProbability;
      if (
        typeof probability === "number" &&
        Number.isFinite(probability) &&
        probability > 0 &&
        probability < 1
      ) {
        found.add(probability);
      }
    }
  }
  if (found.size === 0) return { kind: "unrecorded" };
  const [only] = [...found];
  return found.size === 1 && only !== undefined
    ? { kind: "recorded", value: only }
    : { kind: "conflict" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildCoverageStatement(params: {
  rows: readonly CoverageRowFacts[];
  /** From `frozenCoverageProbability`; unrecorded falls back to the engine default. */
  probability: FrozenCoverageProbability;
}): string {
  const probability =
    params.probability.kind === "conflict"
      ? "registrada para cada ponto no cálculo"
      : `de aproximadamente ${formatCoveragePercent(
          params.probability.kind === "recorded"
            ? params.probability.value
            : DEFAULT_COVERAGE_PROBABILITY,
        )} %`;
  const ending = `uma probabilidade de abrangência ${probability}.`;
  const factors = uniqueNonNull(params.rows.map((row) => row.coverageFactor));
  const dofs = uniqueNonNull(
    params.rows.map((row) => row.effectiveDegreesOfFreedom),
  );

  // No k at all: the table carries whatever there is, per point.
  if (factors.length === 0) {
    return `${BASE}, indicado para cada ponto na tabela de resultados, correspondendo a ${ending}`;
  }

  // k that varies by point: the table carries k (and ν_eff) on every row.
  if (factors.length > 1) {
    const finiteDof = dofs.some((dof) => dof !== "∞");
    return finiteDof
      ? `${BASE}, indicado para cada ponto na tabela de resultados, o qual ` +
          "para uma distribuição t com os graus de liberdade efetivos ν_eff " +
          `indicados na tabela de resultados corresponde a ${ending}`
      : `${BASE}, indicado para cada ponto na tabela de resultados, o qual ` +
          `corresponde a ${ending}`;
  }

  const [k] = factors;
  if (k === "2,00") {
    return `${BASE} = ${k}, o qual para uma distribuição normal corresponde a ${ending}`;
  }

  // k ≠ 2: NIT-DICLA-021 A.6.2 — k and ν_eff are stated.
  if (dofs.length === 0) {
    return `${BASE} = ${k}, o qual para uma distribuição t corresponde a ${ending}`;
  }
  const [dof] = dofs;
  if (dofs.length === 1 && dof === "∞") {
    return (
      `${BASE} = ${k}, com ν_eff = ∞ graus de liberdade efetivos, o qual ` +
      `para uma distribuição normal corresponde a ${ending}`
    );
  }
  if (dofs.length === 1) {
    return (
      `${BASE} = ${k}, o qual para uma distribuição t com ν_eff = ${dof} ` +
      `graus de liberdade efetivos corresponde a ${ending}`
    );
  }
  return (
    `${BASE} = ${k}, o qual para uma distribuição t com os graus de ` +
    "liberdade efetivos ν_eff indicados para cada ponto na tabela de " +
    `resultados corresponde a ${ending}`
  );
}
