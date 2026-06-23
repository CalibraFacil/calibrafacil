import { describe, expect, it } from "vitest";
import { safeMethodId, stripUndefinedDeep } from "./util";

// Narrowing helpers (no `as` — type assertions are banned repo-wide). These let
// the "dropped keys truly do not exist" assertions index into the `unknown`
// result of stripUndefinedDeep without casting.
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a plain object");
  }
  return Object.fromEntries(Object.entries(value));
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("expected an array");
  }
  return value;
}

// ---------------------------------------------------------------------------
// safeMethodId
// ---------------------------------------------------------------------------

describe("safeMethodId", () => {
  // REQ-MTU-001: chars outside [a-zA-Z0-9_] are each replaced with "_"
  it("REQ-MTU-001 replaces disallowed chars with underscores", () => {
    expect(safeMethodId("a-b.c d")).toBe("a_b_c_d");
    // Additional coverage: multiple special chars
    expect(safeMethodId("hello world!")).toBe("hello_world_");
    expect(safeMethodId("foo/bar:baz")).toBe("foo_bar_baz");
  });

  // REQ-MTU-002: sanitized id that starts with a digit or _ is prefixed "method_"
  it("REQ-MTU-002 prefixes with method_ when sanitized id starts with a digit", () => {
    expect(safeMethodId("123")).toBe("method_123");
  });

  it("REQ-MTU-002 prefixes with method_ when sanitized id starts with underscore", () => {
    // Input "_abc" — already starts with _, no disallowed chars to replace
    expect(safeMethodId("_abc")).toBe("method__abc");
  });

  // REQ-MTU-003: undefined input falls back to "method_draft"
  it("REQ-MTU-003 returns method_draft for undefined input", () => {
    expect(safeMethodId(undefined)).toBe("method_draft");
  });

  // REQ-MTU-004: number input is stringified then the same rules are applied
  it("REQ-MTU-004 stringifies a number and applies the rules (42 → method_42)", () => {
    expect(safeMethodId(42)).toBe("method_42");
  });

  it("REQ-MTU-004 stringifies a number starting with a letter-compatible result stays as-is", () => {
    // Numbers always start with digits after String(), so they get the prefix
    expect(safeMethodId(0)).toBe("method_0");
    expect(safeMethodId(999)).toBe("method_999");
  });

  // Regression guard: a clean alpha-start string must NOT get the prefix
  it("leaves a valid identifier starting with a letter unchanged", () => {
    expect(safeMethodId("myMethod")).toBe("myMethod");
    expect(safeMethodId("force_v2")).toBe("force_v2");
  });

  // Exact fingerprint-critical strings from specs
  it("produces exact fingerprint-relevant outputs", () => {
    expect(safeMethodId("a-b.c d")).toBe("a_b_c_d");
    expect(safeMethodId("123")).toBe("method_123");
    expect(safeMethodId(undefined)).toBe("method_draft");
    expect(safeMethodId(42)).toBe("method_42");
  });
});

// ---------------------------------------------------------------------------
// stripUndefinedDeep
// ---------------------------------------------------------------------------

describe("stripUndefinedDeep", () => {
  // REQ-MTU-005: undefined keys are dropped at every depth; null/0/false/"" preserved
  it("REQ-MTU-005 drops undefined keys at top level", () => {
    const result = stripUndefinedDeep({ a: 1, b: undefined });
    expect(result).toEqual({ a: 1 });
    expect(result).not.toHaveProperty("b");
  });

  it("REQ-MTU-005 preserves null", () => {
    const result = stripUndefinedDeep({ a: null, b: undefined });
    expect(result).toEqual({ a: null });
  });

  it("REQ-MTU-005 preserves 0", () => {
    const result = stripUndefinedDeep({ a: 0, b: undefined });
    expect(result).toEqual({ a: 0 });
  });

  it("REQ-MTU-005 preserves false", () => {
    const result = stripUndefinedDeep({ a: false, b: undefined });
    expect(result).toEqual({ a: false });
  });

  it('REQ-MTU-005 preserves empty string ""', () => {
    const result = stripUndefinedDeep({ a: "", b: undefined });
    expect(result).toEqual({ a: "" });
  });

  it("REQ-MTU-005 drops undefined keys at nested depth", () => {
    const result = stripUndefinedDeep({
      outer: {
        keep: "yes",
        drop: undefined,
        inner: {
          keepAlso: 0,
          dropAlso: undefined,
        },
      },
    });
    expect(result).toEqual({
      outer: {
        keep: "yes",
        inner: {
          keepAlso: 0,
        },
      },
    });
    // Verify the dropped keys truly do not exist
    const outer = asRecord(asRecord(result)["outer"]);
    expect(outer).not.toHaveProperty("drop");
    const inner = asRecord(outer["inner"]);
    expect(inner).not.toHaveProperty("dropAlso");
  });

  // REQ-MTU-006: array elements are mapped recursively; length is preserved
  it("REQ-MTU-006 maps over array elements recursively, preserving length", () => {
    const input = [
      { a: 1, b: undefined },
      { c: null, d: undefined },
    ];
    const result = stripUndefinedDeep(input);
    expect(Array.isArray(result)).toBe(true);
    const arr = asArray(result);
    expect(arr).toHaveLength(2);
    expect(arr[0]).toEqual({ a: 1 });
    expect(arr[1]).toEqual({ c: null });
    // The dropped keys must not exist
    expect(arr[0]).not.toHaveProperty("b");
    expect(arr[1]).not.toHaveProperty("d");
  });

  it("REQ-MTU-006 strips nested undefined inside array elements at depth", () => {
    const input = [
      {
        name: "row",
        nested: { value: 42, gone: undefined },
        extra: undefined,
      },
    ];
    const result = asArray(stripUndefinedDeep(input));
    const row = asRecord(result[0]);
    expect(row["name"]).toBe("row");
    expect(row["nested"]).toEqual({ value: 42 });
    expect(row).not.toHaveProperty("extra");
    const nested = asRecord(row["nested"]);
    expect(nested).not.toHaveProperty("gone");
  });

  // REQ-MTU-007: primitives and null are returned unchanged
  it("REQ-MTU-007 returns a number primitive unchanged", () => {
    expect(stripUndefinedDeep(42)).toBe(42);
  });

  it("REQ-MTU-007 returns a string primitive unchanged", () => {
    expect(stripUndefinedDeep("hello")).toBe("hello");
  });

  it("REQ-MTU-007 returns false unchanged", () => {
    expect(stripUndefinedDeep(false)).toBe(false);
  });

  it("REQ-MTU-007 returns null unchanged", () => {
    expect(stripUndefinedDeep(null)).toBe(null);
  });

  it("REQ-MTU-007 returns 0 unchanged", () => {
    expect(stripUndefinedDeep(0)).toBe(0);
  });

  it('REQ-MTU-007 returns "" unchanged', () => {
    expect(stripUndefinedDeep("")).toBe("");
  });
});
