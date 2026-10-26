import { describe, expect, it } from "vitest";

import { formatMoney, formatNumber } from "./format";
import {
  MONEY_PARSE_FAILURE_MESSAGES,
  formatCentsForEditing,
  parseMoneyToCents,
  type MoneyParseFailure,
} from "./money";

function cents(input: string, allowNegative = false) {
  return parseMoneyToCents(input, { allowNegative });
}

function ok(value: number) {
  return { ok: true, cents: value };
}

function bad(reason: MoneyParseFailure) {
  return { ok: false, reason };
}

describe("parseMoneyToCents: accepted forms", () => {
  it.each([
    ["1234", 123400],
    ["0", 0],
    ["0,00", 0],
    ["0,05", 5],
    ["0,29", 29],
    ["1234,5", 123450],
    ["1234,56", 123456],
    ["1.234,56", 123456],
    ["1.234.567,89", 123456789],
    ["999.999,99", 99999999],
    ["R$ 1.234,56", 123456],
    ["R$1.234,56", 123456],
    ["r$ 1.234,56", 123456],
    ["  1.234,56  ", 123456],
    [" R$ 1.234,56 ", 123456],
    ["12,5", 1250],
    ["007,50", 750],
  ])("pt-BR %j is %d cents", (input, expected) => {
    expect(cents(input)).toEqual(ok(expected));
  });

  it.each([
    ["12.50", 1250],
    ["12.5", 1250],
    ["1234.56", 123456],
    ["0.5", 50],
    ["0.99", 99],
    ["R$ 12.50", 1250],
  ])("dot-decimal %j is %d cents", (input, expected) => {
    expect(cents(input)).toEqual(ok(expected));
  });

  it.each([
    ["1.234", 123400],
    ["12.345", 1234500],
    ["1.234.567", 123456700],
  ])(
    "dots in groups of three are thousands: %j is %d cents",
    (input, expected) => {
      expect(cents(input)).toEqual(ok(expected));
    },
  );

  it("is exact where float arithmetic is not", () => {
    // 0.29 * 100 = 28.999999999999996, 1.15 * 100 = 114.99999999999999
    expect(cents("0,29")).toEqual(ok(29));
    expect(cents("1,15")).toEqual(ok(115));
    expect(cents("4.35")).toEqual(ok(435));
    expect(cents("8,675")).toEqual(bad("malformed"));
    expect(cents("90071992547409,91")).toEqual(ok(9007199254740991));
  });
});

describe("parseMoneyToCents: the three historical bugs", () => {
  it('"1.234,56" is R$ 1.234,56, not 123 cents', () => {
    expect(cents("1.234,56")).toEqual(ok(123456));
  });

  it('"12.50" is R$ 12,50, not R$ 1.250,00', () => {
    expect(cents("12.50")).toEqual(ok(1250));
  });

  it("a thousands separator is accepted wherever a comma decimal is", () => {
    expect(cents("1.234,56")).toEqual(cents("1234,56"));
  });
});

describe("parseMoneyToCents: errors, never 0", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["R$", "empty"],
    ["R$  ", "empty"],
  ] as const)("blank %j is %s", (input, reason) => {
    expect(cents(input)).toEqual(bad(reason));
  });

  it.each([
    "abc",
    "12abc",
    "1 234,56",
    "1,",
    ",50",
    "12,345",
    "12,3456",
    "R$ R$ 1",
    "$ 1,00",
    "1e3",
    "1_000",
    "+1,00",
    "--1",
    "-",
    "NaN",
    "Infinity",
    "12,50 reais",
  ])("malformed %j", (input) => {
    const result = cents(input, true);
    expect(result.ok).toBe(false);
  });

  it.each([
    ["1.234.56", "ambiguous"],
    ["1,234.56", "ambiguous"],
    ["1.234,56,78", "ambiguous"],
    ["12.3456", "ambiguous"],
    ["0.500", "ambiguous"],
    ["1234.567", "ambiguous"],
    ["12.34.56", "ambiguous"],
    ["1..234", "ambiguous"],
    ["12.34,56", "ambiguous"],
    ["1.23,4.5", "ambiguous"],
    [".5", "ambiguous"],
    ["1.", "ambiguous"],
  ] as const)("%j is %s", (input, reason) => {
    expect(cents(input)).toEqual(bad(reason));
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(cents("90071992547410,00")).toEqual(bad("too_large"));
    expect(cents("999999999999999999,99")).toEqual(bad("too_large"));
  });

  it("every failure has field-error copy", () => {
    for (const message of Object.values(MONEY_PARSE_FAILURE_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe("parseMoneyToCents: negatives only when allowed", () => {
  it.each(["-12,50", "-R$ 12,50", "R$ -12,50", "- 12,50", "-1.234,50"])(
    "%j is refused by default",
    (input) => {
      expect(cents(input)).toEqual(bad("negative"));
    },
  );

  it("parses them when the caller allows", () => {
    expect(cents("-12,50", true)).toEqual(ok(-1250));
    expect(cents("-R$ 1.234,56", true)).toEqual(ok(-123456));
    expect(cents("R$ -1.234,56", true)).toEqual(ok(-123456));
    expect(cents("-12.50", true)).toEqual(ok(-1250));
  });

  it("negative zero is plain zero, allowed or not", () => {
    expect(cents("-0,00")).toEqual(ok(0));
    // toEqual tells -0 from 0, so this also pins the sign of zero.
    expect(cents("-0", true)).toEqual(ok(0));
  });
});

describe("formatCentsForEditing", () => {
  it.each([
    [0, "0,00"],
    [1, "0,01"],
    [9, "0,09"],
    [10, "0,10"],
    [100, "1,00"],
    [123456, "1234,56"],
    [123456789, "1234567,89"],
    [-5, "-0,05"],
    [-123456, "-1234,56"],
    [9007199254740991, "90071992547409,91"],
  ])("%d cents is %j", (value, expected) => {
    expect(formatCentsForEditing(value)).toBe(expected);
  });

  it("falls back to zero for non-integers instead of printing NaN", () => {
    expect(formatCentsForEditing(Number.NaN)).toBe("0,00");
    expect(formatCentsForEditing(12.5)).toBe("0,00");
  });
});

// ---------------------------------------------------------------------------
// Round trips against the formatters. A small seeded generator (mulberry32)
// keeps the "property" runs reproducible without a dependency.
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleCents(count: number) {
  const random = mulberry32(17025);
  const values = [
    0, 1, 5, 9, 10, 99, 100, 101, 999, 1000, 99999, 100000, 100001, 123456,
    999999, 1000000, 100000000, 123456789,
  ];
  for (let i = 0; i < count; i += 1) {
    // Log-uniform magnitude so every digit count (and grouping) is covered,
    // up to R$ 10 billion (1e12 cents; far inside float64's exact range).
    const magnitude = Math.floor(random() * 13);
    values.push(Math.floor(random() * 10 ** magnitude));
  }
  return values;
}

describe("round trips with the formatters", () => {
  const samples = sampleCents(2000);

  it("parse(formatMoney(c)) === c", () => {
    for (const value of samples) {
      expect(cents(formatMoney(value))).toEqual(ok(value));
    }
  });

  it("parse(formatMoney(-c)) === -c when negatives are allowed", () => {
    for (const value of samples) {
      expect(cents(formatMoney(-value), true)).toEqual(
        ok(value === 0 ? 0 : -value),
      );
    }
  });

  it("parse(formatNumber(c / 100, 2 decimals, grouped)) === c", () => {
    for (const value of samples) {
      expect(cents(formatNumber(value / 100, { decimals: 2 }))).toEqual(
        ok(value),
      );
    }
  });

  it("parse(formatCentsForEditing(c)) === c, for negatives too", () => {
    for (const value of samples) {
      expect(cents(formatCentsForEditing(value))).toEqual(ok(value));
      expect(cents(formatCentsForEditing(-value), true)).toEqual(
        ok(value === 0 ? 0 : -value),
      );
    }
  });

  it("the dot-decimal spelling of c reads the same as the comma one", () => {
    for (const value of samples) {
      const comma = formatCentsForEditing(value);
      expect(cents(comma.replace(",", "."))).toEqual(ok(value));
    }
  });

  it("formatCentsForEditing is exact at the safe-integer limit", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(cents(formatCentsForEditing(max))).toEqual(ok(max));
  });
});
