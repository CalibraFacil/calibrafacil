import { describe, expect, it } from "vitest";

import { formatValue, getPath } from "./formatters.js";

// Tests run with TZ=UTC so local time === UTC; Date.UTC() makes timezone intent explicit.

describe("getPath", () => {
  // REQ-XLSX-001: dotted path into a nested object returns the leaf value
  it("REQ-XLSX-001: returns the leaf value for a dotted path", () => {
    const data = { a: { b: { c: 42 } } };
    expect(getPath(data, "a.b.c")).toBe(42);
  });

  it("REQ-XLSX-001: returns a string leaf at depth 2", () => {
    const data = { customer: { name: "LAB Exemplo" } };
    expect(getPath(data, "customer.name")).toBe("LAB Exemplo");
  });

  it("REQ-XLSX-001: returns the value at depth 1 (single segment)", () => {
    const data = { key: "value" };
    expect(getPath(data, "key")).toBe("value");
  });

  // REQ-XLSX-002: null/undefined/non-object segment → undefined, no throw
  it("REQ-XLSX-002: returns undefined when traversing through null", () => {
    const data = { a: null } satisfies Record<string, unknown>;
    expect(getPath(data, "a.b")).toBeUndefined();
  });

  it("REQ-XLSX-002: returns undefined when traversing through undefined", () => {
    const data = { a: undefined } satisfies Record<string, unknown>;
    expect(getPath(data, "a.b")).toBeUndefined();
  });

  it("REQ-XLSX-002: returns undefined when traversing through a primitive (number)", () => {
    const data = { a: 99 } satisfies Record<string, unknown>;
    expect(getPath(data, "a.b")).toBeUndefined();
  });

  it("REQ-XLSX-002: returns undefined when traversing through a primitive (string)", () => {
    const data = { a: "hello" } satisfies Record<string, unknown>;
    expect(getPath(data, "a.b.c")).toBeUndefined();
  });

  it("REQ-XLSX-002: does not throw for any traversal failure", () => {
    const data = { x: null } satisfies Record<string, unknown>;
    expect(() => getPath(data, "x.y.z")).not.toThrow();
  });
});

describe("formatValue", () => {
  // REQ-XLSX-003: null/undefined → ""
  it("REQ-XLSX-003: returns empty string for null", () => {
    expect(formatValue(null)).toBe("");
  });

  it("REQ-XLSX-003: returns empty string for undefined", () => {
    expect(formatValue(undefined)).toBe("");
  });

  it("REQ-XLSX-003: returns empty string for null even with a formatter", () => {
    expect(formatValue(null, "yyyy-mm-dd")).toBe("");
  });

  // REQ-XLSX-004: Date + "yyyy-mm-dd" → UTC ISO date slice
  it("REQ-XLSX-004: formats a Date with yyyy-mm-dd as UTC ISO date", () => {
    const date = new Date(Date.UTC(2024, 2, 15)); // 2024-03-15
    expect(formatValue(date, "yyyy-mm-dd")).toBe("2024-03-15");
  });

  it("REQ-XLSX-004: yyyy-mm-dd uses UTC (not local) day", () => {
    // Date.UTC(2024,0,1) = midnight UTC 2024-01-01
    const date = new Date(Date.UTC(2024, 0, 1));
    expect(formatValue(date, "yyyy-mm-dd")).toBe("2024-01-01");
  });

  // REQ-XLSX-005: Date + "dd/mm/yyyy" → pt-BR DD/MM/YYYY in UTC
  it("REQ-XLSX-005: formats a Date with dd/mm/yyyy as pt-BR date string", () => {
    const date = new Date(Date.UTC(2024, 2, 15)); // 2024-03-15
    expect(formatValue(date, "dd/mm/yyyy")).toBe("15/03/2024");
  });

  it("REQ-XLSX-005: dd/mm/yyyy uses UTC day boundary", () => {
    const date = new Date(Date.UTC(2024, 11, 31)); // 2024-12-31
    expect(formatValue(date, "dd/mm/yyyy")).toBe("31/12/2024");
  });

  // REQ-XLSX-006: Date + no formatter / unknown formatter → full ISO string
  it("REQ-XLSX-006: returns full ISO string for Date with no formatter", () => {
    const date = new Date(Date.UTC(2024, 2, 15, 10, 30, 0));
    expect(formatValue(date)).toBe(date.toISOString());
  });

  it("REQ-XLSX-006: returns full ISO string for Date with an unrecognised formatter", () => {
    const date = new Date(Date.UTC(2024, 2, 15, 10, 30, 0));
    expect(formatValue(date, "unknown-format")).toBe(date.toISOString());
  });

  // REQ-XLSX-007: number + "number:2" → toFixed(2); no/invalid formatter → String(value)
  it("REQ-XLSX-007: number with number:2 formatter uses toFixed(2)", () => {
    expect(formatValue(2.345, "number:2")).toBe("2.35");
  });

  it("REQ-XLSX-007: integer with number:2 formatter pads decimal places", () => {
    expect(formatValue(1, "number:2")).toBe("1.00");
  });

  it("REQ-XLSX-007: number:0 rounds to zero decimal places", () => {
    expect(formatValue(3.7, "number:0")).toBe("4");
  });

  it("REQ-XLSX-007: number with no formatter returns String(value)", () => {
    expect(formatValue(42)).toBe("42");
  });

  it("REQ-XLSX-007: number with invalid numeric formatter returns String(value)", () => {
    // "number:abc" — parseInt("abc") = NaN, not an integer → fallback
    expect(formatValue(3.14, "number:abc")).toBe("3.14");
  });

  it("REQ-XLSX-007: number with unrelated formatter returns String(value)", () => {
    expect(formatValue(99, "yyyy-mm-dd")).toBe("99");
  });

  // REQ-XLSX-008: boolean → "true"/"false"
  it('REQ-XLSX-008: true maps to the string "true"', () => {
    expect(formatValue(true)).toBe("true");
  });

  it('REQ-XLSX-008: false maps to the string "false"', () => {
    expect(formatValue(false)).toBe("false");
  });

  // REQ-XLSX-009: string + "date:<style>" — parse success and parse failure
  it("REQ-XLSX-009: string ISO date + date:yyyy-mm-dd formats as UTC ISO date", () => {
    expect(formatValue("2024-03-15T00:00:00.000Z", "date:yyyy-mm-dd")).toBe(
      "2024-03-15",
    );
  });

  it("REQ-XLSX-009: string ISO date + date:dd/mm/yyyy formats as pt-BR date", () => {
    expect(formatValue("2024-03-15T00:00:00.000Z", "date:dd/mm/yyyy")).toBe(
      "15/03/2024",
    );
  });

  it("REQ-XLSX-009: string date parse failure returns the original string", () => {
    expect(formatValue("not-a-date", "date:yyyy-mm-dd")).toBe("not-a-date");
  });

  it("REQ-XLSX-009: plain string without date: formatter is returned via String()", () => {
    // Ensures the date: branch is only entered when the formatter starts with "date:"
    expect(formatValue("2024-03-15", "yyyy-mm-dd")).toBe("2024-03-15");
  });
});
