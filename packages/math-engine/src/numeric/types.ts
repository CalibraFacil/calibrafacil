export type NumericMode = "number" | "decimal";
export type NumericInput = number | string;
export type NumericOutput = number | string;

export interface NumericOptions {
  readonly mode: NumericMode;
  readonly decimalPrecision: number;
  readonly maxExponentMagnitude: number;
  readonly maxNumericInputLength?: number;
  readonly maxSignificantDigits?: number;
}

export interface NumericBackend<T> {
  readonly mode: NumericMode;
  readonly decimalPrecision: number;
  readonly maxExponentMagnitude: number;
  readonly maxNumericInputLength: number;
  readonly maxSignificantDigits: number;
  zero(): T;
  one(): T;
  fromInput(value: NumericInput, label?: string): T;
  fromNumberLiteral(literal: string): T;
  fromNumber(value: number, label?: string): T;
  toNumber(value: T): number;
  toOutput(value: T): NumericOutput;
  toCanonicalString(value: T): string;
  isZero(value: T): boolean;
  abs(value: T): T;
  neg(value: T): T;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  div(a: T, b: T): T;
  pow(a: T, b: T): T;
  sqrt(a: T): T;
  sin(a: T): T;
  cos(a: T): T;
  tan(a: T): T;
  asin(a: T): T;
  acos(a: T): T;
  atan(a: T): T;
  log(a: T): T;
  log10(a: T): T;
  exp(a: T): T;
  min(values: readonly T[]): T;
  max(values: readonly T[]): T;
  floor(a: T): T;
  ceil(a: T): T;
  round(a: T): T;
}
