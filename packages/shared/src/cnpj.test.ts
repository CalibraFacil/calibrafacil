import { describe, expect, it } from "vitest";
import {
  cnpjCharValue,
  computeCnpjCheckDigits,
  formatCnpj,
  isValidCnpj,
  normalizeCnpj,
} from "./cnpj";

describe("cnpjCharValue", () => {
  it("maps digits to themselves and letters via ASCII - 48", () => {
    expect(cnpjCharValue("0")).toBe(0);
    expect(cnpjCharValue("9")).toBe(9);
    expect(cnpjCharValue("A")).toBe(17);
    expect(cnpjCharValue("B")).toBe(18);
    expect(cnpjCharValue("Z")).toBe(42);
  });
});

describe("computeCnpjCheckDigits", () => {
  it("computes the alphanumeric example from the technical note", () => {
    expect(computeCnpjCheckDigits("12ABC34501DE")).toBe("35");
  });

  it("computes legacy numeric check digits", () => {
    expect(computeCnpjCheckDigits("112223330001")).toBe("81");
  });

  it("emits 0 when the módulo-11 remainder is below 2", () => {
    // base whose first DV remainder is < 2 → DV 0
    expect(computeCnpjCheckDigits("000000000006")).toBe("04");
  });

  it("throws when the base is not 12 chars", () => {
    expect(() => computeCnpjCheckDigits("123")).toThrow();
  });
});

describe("normalizeCnpj", () => {
  it("strips punctuation, uppercases, and preserves letters", () => {
    expect(normalizeCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });

  it("handles nullish input", () => {
    expect(normalizeCnpj(null)).toBe("");
    expect(normalizeCnpj(undefined)).toBe("");
  });
});

describe("isValidCnpj", () => {
  it("accepts a valid alphanumeric CNPJ (masked and unmasked)", () => {
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
    expect(isValidCnpj("12abc34501de35")).toBe(true);
  });

  it("accepts a valid legacy numeric CNPJ", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });

  it("rejects wrong check digits", () => {
    expect(isValidCnpj("12ABC34501DE00")).toBe(false);
    expect(isValidCnpj("11222333000182")).toBe(false);
  });

  it("rejects letters in the check-digit positions", () => {
    expect(isValidCnpj("12ABC34501DEAB")).toBe(false);
  });

  it("rejects wrong length and CPFs", () => {
    expect(isValidCnpj("12ABC34501DE3")).toBe(false);
    expect(isValidCnpj("123.456.789-09")).toBe(false);
  });

  it("rejects placeholder all-identical strings", () => {
    expect(isValidCnpj("00000000000000")).toBe(false);
  });
});

describe("formatCnpj", () => {
  it("applies the mask via positional slicing (letter-safe)", () => {
    expect(formatCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("returns normalized input when not 14 chars", () => {
    expect(formatCnpj("12ABC")).toBe("12ABC");
  });
});
