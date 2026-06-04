import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { canonicalNumber } from "../numeric/backend.js";

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue | undefined };

export function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null) return "null";

  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw makeError(ERROR_CODES.NON_FINITE_NUMBER, "Canonical JSON cannot serialize non-finite numbers.", {
        value: String(value)
      });
    }
    return canonicalNumber(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as { readonly [key: string]: CanonicalJsonValue | undefined };
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] as CanonicalJsonValue)}`).join(",")}}`;
  }

  throw makeError(ERROR_CODES.INVALID_INPUT, "Value cannot be represented as canonical JSON.", { valueType: typeof value });
}

export function canonicalClone<T extends CanonicalJsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
