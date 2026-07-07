import { describe, expect, it } from "vitest";

import { MEASUREMENT_UNITS, unitKind } from "./registry";
import {
  type Rational,
  DIMENSIONLESS,
  KIND_DIMENSIONS,
  dimension,
  dimensionForRegistryUnit,
  dimensionsEqual,
  divideDimensions,
  formatDimension,
  isDimensionless,
  multiplyDimensions,
  powerDimension,
  ratAdd,
  ratMul,
  ratSub,
  rational,
} from "./dimensions";

describe("Rational (REQ-DIM-001)", () => {
  it("normalizes sign to a positive denominator and reduces by gcd", () => {
    expect(rational(2, 4)).toEqual({ n: 1, d: 2 });
    expect(rational(-1, -2)).toEqual({ n: 1, d: 2 });
    expect(rational(1, -2)).toEqual({ n: -1, d: 2 });
    expect(rational(0, 5)).toEqual({ n: 0, d: 1 });
    expect(rational(6, 3)).toEqual({ n: 2, d: 1 });
  });

  it("rejects non-integer components and a zero denominator", () => {
    expect(() => rational(1.5)).toThrow();
    expect(() => rational(1, 0)).toThrow();
  });

  it("is exact for add / sub / mul", () => {
    expect(ratAdd(rational(1, 3), rational(1, 6))).toEqual({ n: 1, d: 2 });
    expect(ratSub(rational(1, 2), rational(1, 3))).toEqual({ n: 1, d: 6 });
    expect(ratMul(rational(2, 3), rational(3, 4))).toEqual({ n: 1, d: 2 });
  });

  // ~91k triples -> ~273k assertions: exhaustive by design. Runs in ~1s on a
  // dev machine but has been measured at 6.6s on shared CI runners, past
  // vitest's 5s default — the explicit timeout accommodates slow hardware
  // without weakening the property being proven.
  it(
    "holds the associativity + additive-inverse properties over many rationals",
    { timeout: 30_000 },
    () => {
      const rats: Rational[] = [];
      for (let n = -4; n <= 4; n++) {
        for (let d = 1; d <= 5; d++) {
          rats.push(rational(n, d));
        }
      }
      for (const a of rats) {
        // additive inverse
        expect(ratAdd(a, rational(-a.n, a.d))).toEqual(rational(0));
        for (const b of rats) {
          for (const c of rats) {
            // associativity of addition
            expect(ratAdd(ratAdd(a, b), c)).toEqual(ratAdd(a, ratAdd(b, c)));
          }
          // commutativity of multiplication
          expect(ratMul(a, b)).toEqual(ratMul(b, a));
        }
      }
    },
  );
});

describe("Dimension algebra (REQ-DIM-001)", () => {
  it("multiply adds exponents, divide subtracts them", () => {
    const m = dimension({ M: rational(1) });
    const l = dimension({ L: rational(1) });
    expect(multiplyDimensions(m, l)).toEqual(
      dimension({ M: rational(1), L: rational(1) }),
    );
    expect(divideDimensions(m, l)).toEqual(
      dimension({ M: rational(1), L: rational(-1) }),
    );
  });

  it("multiply/divide are mutual inverses and land back on the operand", () => {
    const pressure = KIND_DIMENSIONS.pressure;
    const time = KIND_DIMENSIONS.time;
    const product = multiplyDimensions(pressure, time);
    expect(dimensionsEqual(divideDimensions(product, time), pressure)).toBe(
      true,
    );
  });

  it("sqrt(pressure²·time²) round-trips EXACTLY with a rational exponent", () => {
    const pressure = KIND_DIMENSIONS.pressure;
    const time = KIND_DIMENSIONS.time;
    const variance = multiplyDimensions(
      powerDimension(pressure, rational(2)),
      powerDimension(time, rational(2)),
    );
    // M²·L⁻²·T⁻⁴ · T² = M²·L⁻²·T⁻²
    const stdev = powerDimension(variance, rational(1, 2));
    // sqrt -> M·L⁻¹·T⁻¹
    expect(
      dimensionsEqual(
        stdev,
        dimension({ M: rational(1), L: rational(-1), T: rational(-1) }),
      ),
    ).toBe(true);
    // and raising back to the 2nd power is exact
    expect(dimensionsEqual(powerDimension(stdev, rational(2)), variance)).toBe(
      true,
    );
  });

  it("recognizes the zero vector as dimensionless", () => {
    expect(isDimensionless(DIMENSIONLESS)).toBe(true);
    expect(isDimensionless(KIND_DIMENSIONS.humidity)).toBe(true);
    expect(isDimensionless(KIND_DIMENSIONS.mass)).toBe(false);
  });

  it("formats a stable, deterministic string", () => {
    expect(formatDimension(DIMENSIONLESS)).toBe("1");
    expect(formatDimension(KIND_DIMENSIONS.pressure)).toBe("M·L^-1·T^-2");
    expect(formatDimension(KIND_DIMENSIONS.force)).toBe("M·L·T^-2");
    expect(
      formatDimension(
        dimension({ M: rational(1), L: rational(-1), T: rational(-1) }),
      ),
    ).toBe("M·L^-1·T^-1");
    expect(formatDimension(dimension({ T: rational(1, 2) }))).toBe("T^(1/2)");
  });
});

describe("Registry → dimension mapping (REQ-DIM-002)", () => {
  it("maps every one of the 13 QuantityKinds", () => {
    expect(KIND_DIMENSIONS.mass).toEqual(dimension({ M: rational(1) }));
    expect(KIND_DIMENSIONS.length).toEqual(dimension({ L: rational(1) }));
    expect(KIND_DIMENSIONS.time).toEqual(dimension({ T: rational(1) }));
    expect(KIND_DIMENSIONS.temperature).toEqual(dimension({ Θ: rational(1) }));
    expect(KIND_DIMENSIONS.current).toEqual(dimension({ I: rational(1) }));
    expect(KIND_DIMENSIONS.force).toEqual(
      dimension({ M: rational(1), L: rational(1), T: rational(-2) }),
    );
    expect(KIND_DIMENSIONS.pressure).toEqual(
      dimension({ M: rational(1), L: rational(-1), T: rational(-2) }),
    );
    expect(KIND_DIMENSIONS.voltage).toEqual(
      dimension({
        M: rational(1),
        L: rational(2),
        T: rational(-3),
        I: rational(-1),
      }),
    );
    expect(KIND_DIMENSIONS.resistance).toEqual(
      dimension({
        M: rational(1),
        L: rational(2),
        T: rational(-3),
        I: rational(-2),
      }),
    );
    expect(KIND_DIMENSIONS.frequency).toEqual(dimension({ T: rational(-1) }));
    expect(KIND_DIMENSIONS.torque).toEqual(
      dimension({ M: rational(1), L: rational(2), T: rational(-2) }),
    );
    expect(KIND_DIMENSIONS.volume).toEqual(dimension({ L: rational(3) }));
    // humidity (%RH) is a ratio → dimensionless by design.
    expect(KIND_DIMENSIONS.humidity).toEqual(DIMENSIONLESS);
  });

  it("resolves EVERY token in the registry to a dimension (exhaustiveness)", () => {
    for (const unit of MEASUREMENT_UNITS) {
      const dim = dimensionForRegistryUnit(unit);
      expect(dim, `no dimension for ${unit}`).not.toBeNull();
      const kind = unitKind(unit);
      expect(kind).not.toBeNull();
      if (dim && kind) {
        expect(dimensionsEqual(dim, KIND_DIMENSIONS[kind])).toBe(true);
      }
    }
  });
});
