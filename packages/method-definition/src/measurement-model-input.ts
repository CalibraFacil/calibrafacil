import { errorDiagnostic } from "./diagnostics";
import type {
  CalculationEngineLike,
  InputQuantityLike,
  MeasurementModelInputLike,
  MethodDiagnostic,
  MethodInput,
  MethodMeasurementModel,
  MethodQuantity,
  NumericInput,
  QuantitySource,
} from "./types";

export function buildMeasurementModelInput(
  model: MethodMeasurementModel,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  options: { engine?: CalculationEngineLike } = {},
): MeasurementModelInputLike {
  const quantities: Record<string, InputQuantityLike> = {};
  for (const quantity of model.quantities) {
    quantities[quantity.symbol] = buildInputQuantity(
      quantity,
      context,
      options,
    );
  }
  return pruneMeasurementModelInput({
    formula: model.expression,
    quantities,
    correlations: model.correlations?.map((item) => [
      item.symbols[0],
      item.symbols[1],
      item.coefficient,
    ]),
    covariances: model.covariances?.map((item) => [
      item.symbols[0],
      item.symbols[1],
      item.covariance,
    ]),
    coverageProbability: model.coverageProbability,
    coverageFactor: resolveOptionalNumericExpression(
      model.coverageFactor,
      context,
      options.engine,
    ),
    allowNonSmoothWithExplicitSensitivities:
      model.options?.allowNonSmoothWithExplicitSensitivities,
    correlatedDegreesOfFreedom: model.options?.correlatedDegreesOfFreedom,
  });
}

// The engine validates its input shape strictly: an own key holding the value
// undefined is rejected as an invalid input shape (e.g. "Input field must be
// a boolean/string"), so absent optional fields must be omitted entirely.
// The fake engines used elsewhere in the tests never enforced this, which let
// undefined-valued keys ship — the real-engine golden test pins it now.
function pruneMeasurementModelInput(
  input: MeasurementModelInputLike,
): MeasurementModelInputLike {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- pruning only removes undefined-valued keys, which the optional fields of the input type already allow to be absent.
  return pruneUndefinedFieldsDeep(input) as MeasurementModelInputLike;
}

function pruneUndefinedFieldsDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(pruneUndefinedFieldsDeep);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      result[key] = pruneUndefinedFieldsDeep(entry);
    }
  }

  return result;
}

function buildInputQuantity(
  quantity: MethodQuantity,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  options: { engine?: CalculationEngineLike },
): InputQuantityLike {
  const base: InputQuantityLike = {
    unit: quantity.unit,
    degreesOfFreedom: resolveOptionalNumericExpression(
      quantity.degreesOfFreedom,
      context,
      options.engine,
    ),
    sensitivityCoefficient: resolveOptionalNumericExpression(
      quantity.sensitivity,
      context,
      options.engine,
    ),
    metadata: quantity.metadata,
  };

  const estimate = resolveQuantityEstimate(quantity, context, options.engine);

  if (quantity.uncertainty.kind === "type_a") {
    const observations = resolveTypeAObservations(
      quantity,
      context,
      options.engine,
    );
    return {
      ...base,
      estimate,
      repeatedObservations: observations,
      degreesOfFreedom: resolveOptionalNumericExpression(
        quantity.degreesOfFreedom ??
          quantity.uncertainty.minDegreesOfFreedom ??
          undefined,
        context,
        options.engine,
      ),
    };
  }

  if (quantity.uncertainty.kind === "type_b") {
    const source = quantity.uncertainty;
    const distribution =
      source.distribution === "u_shaped" ? "u-shaped" : source.distribution;
    const standardUncertainty = resolveOptionalNumericExpression(
      source.standardUncertainty,
      context,
      options.engine,
    );
    const halfWidth = resolveOptionalNumericExpression(
      source.halfWidth,
      context,
      options.engine,
    );
    const lowerLimit = resolveOptionalNumericExpression(
      source.limits?.lower,
      context,
      options.engine,
    );
    const upperLimit = resolveOptionalNumericExpression(
      source.limits?.upper,
      context,
      options.engine,
    );
    const expandedUncertainty = resolveOptionalNumericExpression(
      source.expandedUncertainty,
      context,
      options.engine,
    );
    const coverageFactor = resolveOptionalNumericExpression(
      source.coverageFactor,
      context,
      options.engine,
    );
    // The Type-B specification must appear exactly once: the engine rejects a
    // quantity that carries source fields both at the top level and inside
    // the typeB record (INVALID_TYPE_B_CONFIGURATION).
    return {
      ...base,
      estimate,
      typeB: {
        distribution,
        standardUncertainty,
        halfWidth,
        lowerLimit,
        upperLimit,
        expandedUncertainty,
        coverageFactor,
        divisor: resolveOptionalNumericExpression(
          source.divisor,
          context,
          options.engine,
        ),
      },
      degreesOfFreedom: resolveOptionalNumericExpression(
        quantity.degreesOfFreedom ?? source.degreesOfFreedom ?? undefined,
        context,
        options.engine,
      ),
    };
  }

  return {
    ...base,
    estimate,
    standardUncertainty: resolveNumericExpression(
      quantity.uncertainty.standardUncertainty,
      context,
      options.engine,
    ),
    degreesOfFreedom: resolveOptionalNumericExpression(
      quantity.degreesOfFreedom ?? quantity.uncertainty.degreesOfFreedom,
      context,
      options.engine,
    ),
  };
}

function resolveQuantityEstimate(
  quantity: MethodQuantity,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine?: CalculationEngineLike,
): NumericInput {
  const value = resolveQuantitySource(quantity.source, context, engine);
  if (value === "Infinity") {
    throw new Error(`Quantity ${quantity.symbol} estimate must be finite`);
  }
  return value;
}

function resolveTypeAObservations(
  quantity: MethodQuantity,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine?: CalculationEngineLike,
): NumericInput[] {
  if (quantity.uncertainty.kind !== "type_a") return [];
  if (quantity.uncertainty.observations?.length) {
    return quantity.uncertainty.observations.map((source) => {
      const value = resolveQuantitySource(source, context, engine);
      if (value === "Infinity") {
        throw new Error(
          `Type A quantity ${quantity.symbol} observations must be finite`,
        );
      }
      return value;
    });
  }

  const observationsInputKey = quantity.uncertainty.observationsInputKey;
  const observations = observationsInputKey
    ? context[observationsInputKey]
    : undefined;
  if (!Array.isArray(observations)) {
    throw new Error(
      `Type A quantity ${quantity.symbol} requires repeated observations`,
    );
  }
  return observations;
}

function resolveQuantitySource(
  source: QuantitySource,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine?: CalculationEngineLike,
): NumericInput | "Infinity" {
  if (source.kind === "constant") {
    return resolveNumericExpression(source.value, context, engine);
  }
  const key = source.kind === "table_column" ? source.columnKey : source.key;
  const value = context[key];
  if (Array.isArray(value)) {
    throw new Error(`Quantity source ${key} must be scalar`);
  }
  if (value === undefined) {
    throw new Error(`Quantity source ${key} is missing`);
  }
  if (typeof value === "string" || typeof value === "number") return value;
  throw new Error(`Quantity source ${key} must be scalar`);
}

function resolveOptionalNumericExpression(
  value: string | number | undefined,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine?: CalculationEngineLike,
): NumericInput | "Infinity" | undefined {
  return value === undefined
    ? undefined
    : resolveNumericExpression(value, context, engine);
}

function resolveNumericExpression(
  value: string | number,
  context: Record<string, NumericInput | readonly NumericInput[]>,
  engine?: CalculationEngineLike,
): NumericInput | "Infinity" {
  if (typeof value === "number") return value;
  if (value === "Infinity") return value;
  if (Number.isFinite(Number(value))) return value;

  const directValue = context[value];
  if (typeof directValue === "string" || typeof directValue === "number") {
    return directValue;
  }
  if (!engine) return value;

  const allowedVariables = Object.entries(context)
    .filter(([, item]) => !Array.isArray(item))
    .map(([key]) => key)
    .sort();
  const compiled = engine.compileFormula(value, { allowedVariables });
  const inputs: Record<string, NumericInput> = {};
  for (const variable of compiled.variables) {
    const input = context[variable];
    if (typeof input === "string" || typeof input === "number") {
      inputs[variable] = input;
      continue;
    }
    throw new Error(
      `Expression ${value} references missing scalar ${variable}`,
    );
  }
  return engine.evaluateFormula(compiled, inputs).value;
}

export function calculationErrorDiagnostic(
  error: unknown,
  code: string,
  fallbackMessage: string,
  path: string,
): MethodDiagnostic {
  if (isCalculationEngineErrorLike(error)) {
    return errorDiagnostic(
      code,
      error.message,
      typeof error.details?.path === "string" ? error.details.path : path,
      {
        engineCode: error.code,
      },
    );
  }
  return errorDiagnostic(
    code,
    error instanceof Error ? error.message : fallbackMessage,
    path,
  );
}

function isCalculationEngineErrorLike(error: unknown): error is {
  code: string;
  message: string;
  details?: { path?: unknown };
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}

export function inputIsNumeric(input: MethodInput): boolean {
  return input.kind === "scalar";
}
