import { describe, expect, it } from "vitest";

import { PlaceholderFormatError, applyPlaceholderFormat } from "./format.js";

describe("applyPlaceholderFormat", () => {
  it("date-br: ISO date/datetime -> dd/mm/yyyy, date part only (TZ-safe)", () => {
    expect(applyPlaceholderFormat("date-br", "2026-07-01T23:59:59.000Z")).toBe("01/07/2026");
    expect(applyPlaceholderFormat("date-br", "2026-01-05")).toBe("05/01/2026");
    expect(() => applyPlaceholderFormat("date-br", "amanhã")).toThrow(PlaceholderFormatError);
  });

  it("number-br: hand-rolled pt-BR, no Intl (runtime-deterministic)", () => {
    expect(applyPlaceholderFormat("number-br", 0.0004)).toBe("0,0004");
    expect(applyPlaceholderFormat("number-br", 15000)).toBe("15.000");
    expect(applyPlaceholderFormat("number-br", -1234.5)).toBe("-1.234,5");
    expect(applyPlaceholderFormat("number-br", 2)).toBe("2");
    expect(applyPlaceholderFormat("number-br", "62.5")).toBe("62,5");
    expect(() => applyPlaceholderFormat("number-br", "not a number")).toThrow(
      PlaceholderFormatError,
    );
  });

  it("cnpj: masks 14 chars positionally — supports ALPHANUMERIC CNPJs (IN 2.229/2024)", () => {
    expect(applyPlaceholderFormat("cnpj", "12345678000190")).toBe("12.345.678/0001-90");
    expect(applyPlaceholderFormat("cnpj", "12.345.678/0001-90")).toBe("12.345.678/0001-90");
    // alphanumeric CNPJ: letters in positions 1-12, numeric check digits
    expect(applyPlaceholderFormat("cnpj", "12ABC345DE019807")).toBe("12ABC345DE019807"); // 16 chars: left untouched
    expect(applyPlaceholderFormat("cnpj", "12abc345de0198")).toBe("12.ABC.345/DE01-98");
    // CPF-length and free-form identifiers pass through untouched
    expect(applyPlaceholderFormat("cnpj", "123.456.789-00")).toBe("123.456.789-00");
  });

  it("bool-br: Sim/Não", () => {
    expect(applyPlaceholderFormat("bool-br", true)).toBe("Sim");
    expect(applyPlaceholderFormat("bool-br", false)).toBe("Não");
    expect(() => applyPlaceholderFormat("bool-br", "sim")).toThrow(PlaceholderFormatError);
  });

  it("text: strings pass through; numbers/bools get BR formatting; objects throw", () => {
    expect(applyPlaceholderFormat("text", "abc")).toBe("abc");
    expect(applyPlaceholderFormat("text", 1234.5)).toBe("1.234,5");
    expect(applyPlaceholderFormat("text", true)).toBe("Sim");
    expect(() => applyPlaceholderFormat("text", { a: 1 })).toThrow(PlaceholderFormatError);
  });
});
