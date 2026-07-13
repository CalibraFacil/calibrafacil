import { describe, expect, it } from "vitest";

import {
  formatCurrency,
  formatDate,
  formatDateLong,
  formatDateTime,
  pluralize,
} from "./format";

const SAMPLE = new Date(2026, 4, 12, 14, 30); // 12 May 2026 local time

describe("date formatting", () => {
  it("formats short, long and datetime pt-BR variants", () => {
    expect(formatDate(SAMPLE)).toBe("12 de mai. de 2026");
    expect(formatDateLong(SAMPLE)).toBe("12 de maio de 2026");
    expect(formatDateTime(SAMPLE)).toBe("12 de mai. de 2026, 14:30");
  });

  it("renders an em dash for absent or invalid values", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("formatCurrency", () => {
  it("converts integer cents into BRL", () => {
    // Intl uses a non-breaking space between the symbol and the value.
    expect(formatCurrency(123456)).toBe("R$ 1.234,56");
    expect(formatCurrency(null)).toBe("R$ 0,00");
  });
});

describe("pluralize", () => {
  it("selects singular and plural forms", () => {
    expect(pluralize(1, "ativo", "ativos")).toBe("1 ativo");
    expect(pluralize(3, "ativo", "ativos")).toBe("3 ativos");
    expect(pluralize(0, "ativo", "ativos")).toBe("0 ativos");
  });
});
