import type { CalculationErrorCode } from "./codes.js";

export interface CalculationErrorDetails {
  readonly [key: string]: unknown;
}

export interface StructuredCalculationError {
  readonly code: CalculationErrorCode;
  readonly message: string;
  readonly details?: CalculationErrorDetails;
  readonly path?: string;
  readonly formula?: string;
  readonly variable?: string;
  readonly suggestedRemediation?: string;
}

export class CalculationEngineError extends Error implements StructuredCalculationError {
  readonly code: CalculationErrorCode;
  readonly details?: CalculationErrorDetails;
  readonly path?: string;
  readonly formula?: string;
  readonly variable?: string;
  readonly suggestedRemediation?: string;

  constructor(code: CalculationErrorCode, message: string, details?: CalculationErrorDetails) {
    super(message);
    this.name = "CalculationEngineError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
      if (typeof details.path === "string") this.path = details.path;
      if (typeof details.formula === "string") this.formula = details.formula;
      if (typeof details.variable === "string") this.variable = details.variable;
      if (typeof details.suggestedRemediation === "string") this.suggestedRemediation = details.suggestedRemediation;
    }
  }

  toJSON(): StructuredCalculationError {
    const base: StructuredCalculationError = {
      code: this.code,
      message: this.message,
      ...(this.path === undefined ? {} : { path: this.path }),
      ...(this.formula === undefined ? {} : { formula: this.formula }),
      ...(this.variable === undefined ? {} : { variable: this.variable }),
      ...(this.suggestedRemediation === undefined ? {} : { suggestedRemediation: this.suggestedRemediation })
    };
    return this.details === undefined ? base : { ...base, details: this.details };
  }
}

export function makeError(
  code: CalculationErrorCode,
  message: string,
  details?: CalculationErrorDetails
): CalculationEngineError {
  return new CalculationEngineError(code, message, details);
}

export function isCalculationEngineError(value: unknown): value is CalculationEngineError {
  return value instanceof CalculationEngineError;
}
