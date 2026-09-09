import type { CanonicalJsonValue } from "../audit/canonical-json.js";
import { canonicalJson } from "../audit/canonical-json.js";
import { fingerprintCanonical, fingerprintText } from "../audit/fingerprint.js";
import { evaluateAst } from "../evaluator/evaluate.js";
import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import {
  canonicalRoundTripNumber,
  DecimalBackend,
  NumberBackend,
} from "../numeric/backend.js";
import type {
  NumericBackend,
  NumericInput,
  NumericOutput,
} from "../numeric/types.js";
import type { FormulaAstNode } from "../parser/ast.js";
import { assertSafeIdentifierRecord } from "../parser/identifiers.js";
import { parseFormula } from "../parser/parser.js";
import type { AstValidationResult } from "../parser/validate.js";
import { validateAst } from "../parser/validate.js";
import type { NormalizedCalculationEngineOptions } from "../engine/options.js";
import {
  astToCanonicalValue,
  formatNormalizedFormula,
  normalizeAst,
} from "./normalize.js";
import type { CalculationDiagnostic } from "./diagnostics.js";
import {
  assertAllowedKeys,
  assertBoolean,
  assertDenseArray,
  assertNoDangerousKeys,
  assertPlainRecord,
  hasOwn,
  valueKind,
} from "../validation/shape.js";

const COMPILED_FORMULA_COMPATIBILITY_MARKER =
  "@calibra-facil/math-engine/CompiledFormula/2026-05";

const COMPILED_FORMULA_CONSTRUCTOR_TOKEN = Symbol(
  "CompiledFormulaConstructorToken",
);
const COMPILED_FORMULA_INSTANCES = new WeakSet<object>();
const COMPILE_OPTION_KEYS = new Set(["allowedVariables"]);
const EVALUATION_OPTION_KEYS = new Set(["rejectUnusedInputs"]);

export interface CompileFormulaOptions {
  readonly allowedVariables?: readonly string[];
}

export interface FormulaEvaluationOptions {
  readonly rejectUnusedInputs?: boolean;
}

export interface FormulaEvaluationResult {
  readonly value: NumericOutput;
  readonly valueText: string;
  readonly diagnostics: readonly CalculationDiagnostic[];
  readonly variables: readonly string[];
  readonly normalizedFormula: string;
  readonly normalizedAst: string;
  readonly formulaFingerprint: string;
  readonly calculationFingerprint: string;
}

export interface CompiledFormulaMetadata {
  readonly formulaText: string;
  readonly normalizedFormula: string;
  readonly normalizedAst: string;
  readonly formulaFingerprint: string;
  readonly astFingerprint: string;
  readonly optionsFingerprint: string;
  readonly compatibilityMarker: string;
  readonly engineVersion: string;
  readonly numericMode: string;
  readonly decimalPrecision: number;
  readonly maxExponentMagnitude: number;
  readonly maxNumericInputLength: number;
  readonly maxSignificantDigits: number;
  readonly variables: readonly string[];
  readonly nodeCount: number;
  readonly astDepth: number;
}

function decimalParseOptions(options: NormalizedCalculationEngineOptions) {
  return {
    maxExponentMagnitude: options.maxExponentMagnitude,
    maxInputLength: options.maxNumberLiteralLength,
    // Significant-digit policy for formula literals is maxSignificantDigits, not
    // the literal-length limit (audit: copy-paste binding bug).
    maxSignificantDigits: options.maxSignificantDigits,
  };
}

function compilationOptionsCanonical(
  options: NormalizedCalculationEngineOptions,
): CanonicalJsonValue {
  return {
    compatibilityMarker: COMPILED_FORMULA_COMPATIBILITY_MARKER,
    engineVersion: options.engineVersion,
    numericMode: options.numericMode,
    angleMode: options.angleMode,
    decimalPrecision: options.decimalPrecision,
    maxExpressionLength: options.maxExpressionLength,
    maxAstDepth: options.maxAstDepth,
    maxAstNodes: options.maxAstNodes,
    maxIdentifierLength: options.maxIdentifierLength,
    maxNumberLiteralLength: options.maxNumberLiteralLength,
    maxExponentMagnitude: options.maxExponentMagnitude,
    maxNumericInputLength: options.maxNumericInputLength,
    maxSignificantDigits: options.maxSignificantDigits,
  };
}

export function compiledFormulaOptionsFingerprint(
  options: NormalizedCalculationEngineOptions,
): string {
  return fingerprintCanonical(compilationOptionsCanonical(options));
}

function assertFormulaExpression(expression: unknown): string {
  if (typeof expression !== "string") {
    throw makeError(
      ERROR_CODES.INVALID_INPUT_SHAPE,
      "Formula expression must be a string.",
      {
        path: "formula",
        valueType: expression === null ? "null" : typeof expression,
      },
    );
  }
  return expression;
}

function assertCompileFormulaOptions(value: unknown): CompileFormulaOptions {
  if (value === undefined) return {};
  const record = assertPlainRecord(
    value,
    "compileOptions",
    ERROR_CODES.INVALID_INPUT_SHAPE,
    "Formula compile options must be a plain object.",
  );
  assertNoDangerousKeys(
    record,
    "compileOptions",
    ERROR_CODES.INVALID_INPUT_SHAPE,
  );
  assertAllowedKeys(record, COMPILE_OPTION_KEYS, "compileOptions");
  if (hasOwn(record, "allowedVariables")) {
    const allowedVariables = record.allowedVariables;
    if (!Array.isArray(allowedVariables)) {
      throw makeError(
        ERROR_CODES.INVALID_INPUT_SHAPE,
        "compileOptions.allowedVariables must be an array of strings.",
        {
          path: "compileOptions.allowedVariables",
          valueType: valueKind(allowedVariables),
        },
      );
    }
    assertDenseArray(
      allowedVariables,
      "compileOptions.allowedVariables",
      ERROR_CODES.INVALID_INPUT_SHAPE,
    );
    for (let index = 0; index < allowedVariables.length; index += 1) {
      if (typeof allowedVariables[index] !== "string") {
        throw makeError(
          ERROR_CODES.INVALID_INPUT_SHAPE,
          "compileOptions.allowedVariables entries must be strings.",
          {
            path: `compileOptions.allowedVariables[${index}]`,
            valueType: valueKind(allowedVariables[index]),
          },
        );
      }
    }
  }
  return record as unknown as CompileFormulaOptions;
}

function assertFormulaEvaluationOptions(
  value: unknown,
): FormulaEvaluationOptions {
  if (value === undefined) return {};
  const record = assertPlainRecord(
    value,
    "evaluationOptions",
    ERROR_CODES.INVALID_INPUT_SHAPE,
    "Formula evaluation options must be a plain object.",
  );
  assertNoDangerousKeys(
    record,
    "evaluationOptions",
    ERROR_CODES.INVALID_INPUT_SHAPE,
  );
  assertAllowedKeys(record, EVALUATION_OPTION_KEYS, "evaluationOptions");
  if (hasOwn(record, "rejectUnusedInputs"))
    assertBoolean(
      record.rejectUnusedInputs,
      "evaluationOptions.rejectUnusedInputs",
      ERROR_CODES.INVALID_INPUT_SHAPE,
    );
  return record as unknown as FormulaEvaluationOptions;
}

function deepFreezeAst(node: FormulaAstNode): FormulaAstNode {
  switch (node.kind) {
    case "UnaryExpression":
      deepFreezeAst(node.argument);
      break;
    case "BinaryExpression":
      deepFreezeAst(node.left);
      deepFreezeAst(node.right);
      break;
    case "CallExpression":
      for (const arg of node.args) deepFreezeAst(arg);
      Object.freeze(node.args);
      break;
    case "NumberLiteral":
    case "Variable":
      break;
  }
  return Object.freeze(node);
}

function assertRecognizedCompiledFormulaInstance(
  instance: CompiledFormula,
): void {
  if (
    Object.getPrototypeOf(instance) !== CompiledFormula.prototype ||
    !COMPILED_FORMULA_INSTANCES.has(instance)
  ) {
    throw makeError(
      ERROR_CODES.INCOMPATIBLE_COMPILED_FORMULA,
      "CompiledFormula instance is not recognized by this engine runtime.",
      {
        suggestedRemediation:
          "Use a CompiledFormula returned by createCalculationEngine().compileFormula or pass formula text.",
      },
    );
  }
}

export function isCompiledFormula(value: unknown): value is CompiledFormula {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === CompiledFormula.prototype &&
    COMPILED_FORMULA_INSTANCES.has(value)
  );
}

export class CompiledFormula {
  readonly ast: FormulaAstNode;
  readonly formulaText: string;
  readonly normalizedFormula: string;
  readonly normalizedAst: string;
  readonly formulaFingerprint: string;
  readonly astFingerprint: string;
  readonly optionsFingerprint: string;
  readonly compatibilityMarker = COMPILED_FORMULA_COMPATIBILITY_MARKER;
  readonly variables: readonly string[];
  readonly nodeCount: number;
  readonly astDepth: number;

  private readonly options: NormalizedCalculationEngineOptions;

  constructor(
    expression: string,
    ast: FormulaAstNode,
    validation: AstValidationResult,
    options: NormalizedCalculationEngineOptions,
    token: symbol,
  ) {
    if (token !== COMPILED_FORMULA_CONSTRUCTOR_TOKEN) {
      throw makeError(
        ERROR_CODES.INVALID_INPUT_SHAPE,
        "CompiledFormula instances must be created with createCalculationEngine().compileFormula().",
        {
          suggestedRemediation:
            "Use createCalculationEngine().compileFormula() or pass formula text to an engine method.",
        },
      );
    }
    const literalOptions = decimalParseOptions(options);
    this.formulaText = expression;
    this.ast = deepFreezeAst(ast);
    this.normalizedFormula = formatNormalizedFormula(this.ast, literalOptions);
    this.normalizedAst = normalizeAst(this.ast, literalOptions);
    this.astFingerprint = fingerprintText(this.normalizedAst, "ast-sha256");
    this.optionsFingerprint = compiledFormulaOptionsFingerprint(options);
    this.formulaFingerprint = fingerprintCanonical({
      kind: "formula",
      raw: expression,
      normalizedAst: astToCanonicalValue(this.ast, literalOptions),
      astFingerprint: this.astFingerprint,
      optionsFingerprint: this.optionsFingerprint,
      compatibilityMarker: COMPILED_FORMULA_COMPATIBILITY_MARKER,
      engineVersion: options.engineVersion,
    });
    this.variables = Object.freeze([...validation.variables]);
    this.nodeCount = validation.nodeCount;
    this.astDepth = validation.depth;
    this.options = options;
    COMPILED_FORMULA_INSTANCES.add(this);
    Object.freeze(this);
  }

  private assertAuditIntegrity(): void {
    assertRecognizedCompiledFormulaInstance(this);
    const literalOptions = decimalParseOptions(this.options);
    const currentNormalizedAst = normalizeAst(this.ast, literalOptions);
    const currentAstFingerprint = fingerprintText(
      currentNormalizedAst,
      "ast-sha256",
    );
    const currentNormalizedFormula = formatNormalizedFormula(
      this.ast,
      literalOptions,
    );
    if (
      currentNormalizedAst !== this.normalizedAst ||
      currentAstFingerprint !== this.astFingerprint ||
      currentNormalizedFormula !== this.normalizedFormula
    ) {
      throw makeError(
        ERROR_CODES.INCOMPATIBLE_COMPILED_FORMULA,
        "CompiledFormula audit metadata no longer matches the AST that would be evaluated.",
        {
          formulaFingerprint: this.formulaFingerprint,
          storedAstFingerprint: this.astFingerprint,
          currentAstFingerprint,
          suggestedRemediation:
            "Discard the mutated object and compile the formula text again.",
        },
      );
    }
  }

  assertCompatibleWithOptions(
    options: NormalizedCalculationEngineOptions,
  ): void {
    this.assertAuditIntegrity();
    const expected = compiledFormulaOptionsFingerprint(options);
    if (
      this.compatibilityMarker !== COMPILED_FORMULA_COMPATIBILITY_MARKER ||
      this.optionsFingerprint !== expected
    ) {
      throw makeError(
        ERROR_CODES.INCOMPATIBLE_COMPILED_FORMULA,
        "CompiledFormula was created with engine options that are incompatible with the current engine.",
        {
          formulaFingerprint: this.formulaFingerprint,
          compiledOptionsFingerprint: this.optionsFingerprint,
          expectedOptionsFingerprint: expected,
          compiledNumericMode: this.options.numericMode,
          currentNumericMode: options.numericMode,
          compiledEngineVersion: this.options.engineVersion,
          currentEngineVersion: options.engineVersion,
          suggestedRemediation:
            "Compile the formula with the same engine/options that will evaluate it, or pass the formula text instead.",
        },
      );
    }
  }

  evaluate(
    inputs: Readonly<Record<string, NumericInput>>,
    evaluationOptions: FormulaEvaluationOptions = {},
  ): FormulaEvaluationResult {
    this.assertAuditIntegrity();
    const safeEvaluationOptions =
      assertFormulaEvaluationOptions(evaluationOptions);
    if (this.options.numericMode === "number") {
      return this.evaluateWithBackend(
        inputs,
        safeEvaluationOptions,
        new NumberBackend(
          this.options.decimalPrecision,
          this.options.maxExponentMagnitude,
          this.options.maxNumericInputLength,
          this.options.maxSignificantDigits,
        ),
      );
    }
    return this.evaluateWithBackend(
      inputs,
      safeEvaluationOptions,
      new DecimalBackend(
        this.options.decimalPrecision,
        this.options.maxExponentMagnitude,
        this.options.maxNumericInputLength,
        this.options.maxSignificantDigits,
      ),
    );
  }

  private evaluateWithBackend<T>(
    inputs: Readonly<Record<string, NumericInput>>,
    evaluationOptions: FormulaEvaluationOptions,
    backend: NumericBackend<T>,
  ): FormulaEvaluationResult {
    const inputRecord = assertPlainRecord(
      inputs,
      "inputs",
      ERROR_CODES.INVALID_FORMULA_INPUTS,
      "Formula inputs must be a plain object.",
    ) as Record<string, NumericInput>;
    assertNoDangerousKeys(
      inputRecord,
      "inputs",
      ERROR_CODES.INVALID_FORMULA_INPUTS,
    );
    assertSafeIdentifierRecord(inputRecord, this.options.maxIdentifierLength);
    const rejectUnusedInputs =
      evaluationOptions.rejectUnusedInputs ?? this.options.rejectUnusedInputs;
    const variableSet = new Set(this.variables);
    const scope: Record<string, T> = Object.create(null) as Record<string, T>;

    for (const variable of this.variables) {
      if (!Object.prototype.hasOwnProperty.call(inputRecord, variable)) {
        throw makeError(
          ERROR_CODES.MISSING_INPUT,
          "Formula input is missing a required variable.",
          { identifier: variable, variable, path: `inputs.${variable}` },
        );
      }
      scope[variable] = backend.fromInput(
        inputRecord[variable] as NumericInput,
        variable,
      );
    }

    if (rejectUnusedInputs) {
      for (const key of Object.keys(inputRecord)) {
        if (!variableSet.has(key)) {
          throw makeError(
            ERROR_CODES.UNKNOWN_IDENTIFIER,
            "Evaluation input contains a variable not used by the formula.",
            {
              identifier: key,
              variable: key,
              path: `inputs.${key}`,
            },
          );
        }
      }
    }

    const rawValue = evaluateAst(this.ast, scope, backend);
    const value = backend.toOutput(rawValue);
    const valueText = backend.toCanonicalString(rawValue);
    if (!Number.isFinite(Number(valueText))) {
      throw makeError(
        ERROR_CODES.NON_FINITE_RESULT,
        "Formula evaluation produced a non-finite result.",
        { value: valueText },
      );
    }
    const auditText = (numericValue: T): string =>
      backend.mode === "number"
        ? canonicalRoundTripNumber(backend.toNumber(numericValue))
        : backend.toCanonicalString(numericValue);
    const canonicalInputs: Record<string, CanonicalJsonValue> = Object.create(
      null,
    ) as Record<string, CanonicalJsonValue>;
    for (const variable of [...this.variables].sort()) {
      canonicalInputs[variable] = auditText(scope[variable] as T);
    }
    const calculationFingerprint = fingerprintText(
      canonicalJson({
        kind: "formulaEvaluation",
        formulaFingerprint: this.formulaFingerprint,
        inputs: canonicalInputs,
        options: {
          numericMode: this.options.numericMode,
          angleMode: this.options.angleMode,
          decimalPrecision: this.options.decimalPrecision,
          maxExponentMagnitude: this.options.maxExponentMagnitude,
          maxNumericInputLength: this.options.maxNumericInputLength,
          maxSignificantDigits: this.options.maxSignificantDigits,
          optionsFingerprint: this.optionsFingerprint,
          engineVersion: this.options.engineVersion,
        },
        value: auditText(rawValue),
      }),
    );

    return Object.freeze({
      value,
      valueText,
      diagnostics: Object.freeze([]),
      variables: this.variables,
      normalizedFormula: this.normalizedFormula,
      normalizedAst: this.normalizedAst,
      formulaFingerprint: this.formulaFingerprint,
      calculationFingerprint,
    });
  }

  metadata(): CompiledFormulaMetadata {
    return {
      formulaText: this.formulaText,
      normalizedFormula: this.normalizedFormula,
      normalizedAst: this.normalizedAst,
      formulaFingerprint: this.formulaFingerprint,
      astFingerprint: this.astFingerprint,
      optionsFingerprint: this.optionsFingerprint,
      compatibilityMarker: this.compatibilityMarker,
      engineVersion: this.options.engineVersion,
      numericMode: this.options.numericMode,
      decimalPrecision: this.options.decimalPrecision,
      maxExponentMagnitude: this.options.maxExponentMagnitude,
      maxNumericInputLength: this.options.maxNumericInputLength,
      maxSignificantDigits: this.options.maxSignificantDigits,
      variables: this.variables,
      nodeCount: this.nodeCount,
      astDepth: this.astDepth,
    };
  }
}

Object.freeze(CompiledFormula.prototype);
Object.freeze(CompiledFormula);

export function compileFormulaInternal(
  expression: unknown,
  options: NormalizedCalculationEngineOptions,
  compileOptions: unknown = {},
): CompiledFormula {
  const formulaText = assertFormulaExpression(expression);
  const safeCompileOptions = assertCompileFormulaOptions(compileOptions);
  const allowedVariables =
    safeCompileOptions.allowedVariables === undefined
      ? undefined
      : new Set(safeCompileOptions.allowedVariables);
  if (allowedVariables !== undefined) {
    for (const identifier of allowedVariables) {
      // Re-use a record validation path to keep prototype-pollution restrictions identical.
      assertSafeIdentifierRecord(
        { [identifier]: true },
        options.maxIdentifierLength,
      );
    }
  }
  const ast = parseFormula(formulaText, options);
  const validation =
    allowedVariables === undefined
      ? validateAst(ast, options)
      : validateAst(ast, options, { allowedVariables });
  return new CompiledFormula(
    formulaText,
    ast,
    validation,
    options,
    COMPILED_FORMULA_CONSTRUCTOR_TOKEN,
  );
}
