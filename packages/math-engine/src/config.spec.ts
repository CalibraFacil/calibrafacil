import { describe, it, expect, beforeEach } from "vitest";
import { createSecureMath, getSecureMath, resetSecureMath } from "./config";

describe("Secure Math Configuration", () => {
  beforeEach(() => {
    resetSecureMath();
  });

  describe("Blocked Functions", () => {
    it("should block import function", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate('import("fs")')).toThrow("Security violation");
    });

    it("should block evaluate function", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate('evaluate("2+2")')).toThrow("Security violation");
    });

    it("should block parse function", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate('parse("2+2")')).toThrow("Security violation");
    });

    it("should block createUnit function", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate("createUnit('foo')")).toThrow("Security violation");
    });

    it("should block simplify function", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate("simplify('x+x')")).toThrow("Security violation");
    });

    it("should block derivative function", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate("derivative('x^2', 'x')")).toThrow(
        "Security violation",
      );
    });
  });

  describe("Prototype Access Prevention", () => {
    it("should block __proto__ access", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate("x.__proto__", { x: {} })).toThrow(
        "Security violation",
      );
    });

    it("should block constructor access", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate("x.constructor", { x: {} })).toThrow(
        "Security violation",
      );
    });

    it("should block bracket notation prototype access", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate('x["__proto__"]', { x: {} })).toThrow(
        "Security violation",
      );
    });

    it("should block single quote bracket notation prototype access", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate("x['__proto__']", { x: {} })).toThrow(
        "Security violation",
      );
    });

    it("should block Function constructor", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate('Function("return 1")')).toThrow(
        "Security violation",
      );
    });

    it("should block eval", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate('eval("1+1")')).toThrow("Security violation");
    });

    it("should block require", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate('require("fs")')).toThrow("Security violation");
    });

    it("should block process access", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate("process.env")).toThrow("Security violation");
    });

    it("should block globalThis access", () => {
      const { evaluate } = getSecureMath();
      expect(() => evaluate("globalThis.eval")).toThrow("Security violation");
    });
  });

  describe("Allowed Operations", () => {
    it("should allow basic arithmetic", () => {
      const { evaluate } = getSecureMath();
      expect(Number(evaluate("2 + 3"))).toBe(5);
      expect(Number(evaluate("10 - 3"))).toBe(7);
      expect(Number(evaluate("10 * 5"))).toBe(50);
      expect(Number(evaluate("20 / 4"))).toBe(5);
    });

    it("should allow sqrt and power operations", () => {
      const { evaluate } = getSecureMath();
      expect(Number(evaluate("sqrt(16)"))).toBe(4);
      expect(Number(evaluate("pow(2, 3)"))).toBe(8);
      expect(Number(evaluate("2^3"))).toBe(8);
    });

    it("should allow trigonometric functions", () => {
      const { evaluate } = getSecureMath();
      expect(Number(evaluate("sin(0)"))).toBeCloseTo(0);
      expect(Number(evaluate("cos(0)"))).toBeCloseTo(1);
      expect(Number(evaluate("tan(0)"))).toBeCloseTo(0);
    });

    it("should allow statistical functions", () => {
      const { evaluate } = getSecureMath();
      expect(Number(evaluate("mean([1, 2, 3, 4, 5])"))).toBe(3);
      expect(Number(evaluate("sum([1, 2, 3, 4, 5])"))).toBe(15);
      expect(Number(evaluate("min([1, 2, 3, 4, 5])"))).toBe(1);
      expect(Number(evaluate("max([1, 2, 3, 4, 5])"))).toBe(5);
    });

    it("should allow logarithmic functions", () => {
      const { evaluate } = getSecureMath();
      expect(Number(evaluate("log(1)"))).toBeCloseTo(0);
      expect(Number(evaluate("log10(100)"))).toBeCloseTo(2);
      expect(Number(evaluate("exp(0)"))).toBeCloseTo(1);
    });

    it("should allow rounding functions", () => {
      const { evaluate } = getSecureMath();
      expect(Number(evaluate("round(3.7)"))).toBe(4);
      expect(Number(evaluate("floor(3.7)"))).toBe(3);
      expect(Number(evaluate("ceil(3.2)"))).toBe(4);
    });

    it("should allow comparison operations", () => {
      const { evaluate } = getSecureMath();
      expect(evaluate("5 > 3")).toBe(true);
      expect(evaluate("5 < 3")).toBe(false);
      expect(evaluate("5 == 5")).toBe(true);
    });

    it("should allow common JavaScript boolean operators", () => {
      const { evaluate } = getSecureMath();
      expect(evaluate("x >= 18 && x <= 23", { x: 20.3 })).toBe(true);
      expect(evaluate("x < 18 || x > 23", { x: 20.3 })).toBe(false);
    });

    it("should allow variable access from scope", () => {
      const { evaluate } = getSecureMath();
      const result = evaluate("x + y", { x: 10, y: 20 });
      expect(Number(result)).toBe(30);
    });

    it("should normalize decimal arrays from scope before vector arithmetic", () => {
      const { evaluate } = getSecureMath();
      const result = evaluate("(a + b + c) / 3", {
        a: [10.0001, 50.0002, 100.0003, 200.0004],
        b: [10.0001, 50.0001, 100.0002, 200.0003],
        c: [10.0001, 50.0002, 100.0002, 200.0004],
      });

      expect(Array.isArray(result)).toBe(true);
      const values = result as Array<{ toString: () => string }>;
      expect(values.map((value) => value.toString())).toEqual([
        "10.0001",
        "50.000166666666666666666666666667",
        "100.00023333333333333333333333333",
        "200.00036666666666666666666666667",
      ]);
    });
  });

  describe("BigNumber Precision", () => {
    it("should correctly calculate 0.1 + 0.2", () => {
      const { evaluate } = getSecureMath();
      const result = evaluate("0.1 + 0.2");
      expect(String(result)).toBe("0.3");
    });

    it("should maintain precision for small numbers", () => {
      const { evaluate } = getSecureMath();
      const result = evaluate("0.0000001 + 0.0000002");
      // Result may be in scientific notation (3e-7) or decimal (0.0000003)
      expect(Number(result)).toBeCloseTo(0.0000003, 15);
    });

    it("should handle very large numbers", () => {
      const { evaluate } = getSecureMath();
      const result = evaluate("1e20 + 1");
      expect(String(result)).toBe("100000000000000000001");
    });
  });

  describe("Configuration", () => {
    it("should allow custom precision", () => {
      const { evaluate } = createSecureMath({ precision: 64 });
      const result = evaluate("pi");
      // 64 digits of precision
      expect(String(result).length).toBeGreaterThan(32);
    });

    it("should be deterministic with predictable mode", () => {
      const { evaluate } = createSecureMath({ predictable: true });
      const result1 = evaluate("sqrt(2)");
      const result2 = evaluate("sqrt(2)");
      expect(String(result1)).toBe(String(result2));
    });
  });
});
