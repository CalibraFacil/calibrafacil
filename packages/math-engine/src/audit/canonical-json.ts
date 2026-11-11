import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { canonicalRoundTripNumber } from "../numeric/backend.js";

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
      throw makeError(
        ERROR_CODES.NON_FINITE_NUMBER,
        "Canonical JSON cannot serialize non-finite numbers.",
        {
          value: String(value),
        },
      );
    }
    return canonicalRoundTripNumber(value);
  }

  if (Array.isArray(value)) {
    // `map` skips the holes of a sparse array and `join` writes nothing for
    // them: "[,1]" is not JSON, and not what any reader would rebuild.
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        throw makeError(
          ERROR_CODES.INVALID_INPUT,
          "Canonical JSON cannot serialize a sparse array.",
          { index },
        );
      }
    }
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    // A Map, a Set, a Date or a boxed primitive has no own enumerable keys: it
    // would be written as "{}" and fingerprint like an empty record (review).
    // The tag is read through Object.prototype so that a record from another
    // realm, or one with no prototype, still passes.
    const tag = Object.prototype.toString.call(value);
    if (tag !== "[object Object]") {
      throw makeError(
        ERROR_CODES.INVALID_INPUT,
        "Value cannot be represented as canonical JSON.",
        { valueType: tag.slice(8, -1) },
      );
    }
    const record = value as {
      readonly [key: string]: CanonicalJsonValue | undefined;
    };
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] as CanonicalJsonValue)}`).join(",")}}`;
  }

  throw makeError(
    ERROR_CODES.INVALID_INPUT,
    "Value cannot be represented as canonical JSON.",
    { valueType: typeof value },
  );
}

export function canonicalClone<T extends CanonicalJsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
