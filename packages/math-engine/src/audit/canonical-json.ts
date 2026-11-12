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
  // Written into one list of parts and joined once: building each level's text
  // from its children's made a deep tree quadratic (a sum of 3000 terms took
  // 350 ms to normalize; review).
  const parts: string[] = [];
  writeCanonicalJson(value, parts);
  return parts.join("");
}

function writeCanonicalJson(value: CanonicalJsonValue, parts: string[]): void {
  if (value === null) {
    parts.push("null");
    return;
  }
  if (typeof value === "boolean") {
    parts.push(value ? "true" : "false");
    return;
  }
  if (typeof value === "string") {
    parts.push(JSON.stringify(value));
    return;
  }
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
    parts.push(canonicalRoundTripNumber(value));
    return;
  }

  if (Array.isArray(value)) {
    // A sparse array has no value to write for its holes: "[,1]" is not JSON,
    // and not what any reader would rebuild.
    parts.push("[");
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        throw makeError(
          ERROR_CODES.INVALID_INPUT,
          "Canonical JSON cannot serialize a sparse array.",
          { index },
        );
      }
      if (index > 0) parts.push(",");
      writeCanonicalJson(value[index] as CanonicalJsonValue, parts);
    }
    parts.push("]");
    return;
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
    parts.push("{");
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index] as string;
      if (index > 0) parts.push(",");
      parts.push(JSON.stringify(key), ":");
      writeCanonicalJson(record[key] as CanonicalJsonValue, parts);
    }
    parts.push("}");
    return;
  }

  throw makeError(
    ERROR_CODES.INVALID_INPUT,
    "Value cannot be represented as canonical JSON.",
    { valueType: typeof value },
  );
}
