import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import type { CalculationErrorCode } from "../errors/codes.js";

const DANGEROUS_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__"
]);

export function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertPlainRecord(
  value: unknown,
  path: string,
  code: CalculationErrorCode = ERROR_CODES.INVALID_INPUT_SHAPE,
  message = "Input field must be a plain object."
): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw makeError(code, message, { path, valueType: valueKind(value) });
  }
  assertNoAccessorProperties(value, path, code);
  return value;
}

export function assertNoAccessorProperties(
  record: Record<string, unknown>,
  path: string,
  code: CalculationErrorCode = ERROR_CODES.INVALID_INPUT_SHAPE
): void {
  const descriptors = Object.getOwnPropertyDescriptors(record);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if ("get" in descriptor || "set" in descriptor) {
      throw makeError(code, "Accessor properties are not accepted in input objects.", {
        path: path.length === 0 ? key : `${path}.${key}`,
        key,
        suggestedRemediation: "Pass plain JSON-like data properties instead of getters or setters."
      });
    }
  }
}

export function assertDenseArray<T>(
  value: readonly T[],
  path: string,
  code: CalculationErrorCode = ERROR_CODES.INVALID_INPUT_SHAPE
): readonly T[] {
  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${path}[${index}]`;
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw makeError(code, "Sparse arrays are not accepted.", {
        path: entryPath,
        index,
        suggestedRemediation: "Pass dense JSON-like arrays without holes."
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || "get" in descriptor || "set" in descriptor) {
      throw makeError(code, "Accessor array entries are not accepted.", {
        path: entryPath,
        index,
        suggestedRemediation: "Pass dense JSON-like arrays with plain data entries."
      });
    }
  }
  return value;
}

export function assertNoDangerousKeys(
  record: Record<string, unknown>,
  path: string,
  code: CalculationErrorCode = ERROR_CODES.INVALID_INPUT_SHAPE
): void {
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw makeError(code, "Object contains a reserved or unsafe key.", {
        path: path.length === 0 ? key : `${path}.${key}`,
        key,
        suggestedRemediation: "Use simple data keys that cannot affect prototypes or built-in object behavior."
      });
    }
  }
}

export function assertAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
  code: CalculationErrorCode = ERROR_CODES.UNSUPPORTED_INPUT_FIELD
): void {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw makeError(code, "Object contains an unsupported field.", {
        path: path.length === 0 ? key : `${path}.${key}`,
        field: key,
        allowedFields: [...allowedKeys].sort()
      });
    }
  }
}

export function assertString(value: unknown, path: string, code: CalculationErrorCode = ERROR_CODES.INVALID_INPUT_SHAPE): string {
  if (typeof value !== "string") {
    throw makeError(code, "Input field must be a string.", { path, valueType: valueKind(value) });
  }
  return value;
}

export function assertBoolean(value: unknown, path: string, code: CalculationErrorCode = ERROR_CODES.INVALID_INPUT_SHAPE): boolean {
  if (typeof value !== "boolean") {
    throw makeError(code, "Input field must be a boolean.", { path, valueType: valueKind(value) });
  }
  return value;
}

export function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}

export function deepFreezeJsonLike<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeJsonLike(item);
    return Object.freeze(value);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) deepFreezeJsonLike(record[key]);
  return Object.freeze(value);
}
