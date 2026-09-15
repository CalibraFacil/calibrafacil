import {
  coverageFactorForProbability,
  typeAFromRepeatedObservations,
  typeBStandardUncertainty,
  welchSatterthwaiteDegreesOfFreedom,
  type TypeBDistribution,
} from "@calibra-facil/math-engine";

/**
 * Uncertainty-budget evaluation for the public GUM calculator.
 *
 * Every number the page renders is produced here by `@calibra-facil/math-engine`
 * — the same engine that computes the budget printed on a certificate, not a
 * second implementation written for marketing. That is the point of publishing
 * the tool: a metrologist who checks the arithmetic against their own
 * spreadsheet is checking the product.
 *
 * The module is pure and framework-free so the JSX never parses anything, per
 * the schema-first rule for regulated workflows.
 */

/** Distributions offered publicly — the four that cover an ordinary budget. */
export type DistributionId =
  | "normal"
  | "rectangular"
  | "triangular"
  | "u-shaped";

export type ContributionKind = "typeA" | "typeB";

export const DISTRIBUTIONS: ReadonlyArray<{
  id: DistributionId;
  label: string;
  /** How the divisor reads in a budget table, for the results column. */
  divisorLabel: string;
  hint: string;
}> = [
  {
    id: "normal",
    label: "Normal (certificado do padrão)",
    divisorLabel: "k",
    hint: "Use quando a fonte é o certificado de um padrão, que já declara U e k.",
  },
  {
    id: "rectangular",
    label: "Retangular (uniforme)",
    divisorLabel: "√3",
    hint: "Resolução do indicador, deriva, tolerância — só os limites são conhecidos.",
  },
  {
    id: "triangular",
    label: "Triangular",
    divisorLabel: "√6",
    hint: "Valores centrais mais prováveis que os extremos.",
  },
  {
    id: "u-shaped",
    label: "Em U (arco-seno)",
    divisorLabel: "√2",
    hint: "Grandezas que oscilam entre extremos, como variação cíclica de temperatura.",
  },
];

/** Coverage probabilities a calibration certificate actually declares. */
export const COVERAGE_PROBABILITIES: ReadonlyArray<{
  id: string;
  probability: number;
  label: string;
}> = [
  { id: "9545", probability: 0.9545, label: "95,45 % (k ≈ 2)" },
  { id: "95", probability: 0.95, label: "95 %" },
  { id: "99", probability: 0.99, label: "99 %" },
];

export interface ContributionInput {
  readonly id: string;
  readonly label: string;
  readonly kind: ContributionKind;
  /** Type A: whitespace/semicolon-separated observations. */
  readonly observations: string;
  /** Type B: which distribution the estimate comes from. */
  readonly distribution: DistributionId;
  /** Type B (rectangular/triangular/u-shaped): the half-width a. */
  readonly halfWidth: string;
  /** Type B (normal): U from the standard's certificate. */
  readonly expandedUncertainty: string;
  /** Type B (normal): k from the standard's certificate. */
  readonly coverageFactor: string;
  /** Sensitivity coefficient c_i. Blank reads as 1. */
  readonly sensitivity: string;
  /** Blank reads as infinite for Type B; Type A always uses n − 1. */
  readonly degreesOfFreedom: string;
}

export interface TypeADetail {
  readonly count: number;
  readonly mean: number;
  readonly sampleStandardDeviation: number;
}

export interface ContributionResult {
  readonly id: string;
  readonly label: string;
  readonly kind: ContributionKind;
  /** u(x_i) — the standard uncertainty of the input quantity. */
  readonly standardUncertainty: number;
  /** The divisor applied to reach u(x_i), for the budget table. */
  readonly divisor: number;
  readonly divisorLabel: string;
  readonly sensitivity: number;
  /** u_i(y) = |c_i| · u(x_i) — the contribution to the combined uncertainty. */
  readonly contribution: number;
  readonly variance: number;
  readonly degreesOfFreedom: number;
  /** Share of the combined variance, in percent — the index column. */
  readonly indexPercent: number;
  readonly typeA: TypeADetail | null;
}

export interface BudgetResult {
  readonly contributions: readonly ContributionResult[];
  /** u_c(y). */
  readonly combinedStandardUncertainty: number;
  /** ν_eff by Welch–Satterthwaite. */
  readonly effectiveDegreesOfFreedom: number;
  readonly coverageFactor: number;
  /** U = k · u_c(y). */
  readonly expandedUncertainty: number;
  readonly coverageProbability: number;
  /** The largest contributor, for the plain-language read-out. */
  readonly dominant: ContributionResult | null;
}

export interface BudgetIssue {
  /** Null when the issue belongs to the budget rather than to one row. */
  readonly contributionId: string | null;
  readonly field: string;
  readonly message: string;
}

export type BudgetEvaluation =
  | { readonly ok: true; readonly result: BudgetResult }
  | { readonly ok: false; readonly issues: readonly BudgetIssue[] };

/**
 * pt-BR types "0,05". A comma therefore means decimal separator, and any dot
 * in the same string is a thousands separator from a paste. Without a comma a
 * dot is the decimal separator, so "1.5" stays 1.5 instead of becoming 15.
 */
function normalizeDecimalText(raw: string): string {
  const compact = raw.trim().replace(/\s+/g, "");
  if (compact.includes(",")) {
    return compact.replace(/\./g, "").replace(",", ".");
  }
  return compact;
}

const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Parses one user-typed number. Returns null when the text is not a number. */
export function parseDecimal(raw: string): number | null {
  const normalized = normalizeDecimalText(raw);
  if (!normalized || !DECIMAL_PATTERN.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export interface ParsedObservations {
  readonly values: readonly number[];
  readonly invalid: readonly string[];
}

/**
 * Splits repeated observations on whitespace and semicolons — never on a
 * comma, which in pt-BR is the decimal separator and would silently turn ten
 * readings of "100,02" into twenty integers.
 */
export function parseObservations(raw: string): ParsedObservations {
  const tokens = raw.split(/[\s;]+/).filter((token) => token.length > 0);
  const values: number[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    const value = parseDecimal(token);
    if (value === null) invalid.push(token);
    else values.push(value);
  }
  return { values, invalid };
}

function divisorLabelFor(distribution: DistributionId): string {
  const found = DISTRIBUTIONS.find((item) => item.id === distribution);
  return found ? found.divisorLabel : "1";
}

/** Widens our public distribution ids to the engine's without an assertion. */
function toEngineDistribution(distribution: DistributionId): TypeBDistribution {
  switch (distribution) {
    case "normal":
      return "normal";
    case "rectangular":
      return "rectangular";
    case "triangular":
      return "triangular";
    case "u-shaped":
      return "u-shaped";
  }
}

interface EvaluatedContribution {
  readonly standardUncertainty: number;
  readonly divisor: number;
  readonly degreesOfFreedom: number;
  readonly typeA: TypeADetail | null;
}

function evaluateTypeA(
  input: ContributionInput,
  issues: BudgetIssue[],
): EvaluatedContribution | null {
  const { values, invalid } = parseObservations(input.observations);
  if (invalid.length > 0) {
    issues.push({
      contributionId: input.id,
      field: "observations",
      message: `Não consegui ler: ${invalid.slice(0, 3).join(", ")}.`,
    });
    return null;
  }
  if (values.length < 2) {
    issues.push({
      contributionId: input.id,
      field: "observations",
      message: "A avaliação Tipo A precisa de pelo menos duas observações.",
    });
    return null;
  }

  const typeA = typeAFromRepeatedObservations(values);
  return {
    standardUncertainty: typeA.standardUncertainty,
    divisor: Math.sqrt(typeA.count),
    degreesOfFreedom: typeA.degreesOfFreedom,
    typeA: {
      count: typeA.count,
      mean: typeA.mean,
      sampleStandardDeviation: typeA.sampleStandardDeviation,
    },
  };
}

function evaluateTypeB(
  input: ContributionInput,
  issues: BudgetIssue[],
): EvaluatedContribution | null {
  const distribution = toEngineDistribution(input.distribution);
  const declaredDof = input.degreesOfFreedom.trim()
    ? parseDecimal(input.degreesOfFreedom)
    : Number.POSITIVE_INFINITY;

  if (declaredDof === null || declaredDof <= 0) {
    issues.push({
      contributionId: input.id,
      field: "degreesOfFreedom",
      message:
        "Graus de liberdade devem ser um número maior que zero, ou vazio para infinito.",
    });
    return null;
  }

  if (distribution === "normal") {
    const expanded = parseDecimal(input.expandedUncertainty);
    const coverage = parseDecimal(input.coverageFactor);
    if (expanded === null || expanded < 0) {
      issues.push({
        contributionId: input.id,
        field: "expandedUncertainty",
        message: "Informe U do certificado do padrão.",
      });
      return null;
    }
    if (coverage === null || coverage <= 0) {
      issues.push({
        contributionId: input.id,
        field: "coverageFactor",
        message: "Informe k do certificado do padrão (normalmente 2).",
      });
      return null;
    }
    const typeB = typeBStandardUncertainty({
      distribution,
      expandedUncertainty: expanded,
      coverageFactor: coverage,
    });
    return {
      standardUncertainty: typeB.standardUncertainty,
      divisor: typeB.divisor,
      degreesOfFreedom: declaredDof,
      typeA: null,
    };
  }

  const halfWidth = parseDecimal(input.halfWidth);
  if (halfWidth === null || halfWidth < 0) {
    issues.push({
      contributionId: input.id,
      field: "halfWidth",
      message: "Informe a meia-largura a (metade do intervalo).",
    });
    return null;
  }
  const typeB = typeBStandardUncertainty({ distribution, halfWidth });
  return {
    standardUncertainty: typeB.standardUncertainty,
    divisor: typeB.divisor,
    degreesOfFreedom: declaredDof,
    typeA: null,
  };
}

/**
 * Evaluates the whole budget: u(x_i) per row, u_c by quadratic composition of
 * the c_i·u(x_i), ν_eff by Welch–Satterthwaite (GUM Eq. G.2b) and k as the
 * Student-t quantile at the requested coverage probability.
 *
 * Correlation is deliberately absent. The public tool assumes uncorrelated
 * inputs and says so on the page — quietly composing correlated contributions
 * as if independent understates U, which is the one error a calibration
 * certificate must never make.
 */
export function evaluateBudget(
  contributions: readonly ContributionInput[],
  coverageProbability: number,
): BudgetEvaluation {
  const issues: BudgetIssue[] = [];

  if (contributions.length === 0) {
    return {
      ok: false,
      issues: [
        {
          contributionId: null,
          field: "contributions",
          message: "Adicione pelo menos uma contribuição.",
        },
      ],
    };
  }

  const evaluated: Array<{
    input: ContributionInput;
    evaluation: EvaluatedContribution;
    sensitivity: number;
  }> = [];

  for (const input of contributions) {
    const sensitivity = input.sensitivity.trim()
      ? parseDecimal(input.sensitivity)
      : 1;
    if (sensitivity === null) {
      issues.push({
        contributionId: input.id,
        field: "sensitivity",
        message: "O coeficiente de sensibilidade deve ser um número.",
      });
      continue;
    }

    const evaluation =
      input.kind === "typeA"
        ? evaluateTypeA(input, issues)
        : evaluateTypeB(input, issues);
    if (evaluation) evaluated.push({ input, evaluation, sensitivity });
  }

  if (issues.length > 0) return { ok: false, issues };

  const variances = evaluated.map(({ evaluation, sensitivity }) => {
    const contribution = Math.abs(sensitivity) * evaluation.standardUncertainty;
    return contribution * contribution;
  });
  const combinedVariance = variances.reduce((sum, value) => sum + value, 0);
  const combinedStandardUncertainty = Math.sqrt(combinedVariance);

  if (!(combinedStandardUncertainty > 0)) {
    return {
      ok: false,
      issues: [
        {
          contributionId: null,
          field: "contributions",
          message:
            "Todas as contribuições são zero: a incerteza combinada seria zero.",
        },
      ],
    };
  }

  const effectiveDegreesOfFreedom = welchSatterthwaiteDegreesOfFreedom(
    combinedVariance,
    variances,
    evaluated.map(({ evaluation }) => evaluation.degreesOfFreedom),
  );
  const factor = coverageFactorForProbability(
    coverageProbability,
    effectiveDegreesOfFreedom,
  );

  const results: ContributionResult[] = evaluated.map(
    ({ input, evaluation, sensitivity }, index) => {
      const variance = variances[index] ?? 0;
      return {
        id: input.id,
        label: input.label,
        kind: input.kind,
        standardUncertainty: evaluation.standardUncertainty,
        divisor: evaluation.divisor,
        divisorLabel:
          input.kind === "typeA" ? "√n" : divisorLabelFor(input.distribution),
        sensitivity,
        contribution: Math.abs(sensitivity) * evaluation.standardUncertainty,
        variance,
        degreesOfFreedom: evaluation.degreesOfFreedom,
        indexPercent: (variance / combinedVariance) * 100,
        typeA: evaluation.typeA,
      };
    },
  );

  const dominant = results.reduce<ContributionResult | null>(
    (largest, item) =>
      largest === null || item.variance > largest.variance ? item : largest,
    null,
  );

  return {
    ok: true,
    result: {
      contributions: results,
      combinedStandardUncertainty,
      effectiveDegreesOfFreedom,
      coverageFactor: factor,
      expandedUncertainty: factor * combinedStandardUncertainty,
      coverageProbability,
      dominant,
    },
  };
}
