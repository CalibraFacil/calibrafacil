import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "../errors/codes.js";
import { canonicalJson, type CanonicalJsonValue } from "./canonical-json.js";
import { fingerprintCanonical } from "./fingerprint.js";

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

// What a caller can pass through `unknown`, JSON.parse of a foreign payload or an
// untyped boundary: the type forbids it, the runtime did not.
function untyped(value: unknown): CanonicalJsonValue {
  return value as CanonicalJsonValue;
}

describe("canonicalJson", () => {
  it("orders keys by code unit, drops undefined members and writes -0 as 0", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"], B: -0, c: undefined })).toBe('{"B":0,"a":[true,null,"x"],"b":1}');
  });

  it("accepts a record with no prototype", () => {
    const record: Record<string, CanonicalJsonValue> = Object.create(null) as Record<string, CanonicalJsonValue>;
    record.a = 1;
    expect(canonicalJson(record)).toBe('{"a":1}');
  });

  it("refuses values that used to be written as an empty record (0.4.0: Map, Set, Date and boxed primitives gave \"{}\")", () => {
    for (const value of [new Map([["a", 1]]), new Set([1]), new Date(0), new Number(5), new String("x"), /x/, new Uint8Array(2)]) {
      expect(errorCode(() => canonicalJson(untyped(value)))).toBe(ERROR_CODES.INVALID_INPUT);
      expect(errorCode(() => fingerprintCanonical(untyped({ payload: value })))).toBe(ERROR_CODES.INVALID_INPUT);
    }
  });

  it("refuses a sparse array (0.4.0: \"[,1]\", which is not JSON)", () => {
    const sparse: unknown[] = [];
    sparse[1] = 1;
    expect(errorCode(() => canonicalJson(untyped(sparse)))).toBe(ERROR_CODES.INVALID_INPUT);
    expect(canonicalJson([null, 1])).toBe("[null,1]");
  });

  it("refuses non-finite numbers", () => {
    expect(errorCode(() => canonicalJson(Number.NaN))).toBe(ERROR_CODES.NON_FINITE_NUMBER);
    expect(errorCode(() => canonicalJson([Number.POSITIVE_INFINITY]))).toBe(ERROR_CODES.NON_FINITE_NUMBER);
  });
});
