/**
 * EA-4/02 worked examples as an external numeric oracle for the GUM engine.
 *
 * SOURCE (every expected number below is read from this document, not recalled):
 *   EA-4/02 M: 2022, "Evaluation of the Uncertainty of Measurement in Calibration",
 *   European Accreditation, 4th April 2022 rev03 (78 pages; editorial correction of the
 *   15 Nov 2021 rev02, approved 5 Nov 2021).
 *   https://european-accreditation.org/wp-content/uploads/2025/10/EA-4-02.pdf
 *   SHA-256 of the file consulted: 23cb84b6e2e0ac27040a22d7a3c6fba51b080caa9bd704ed1cfbb70d0634264f
 *   Page numbers are the document's own "Page N of 78". Note that the document numbers its
 *   examples S2-S7 (Supplement 1) and S9-S13 (Supplement 2).
 *
 * TOLERANCE POLICY. Each published number is compared to the engine with a tolerance of HALF A UNIT
 * OF ITS LAST PUBLISHED DIGIT ("29,2" -> 0.05; "0,60e-3" -> 0.005e-3), never a percentage. The
 * engine is run on the raw data (limits, distributions, certificate U and k, repeated readings), so
 * the standard uncertainties are derived by the engine, not copied.
 *
 * WHERE THE ENGINE AND THE DOCUMENT DISAGREE BEYOND THAT TOLERANCE the test does not move the
 * tolerance silently. It declares the deviation with `deviation(...)`: an explicit, larger bound AND
 * a reason, and the test additionally requires (a) the engine to equal an independent closed-form
 * recomputation in plain JavaScript (so the engine is exact for the stated inputs) and (b) the
 * deviation to actually exceed the half-unit (so a stale declaration fails and is removed). Every
 * such case in this file traces to the publication's own arithmetic (rounded intermediates,
 * printed typos), and is also verified by replaying the document's printed budget through the
 * engine, which reproduces the printed result.
 *
 * Not expressible by the model language, supplied as inputs where the document gives them:
 *  - S4 / S13 second-order products of zero-mean quantities (S4.13): u(da*dt) is an input.
 *  - The rectangular / trapezoidal coverage factors of S9, S10, S11: the engine only derives k from
 *    Student-t, so those k are explicit `coverageFactor` inputs (documented below).
 *  - S6 / S7 mismatch u(M), u(LM) formulas are partly garbled in the text layer; S6.4 is used and
 *    S7.2 is supplied as the printed u(LM) = 0,0198 dB.
 */

import { describe, expect, it } from "vitest";
import { createCalculationEngine } from "../engine/create.js";
import { METHOD_ENGINE_OPTIONS } from "../engine/options.js";
import { coverageFactorForProbability } from "./statistics.js";
import type { InputQuantity, MeasurementModelInput } from "./measurement.js";

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

interface PublishedNumber {
  readonly value: number;
  /** Half a unit of the last published digit. */
  readonly halfUnit: number;
}

/** Parse a published number written as "29.2", "-0.407", "0.60e-3" (decimal point, no spaces). */
function published(text: string): PublishedNumber {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e(-?\d+))?$/.exec(text);
  if (match === null) throw new Error(`Cannot parse published number "${text}".`);
  const decimals = match[3]?.length ?? 0;
  const exponent = match[4] === undefined ? 0 : Number(match[4]);
  return { value: Number(text), halfUnit: 0.5 * 10 ** (exponent - decimals) };
}

/** The relative slack only absorbs binary64 noise at the exact half-unit boundary. */
const BOUNDARY_SLACK = 1e-9;

function expectPublished(label: string, actual: number, text: string): void {
  const { value, halfUnit } = published(text);
  const delta = Math.abs(actual - value);
  expect(delta, `${label}: engine ${actual} vs published ${text} (|delta| ${delta} > half-unit ${halfUnit})`).toBeLessThanOrEqual(
    halfUnit * (1 + BOUNDARY_SLACK),
  );
}

/**
 * A declared deviation from a published number: bigger than half a unit, bounded by `tolerance`,
 * explained by `reason`, and pinned to an independent closed form computed without the engine.
 */
function deviation(label: string, actual: number, text: string, spec: { readonly tolerance: number; readonly reason: string; readonly closedForm: number }): void {
  const { value, halfUnit } = published(text);
  const delta = Math.abs(actual - value);
  expect(delta, `${label}: declared deviation no longer needed (engine ${actual}, published ${text}); remove it. ${spec.reason}`).toBeGreaterThan(
    halfUnit * (1 + BOUNDARY_SLACK),
  );
  expect(delta, `${label}: engine ${actual} vs published ${text} exceeds the declared bound ${spec.tolerance}. ${spec.reason}`).toBeLessThanOrEqual(spec.tolerance);
  expect(Math.abs(actual - spec.closedForm) / Math.abs(spec.closedForm), `${label}: engine differs from the independent closed form`).toBeLessThanOrEqual(1e-12);
}

function quadrature(contributions: readonly number[]): number {
  return Math.sqrt(contributions.reduce((sum, c) => sum + c * c, 0));
}

const engine = createCalculationEngine(METHOD_ENGINE_OPTIONS);

interface Evaluated {
  readonly value: number;
  readonly uc: number;
  readonly k: number;
  readonly U: number;
  readonly nuEff: number;
  readonly u: (symbol: string) => number;
  readonly c: (symbol: string) => number;
}

function evaluate(model: MeasurementModelInput): Evaluated {
  const result = engine.evaluateMeasurementModel(model);
  const entry = (symbol: string) => {
    const found = result.uncertaintyBudget.find((row) => row.symbol === symbol);
    if (found === undefined) throw new Error(`No budget entry for ${symbol}.`);
    return found;
  };
  return {
    value: Number(result.value),
    uc: Number(result.combinedStandardUncertainty),
    k: Number(result.coverageFactor),
    U: Number(result.expandedUncertainty),
    nuEff: result.effectiveDegreesOfFreedom === "Infinity" ? Number.POSITIVE_INFINITY : Number(result.effectiveDegreesOfFreedom),
    u: (symbol) => Number(entry(symbol).standardUncertainty),
    c: (symbol) => Number(entry(symbol).sensitivityCoefficient),
  };
}

/** A budget row exactly as printed: standard uncertainty and sensitivity coefficient. */
interface PrintedRow {
  readonly symbol: string;
  readonly u: number;
  readonly c: number;
}

/** Replay the document's printed budget (rounded u_i, c_i) through the engine as a linear model. */
function replay(rows: readonly PrintedRow[], coverage: { readonly coverageFactor: number } | { readonly coverageProbability: number }): Evaluated {
  const quantities: Record<string, InputQuantity> = {};
  for (const row of rows) {
    quantities[row.symbol] = { estimate: 0, standardUncertainty: row.u, sensitivityCoefficient: row.c };
  }
  return evaluate({ formula: rows.map((row) => row.symbol).join(" + "), quantities, ...coverage });
}

/** An input quantity taken from a calibration certificate: estimate with expanded uncertainty U at coverage factor k. */
function certificate(estimate: string | number, expandedUncertainty: string, coverageFactor: string): InputQuantity {
  return { estimate, typeB: { distribution: "normal", expandedUncertainty, coverageFactor } };
}

const SQRT3 = Math.sqrt(3);
const SQRT6 = Math.sqrt(6);
const SQRT2 = Math.sqrt(2);

// ---------------------------------------------------------------------------------------------
// Supplement 1
// ---------------------------------------------------------------------------------------------

describe("EA-4/02 S2 - weight of nominal value 10 kg (Supplement 1, pp. 29-31)", () => {
  // Engine units: mg (the document's budget unit), so every published number compares directly.
  const model = {
    formula: "mS + mD + dm + mC + B",
    quantities: {
      mS: certificate("10000005", "45", "2"),
      mD: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "15" } },
      dm: { estimate: "20", standardUncertainty: 25 / SQRT3 }, // sp = 25 mg pooled, n = 3 (S2.8)
      mC: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "10" } },
      B: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "10" } }, // 1e-6 x 10 kg
    },
    coverageFactor: 2,
  } satisfies MeasurementModelInput;

  it("EA402-S2 - replaying the printed budget reproduces u_c = 29,2 mg and U = 58 mg", () => {
    const r = replay(
      [
        { symbol: "mS", u: 22.5, c: 1 },
        { symbol: "mD", u: 8.66, c: 1 },
        { symbol: "dm", u: 14.4, c: 1 },
        { symbol: "mC", u: 5.77, c: 1 },
        { symbol: "B", u: 5.77, c: 1 },
      ],
      { coverageFactor: 2 },
    );
    expectPublished("S2 replay u_c", r.uc, "29.2");
    expectPublished("S2 replay U", r.U, "58");
  });

  it("EA402-S2 - from the raw data: estimate, every u(x_i), c_i and k = 2", () => {
    const r = evaluate(model);
    expectPublished("S2 m_X (mg)", r.value, "10000025");
    expectPublished("S2 u(mS)", r.u("mS"), "22.5");
    expectPublished("S2 u(mD)", r.u("mD"), "8.66");
    expectPublished("S2 u(dm)", r.u("dm"), "14.4");
    expectPublished("S2 u(mC)", r.u("mC"), "5.77");
    expectPublished("S2 u(B)", r.u("B"), "5.77");
    for (const symbol of ["mS", "mD", "dm", "mC", "B"]) expectPublished(`S2 c(${symbol})`, r.c(symbol), "1.0");
    expect(r.k).toBe(2);
  });

  it("EA402-S2 - u_c and U from the raw data differ from the printed ones only by the document's rounded intermediates", () => {
    const r = evaluate(model);
    const exact = quadrature([45 / 2, 15 / SQRT3, 25 / SQRT3, 10 / SQRT3, 10 / SQRT3]);
    const reason = "The document adds the ROUNDED contributions (22,5; 8,66; 14,4; 5,77; 5,77 -> 29,24 -> 29,2); unrounded they give 29,26.";
    deviation("S2 u_c", r.uc, "29.2", { tolerance: 0.1, reason, closedForm: exact });
    deviation("S2 U", r.U, "58", { tolerance: 1, reason: `U = 2 x 29,26 = 58,52 vs the printed 2 x 29,2 = 58,4 -> 58. ${reason}`, closedForm: 2 * exact });
  });
});

describe("EA-4/02 S3 - nominal 10 kOhm standard resistor (Supplement 1, pp. 31-34)", () => {
  // Engine units: ohm.
  const model = {
    formula: "(RS + dRD + dRTS) * rC * r - dRTX",
    quantities: {
      RS: certificate("10000.053", "0.005", "2"),
      dRD: { estimate: "0.020", typeB: { distribution: "rectangular", halfWidth: "0.010" } },
      dRTS: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.00275" } },
      dRTX: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.0055" } },
      rC: { estimate: "1.0000000", typeB: { distribution: "triangular", halfWidth: "0.000001" } },
      r: { repeatedObservations: ["1.0000104", "1.0000107", "1.0000106", "1.0000103", "1.0000105"] },
    },
    coverageFactor: 2,
  } satisfies MeasurementModelInput;

  it("EA402-S3 - from the raw data: R_X, every u(x_i), the sensitivities, u_c, k and U", () => {
    const r = evaluate(model);
    expectPublished("S3 R_X (ohm)", r.value, "10000.178");
    expectPublished("S3 u(RS)", r.u("RS"), "0.0025");
    expectPublished("S3 u(dRD)", r.u("dRD"), "0.0058");
    expectPublished("S3 u(dRTS)", r.u("dRTS"), "0.0016");
    expectPublished("S3 u(dRTX)", r.u("dRTX"), "0.0032");
    expectPublished("S3 u(rC)", r.u("rC"), "0.41e-6");
    expectPublished("S3 u(r)", r.u("r"), "0.07e-6");
    expectPublished("S3 c(rC)", r.c("rC"), "10000");
    expectPublished("S3 c(r)", r.c("r"), "10000");
    expectPublished("S3 u_c (ohm)", r.uc, "0.00833");
    expectPublished("S3 U (ohm)", r.U, "0.017");
    expect(r.k).toBe(2);
  });
});

describe("EA-4/02 S4 - gauge block of nominal length 50 mm (Supplement 1, pp. 34-37)", () => {
  // Engine units: nm for lengths, K for temperature. L = 50 mm = 5e7 nm, mean alpha = 11,5e-6 /K.
  // u(dalpha x dt) = u(dalpha) u(dt) is the S4.5 product of two zero-mean quantities, supplied as an
  // input (the engine linearises, which would give zero for it): (2e-6 / sqrt6) x (0,5 / sqrt3).
  const productU = (2e-6 / SQRT6) * (0.5 / SQRT3);
  const model = {
    formula: "lS + lD + dl + lC - L * (alpha * dT + prod) - lV",
    quantities: {
      lS: certificate("50000020", "30", "2"),
      lD: { estimate: 0, typeB: { distribution: "triangular", halfWidth: "30" } },
      dl: { estimate: "-94", standardUncertainty: 12 / Math.sqrt(5) }, // sp = 12 nm pooled, n = 5 (S4.9)
      lC: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "32" } },
      L: { estimate: "50000000", standardUncertainty: 0 },
      alpha: { estimate: "0.0000115", standardUncertainty: 0 },
      dT: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.05" } },
      prod: { estimate: 0, standardUncertainty: productU },
      lV: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "6.7" } },
    },
    coverageFactor: 2,
  } satisfies MeasurementModelInput;

  it("EA402-S4 - replaying the printed budget reproduces u_c = 34,3 nm and U = 69 nm", () => {
    const r = replay(
      [
        { symbol: "lS", u: 15, c: 1 },
        { symbol: "lD", u: 12.2, c: 1 },
        { symbol: "dl", u: 5.37, c: 1 },
        { symbol: "lC", u: 18.5, c: 1 },
        { symbol: "dT", u: 0.0289, c: -575 },
        { symbol: "prod", u: 0.236e-6, c: -50e6 },
        { symbol: "lV", u: 3.87, c: -1 },
      ],
      { coverageFactor: 2 },
    );
    expectPublished("S4 replay u_c (nm)", r.uc, "34.3");
    expectPublished("S4 replay U (nm)", r.U, "69");
  });

  it("EA402-S4 - from the raw data: l_X, u(x_i), c_i, u_c and U", () => {
    const r = evaluate(model);
    expectPublished("S4 l_X (nm)", r.value, "49999926");
    expectPublished("S4 u(lS)", r.u("lS"), "15.0");
    expectPublished("S4 u(lD)", r.u("lD"), "12.2");
    expectPublished("S4 u(dl)", r.u("dl"), "5.37");
    expectPublished("S4 u(lC)", r.u("lC"), "18.5");
    expectPublished("S4 u(dT) (K)", r.u("dT"), "0.0289");
    expectPublished("S4 u(prod)", r.u("prod"), "0.236e-6");
    expectPublished("S4 u(lV)", r.u("lV"), "3.87");
    expectPublished("S4 c(dT) (nm/K)", r.c("dT"), "-575");
    expectPublished("S4 c(prod) (nm)", r.c("prod"), "-50e6");
    expectPublished("S4 c(lV)", r.c("lV"), "-1.0");
    expectPublished("S4 u_c (nm)", r.uc, "34.3");
    expectPublished("S4 U (nm)", r.U, "69");
  });
});

describe("EA-4/02 S5 - type N thermocouple at 1000 C (Supplement 1, pp. 37-42)", () => {
  // Stage 1: temperature of the furnace tX (C, uV). Stage 2: emf VX (uV). Both budgets are printed.
  const furnace = {
    formula: "tS + CS * (V1 + V2 + VR) - (CS / CS0) * t0S + tC + tD + tF",
    quantities: {
      tS: { estimate: "1000.5", standardUncertainty: "0.10" }, // sp(tS) = 0,10 C, n = 1 (S5.16)
      CS: { estimate: "0.077", standardUncertainty: 0 },
      CS0: { estimate: "0.189", standardUncertainty: 0 },
      V1: certificate(0, "2.0", "2"),
      V2: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.5" } },
      VR: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "2" } },
      t0S: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.1" } },
      tC: certificate(0, "0.3", "2"),
      tD: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.3" } },
      tF: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "1" } },
    },
    coverageFactor: 2,
  } satisfies MeasurementModelInput;

  it("EA402-S5a - furnace temperature: t_X, u(x_i), c_i, u_c = 0,641 C and U = 1,3 C", () => {
    const r = evaluate(furnace);
    expectPublished("S5 t_X (C)", r.value, "1000.5");
    expectPublished("S5 u(V1)", r.u("V1"), "1.00");
    expectPublished("S5 u(V2)", r.u("V2"), "0.29");
    expectPublished("S5 u(VR)", r.u("VR"), "1.15");
    expectPublished("S5 u(t0S)", r.u("t0S"), "0.058");
    expectPublished("S5 u(tC)", r.u("tC"), "0.15");
    expectPublished("S5 u(tD)", r.u("tD"), "0.173");
    expectPublished("S5 u(tF)", r.u("tF"), "0.577");
    expectPublished("S5 c(V1) (C/uV)", r.c("V1"), "0.077");
    expectPublished("S5 c(t0S)", r.c("t0S"), "-0.407");
    expectPublished("S5 u_c (C)", r.uc, "0.641");
    expectPublished("S5 U (C)", r.U, "1.3");
  });

  it("EA402-S5b - emf of the thermocouple: V_X, u(x_i), c_i, u_c = 25,0 uV and U = 50 uV", () => {
    // The document prints the deviation "t" of the calibration point from the furnace as 0,5 C but its own
    // result V_X = 36 229 uV requires -0,5 C (t - tX = 1000,0 - 1000,5): 36248 + 38,5 x (-0,5) = 36229.
    // The sign is taken from the arithmetic; see the findings in the report.
    const furnaceResult = evaluate(furnace);
    const emf = {
      formula: "ViX + V1 + V2 + VR + VLX + dt / CX - t0X / CX0",
      quantities: {
        ViX: { estimate: "36248", standardUncertainty: "1.6" },
        V1: certificate(0, "2.0", "2"),
        V2: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.5" } },
        VR: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "2" } },
        VLX: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "5" } },
        dt: { estimate: "-0.5", standardUncertainty: furnaceResult.uc }, // u(t) = u(tX) of stage 1
        CX: { estimate: "0.026", standardUncertainty: 0 },
        CX0: { estimate: "0.039", standardUncertainty: 0 },
        t0X: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.1" } },
      },
      coverageFactor: 2,
    } satisfies MeasurementModelInput;
    const r = evaluate(emf);
    expectPublished("S5 V_X (uV)", r.value, "36229");
    expectPublished("S5 u(VLX)", r.u("VLX"), "2.9");
    expectPublished("S5 u(dt) (C)", r.u("dt"), "0.641");
    expectPublished("S5 c(dt) (uV/C)", r.c("dt"), "38.5");
    expectPublished("S5 c(t0X) (uV/C)", r.c("t0X"), "-25.6");
    expectPublished("S5 u_c (uV)", r.uc, "25.0");
    expectPublished("S5 U (uV)", r.U, "50");
  });
});

describe("EA-4/02 S6 - power sensor at 19 GHz (Supplement 1, pp. 42-46)", () => {
  // |Gamma| products 2|G||S,X| are the half-widths of the U-shaped mismatch factors (S6.4: u = 2|G||S|/sqrt2).
  const model = {
    formula: "(KS + KD) * (MSr * MXc) / (MSc * MXr) * pCr * pCc * p",
    quantities: {
      KS: certificate("0.957", "0.011", "2"),
      KD: { estimate: "-0.001", typeB: { distribution: "rectangular", halfWidth: "0.002" } },
      MSr: { estimate: 1, typeB: { distribution: "u-shaped", halfWidth: "0.0008" } },
      MSc: { estimate: 1, typeB: { distribution: "u-shaped", halfWidth: "0.014" } },
      MXr: { estimate: 1, typeB: { distribution: "u-shaped", halfWidth: "0.0008" } },
      MXc: { estimate: 1, typeB: { distribution: "u-shaped", halfWidth: "0.0168" } },
      pCr: { estimate: 1, standardUncertainty: (0.002 / 2) * SQRT2 }, // S6.7: reduced by sqrt2 for the ratio
      pCc: { estimate: 1, standardUncertainty: (0.0002 / 2) * SQRT2 },
      p: { repeatedObservations: ["0.9772", "0.9671", "0.9836"] },
    },
    coverageFactor: 2,
  } satisfies MeasurementModelInput;

  it("EA402-S6 - from the raw data: K_X, u(x_i), c_i, U = 0,032 and nu_eff of about 310", () => {
    const r = evaluate(model);
    expectPublished("S6 K_X", r.value, "0.933");
    expectPublished("S6 u(KS)", r.u("KS"), "0.0055");
    expectPublished("S6 u(KD)", r.u("KD"), "0.0012");
    expectPublished("S6 u(MSr)", r.u("MSr"), "0.0006");
    expectPublished("S6 u(MSc)", r.u("MSc"), "0.0099");
    expectPublished("S6 u(MXc)", r.u("MXc"), "0.0119");
    expectPublished("S6 u(pCr)", r.u("pCr"), "0.0014");
    expectPublished("S6 u(pCc)", r.u("pCc"), "0.0001");
    expectPublished("S6 u(p)", r.u("p"), "0.0048");
    expectPublished("S6 c(KS)", r.c("KS"), "0.976");
    expectPublished("S6 c(MSr)", r.c("MSr"), "0.933");
    expectPublished("S6 c(MSc)", r.c("MSc"), "-0.933");
    expectPublished("S6 c(MXr)", r.c("MXr"), "-0.933");
    expectPublished("S6 c(MXc)", r.c("MXc"), "0.933");
    expectPublished("S6 c(p)", r.c("p"), "0.956");
    expectPublished("S6 U", r.U, "0.032");
    // S6.12: "there should be a calculation of veff ... (veff ~ 310)": two significant digits, so +-5.
    expect(Math.abs(r.nuEff - 310), `S6 nu_eff ${r.nuEff} vs ~310`).toBeLessThanOrEqual(5);
  });

  it("EA402-S6 - u_c: the printed 0,016 23 is not reproducible from the document's own printed contributions", () => {
    const r = evaluate(model);
    // Closed form from the printed (rounded) contributions u_i(y) of S6.11.
    const printed = quadrature([0.00537, 0.00113, 0.00053, 0.00924, 0.00053, 0.0111, 0.00132, 0.00013, 0.00459]);
    // Independent closed form with the exact (unrounded) sensitivities of the product model at its estimates.
    const readings = [0.9772, 0.9671, 0.9836];
    const pBar = readings.reduce((a, b) => a + b, 0) / 3;
    const sP = Math.sqrt(readings.reduce((sum, x) => sum + (x - pBar) ** 2, 0) / 2);
    const k0 = 0.957 - 0.001;
    const exact = quadrature([
      pBar * (0.011 / 2),
      pBar * (0.002 / SQRT3),
      k0 * pBar * (0.0008 / SQRT2),
      k0 * pBar * (0.014 / SQRT2),
      k0 * pBar * (0.0008 / SQRT2),
      k0 * pBar * (0.0168 / SQRT2),
      k0 * pBar * (0.001 * SQRT2),
      k0 * pBar * (0.0001 * SQRT2),
      k0 * (sP / SQRT3),
    ]);
    // Replaying the printed u_i and c_i gives the same ~0,0162 as the raw data, not 0,01623.
    const replayed = replay(
      [
        { symbol: "KS", u: 0.0055, c: 0.976 },
        { symbol: "KD", u: 0.0012, c: 0.976 },
        { symbol: "MSr", u: 0.0006, c: 0.933 },
        { symbol: "MSc", u: 0.0099, c: -0.933 },
        { symbol: "MXr", u: 0.0006, c: -0.933 },
        { symbol: "MXc", u: 0.0119, c: 0.933 },
        { symbol: "pCr", u: 0.0014, c: 0.933 },
        { symbol: "pCc", u: 0.0001, c: 0.933 },
        { symbol: "p", u: 0.0048, c: 0.956 },
      ],
      { coverageFactor: 2 },
    );
    expect(Math.abs(replayed.uc - printed), "replay vs quadrature of the printed contributions").toBeLessThan(1e-4);
    expect(Math.abs(replayed.uc - 0.01623), "the printed 0,016 23 is off from its own contributions").toBeGreaterThan(2e-5);
    deviation("S6 u_c", r.uc, "0.01623", {
      tolerance: 1e-4,
      reason: "The printed contributions of S6.11 add to 0,01619 and the raw data give 0,01618; 0,016 23 is not reproducible from either (document inconsistency, 0,3 %).",
      closedForm: exact,
    });
  });
});

describe("EA-4/02 S7 - coaxial step attenuator at 30 dB (Supplement 1, pp. 46-50)", () => {
  // Engine units: dB. u(LM) = 0,0198 dB is the printed result of S7.2 (formula not machine-readable).
  const model = {
    formula: "LS + dLS + LD + LM + LK + Lib - Lia + L0b - L0a",
    quantities: {
      LS: { repeatedObservations: ["30.033", "30.058", "30.018", "30.052"] },
      dLS: certificate("0.003", "0.005", "2"),
      LD: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.002" } },
      LM: { estimate: 0, standardUncertainty: "0.0198" },
      LK: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.003" } },
      Lia: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.0005" } },
      Lib: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.0005" } },
      L0a: { estimate: 0, standardUncertainty: "0.002" },
      L0b: { estimate: 0, standardUncertainty: "0.002" },
    },
    coverageFactor: 2,
  } satisfies MeasurementModelInput;

  it("EA402-S7 - from the raw data: L_X, u(x_i), c_i and nu_eff of about 100 (k = 2 warranted)", () => {
    const r = evaluate(model);
    expectPublished("S7 L_X (dB)", r.value, "30.043");
    expectPublished("S7 u(dLS)", r.u("dLS"), "0.0025");
    expectPublished("S7 u(LD)", r.u("LD"), "0.0012");
    expectPublished("S7 u(LK)", r.u("LK"), "0.0017");
    expectPublished("S7 u(Lia)", r.u("Lia"), "0.0003");
    expectPublished("S7 u(Lib)", r.u("Lib"), "0.0003");
    expectPublished("S7 c(Lia)", r.c("Lia"), "-1.0");
    expectPublished("S7 c(Lib)", r.c("Lib"), "1.0");
    expectPublished("S7 c(L0a)", r.c("L0a"), "-1.0");
    expectPublished("S7 c(L0b)", r.c("L0b"), "1.0");
    // S7.13: "veff ~ 3 x (2,5)^4 ~ 100": one significant digit, so +-50.
    expect(Math.abs(r.nuEff - 100), `S7 nu_eff ${r.nuEff} vs ~100`).toBeLessThanOrEqual(50);
  });

  it("EA402-S7 - u(LS): the printed 0,0090 uses s = 0,018 rounded; from the four readings it is 0,00913", () => {
    const r = evaluate(model);
    const readings = [30.033, 30.058, 30.018, 30.052];
    const mean = readings.reduce((a, b) => a + b, 0) / 4;
    const s = Math.sqrt(readings.reduce((sum, x) => sum + (x - mean) ** 2, 0) / 3);
    expectPublished("S7 mean of the four readings (dB)", mean, "30.040");
    deviation("S7 u(LS)", r.u("LS"), "0.0090", {
      tolerance: 2e-4,
      reason: "The document divides the rounded s(LS) = 0,018 by sqrt4; the readings give s = 0,01827 and u = 0,00913 (the text of S7.11 prints 0,009).",
      closedForm: s / 2,
    });
  });

  it("EA402-S7 - u_c and U: the printed 0,0223 / 0,0446 follow from a misprinted row (Lib), not from the model", () => {
    const r = evaluate(model);
    const readings = [30.033, 30.058, 30.018, 30.052];
    const mean = readings.reduce((a, b) => a + b, 0) / 4;
    const uLS = Math.sqrt(readings.reduce((sum, x) => sum + (x - mean) ** 2, 0) / 3) / 2;
    const closedForm = quadrature([uLS, 0.005 / 2, 0.002 / SQRT3, 0.0198, 0.003 / SQRT3, 0.0005 / SQRT3, 0.0005 / SQRT3, 0.002, 0.002]);
    // Replay of the printed budget AS PRINTED, including the contribution 0,0019 printed for Lib
    // (its own row says u = 0,0003 and c = 1,0, i.e. 0,0003): the printed result is reproduced.
    const asPrinted = replay(
      [
        { symbol: "LS", u: 0.009, c: 1 },
        { symbol: "dLS", u: 0.0025, c: 1 },
        { symbol: "LD", u: 0.0012, c: 1 },
        { symbol: "LM", u: 0.0198, c: 1 },
        { symbol: "LK", u: 0.0017, c: 1 },
        { symbol: "Lia", u: 0.0003, c: -1 },
        { symbol: "Lib", u: 0.0019, c: 1 }, // misprint in the contribution column of S7.12
        { symbol: "L0a", u: 0.002, c: -1 },
        { symbol: "L0b", u: 0.002, c: 1 },
      ],
      { coverageFactor: 2 },
    );
    expectPublished("S7 replay u_c with the misprinted Lib contribution", asPrinted.uc, "0.0223");
    deviation("S7 u_c", r.uc, "0.0223", {
      tolerance: 2e-4,
      reason: "S7.12 prints the contribution of Lib as 0,0019 although its u(Lib) = 0,0003 and c = 1,0; with 0,0003 (and u(LS) = 0,00913) the model gives 0,02223.",
      closedForm,
    });
    deviation("S7 U", r.U, "0.0446", {
      tolerance: 3e-4,
      reason: "The document prints U = 2 x the ROUNDED u_c of 0,0223 (which itself carries the Lib misprint); the model gives 2 x 0,02223 = 0,04446.",
      closedForm: 2 * closedForm,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Supplement 2
// ---------------------------------------------------------------------------------------------

describe("EA-4/02 S9 - hand-held digital multimeter at 100 V DC (Supplement 2, pp. 55-58)", () => {
  // The output distribution is essentially rectangular, so the document derives k = p sqrt3 = 1,65 (S9.14)
  // instead of using the effective degrees of freedom. The engine has no such rule: k is an explicit input.
  const model = {
    formula: "ViX - VS + dViX - dVS",
    quantities: {
      ViX: { estimate: "100.1", standardUncertainty: 0 },
      VS: certificate("100.0", "0.002", "2"),
      dViX: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.05" } },
      dVS: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.011" } },
    },
    coverageFactor: "1.65",
  } satisfies MeasurementModelInput;

  it("EA402-S9 - from the raw data: E_X, u(x_i), c_i, u_c = 0,030 V and U = 0,05 V with the published k = 1,65", () => {
    const r = evaluate(model);
    expectPublished("S9 E_X (V)", r.value, "0.1");
    expectPublished("S9 u(VS)", r.u("VS"), "0.001");
    expectPublished("S9 u(dViX)", r.u("dViX"), "0.029");
    expectPublished("S9 u(dVS)", r.u("dVS"), "0.0064");
    expectPublished("S9 c(VS)", r.c("VS"), "-1.0");
    expectPublished("S9 c(dViX)", r.c("dViX"), "1.0");
    expectPublished("S9 c(dVS)", r.c("dVS"), "-1.0");
    expectPublished("S9 u_c (V)", r.uc, "0.030");
    expect(r.k).toBe(1.65);
    expectPublished("S9 U (V)", r.U, "0.05");
  });

  it("EA402-S9 - k = p sqrt3 (S9.8) gives 1,65 at p = 95 %; the engine's own k is the Student-t value (not implemented: rectangular output)", () => {
    expectPublished("S9 k(p) = p sqrt3", 0.95 * SQRT3, "1.65");
    const withoutOverride = evaluate({ formula: model.formula, quantities: model.quantities, coverageProbability: 0.95 });
    // With nu_eff infinite the engine reports the normal quantile 1,96, as it must: it does not model the
    // dominant-rectangular output of S9.14. Documented limitation, not a defect.
    expectPublished("S9 engine k without override", withoutOverride.k, "1.96");
  });
});

describe("EA-4/02 S10 - vernier calliper (Supplement 2, pp. 58-64)", () => {
  // Engine units: um. Trapezoidal output (beta = 0,33): k = 1,83 is the document's value, supplied as input.
  const model = {
    formula: "liX - lS + LS * alpha * dT + dliX + dlM",
    quantities: {
      liX: { estimate: "150100", standardUncertainty: 0 },
      lS: { estimate: "150000", typeB: { distribution: "rectangular", halfWidth: "0.8" } },
      LS: { estimate: "150000", standardUncertainty: 0 },
      alpha: { estimate: "0.0000115", standardUncertainty: 0 },
      dT: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "2" } },
      dliX: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "25" } },
      dlM: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "50" } },
    },
    coverageFactor: "1.83",
  } satisfies MeasurementModelInput;

  it("EA402-S10 - from the raw data: E_X, u(x_i), c_i, u_c = 32 um and U = 0,06 mm with k = 1,83", () => {
    const r = evaluate(model);
    expectPublished("S10 E_X (mm)", r.value / 1000, "0.10");
    expectPublished("S10 u(lS) (um)", r.u("lS"), "0.46");
    expectPublished("S10 u(dT) (K)", r.u("dT"), "1.15");
    expectPublished("S10 u(dliX) (um)", r.u("dliX"), "14");
    expectPublished("S10 u(dlM) (um)", r.u("dlM"), "29");
    expectPublished("S10 c(lS)", r.c("lS"), "-1.0");
    expectPublished("S10 c(dT) (um/K)", r.c("dT"), "1.7");
    expectPublished("S10 u_c (um)", r.uc, "32");
    expect(r.k).toBe(1.83);
    expectPublished("S10 U (mm)", r.U / 1000, "0.06");
  });
});

describe("EA-4/02 S11 - temperature block calibrator at 180 C (Supplement 2, pp. 64-67)", () => {
  // Engine units: mK. Trapezoidal output (beta = 0,43): k = 1,81 is the document's value, supplied as input.
  const model = {
    formula: "tS + dtS + dtD - dti + dtR + dtA + dtH + dtV",
    quantities: {
      tS: certificate("180100", "30", "2"),
      dtS: { estimate: 0, standardUncertainty: "10" },
      dtD: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "40" } },
      dti: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "50" } },
      dtR: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "100" } },
      dtA: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "250" } },
      dtH: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "50" } },
      dtV: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "30" } },
    },
    coverageFactor: "1.81",
  } satisfies MeasurementModelInput;

  it("EA402-S11 - from the raw data: t_X, u(x_i), c_i, u_c = 164 mK and U = 0,3 C with k = 1,81", () => {
    const r = evaluate(model);
    expectPublished("S11 t_X (C)", r.value / 1000, "180.1");
    expectPublished("S11 u(tS) (mK)", r.u("tS"), "15");
    expectPublished("S11 u(dtD)", r.u("dtD"), "23");
    expectPublished("S11 u(dti)", r.u("dti"), "29");
    expectPublished("S11 u(dtR)", r.u("dtR"), "58");
    expectPublished("S11 u(dtA)", r.u("dtA"), "144");
    expectPublished("S11 u(dtH)", r.u("dtH"), "29");
    expectPublished("S11 u(dtV)", r.u("dtV"), "17");
    expectPublished("S11 c(dti)", r.c("dti"), "-1.0");
    expectPublished("S11 u_c (mK)", r.uc, "164");
    expect(r.k).toBe(1.81);
    expectPublished("S11 U (C)", r.U / 1000, "0.3");
  });
});

describe("EA-4/02 S12 - household water meter (Supplement 2, pp. 67-72)", () => {
  // Stage 1 (volume V_X, l), stage 2 (relative error e_X), stage 3 (mean error e_Xav with nu_eff and Table E.1).
  const volume = {
    formula: "(ViS + dViS) * (1 + aS * (tS - 20)) * (1 + aW * (tX - tS)) * (1 - bW * (pX - pS))",
    quantities: {
      ViS: certificate("200.00", "0.2", "2"),
      dViS: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.02" } },
      aS: { estimate: "0.000051", typeB: { distribution: "rectangular", halfWidth: "0.0000005" } },
      tS: { estimate: "15", typeB: { distribution: "rectangular", halfWidth: "2" } },
      aW: { estimate: "0.00015", typeB: { distribution: "rectangular", halfWidth: "0.000005" } },
      tX: { estimate: "16", typeB: { distribution: "rectangular", halfWidth: "2" } },
      bW: { estimate: "0.00000046", typeB: { distribution: "rectangular", halfWidth: "0.000000005" } },
      pX: { estimate: "500", typeB: { distribution: "rectangular", halfWidth: "50" } },
      pS: { estimate: "0", standardUncertainty: 0 },
    },
    coverageFactor: 2,
  } satisfies MeasurementModelInput;

  it("EA402-S12a - volume V_X: estimate, u(x_i), every c_i (non-linear model) and u_c = 0,109 l", () => {
    const r = evaluate(volume);
    expectPublished("S12 V_X (l)", r.value, "199.93");
    expectPublished("S12 u(ViS)", r.u("ViS"), "0.10");
    expectPublished("S12 u(dViS)", r.u("dViS"), "0.0115");
    expectPublished("S12 u(aS)", r.u("aS"), "0.29e-6");
    expectPublished("S12 u(tS)", r.u("tS"), "1.15");
    expectPublished("S12 u(aW)", r.u("aW"), "2.9e-6");
    expectPublished("S12 u(tX)", r.u("tX"), "1.15");
    expectPublished("S12 u(bW)", r.u("bW"), "2.9e-9");
    expectPublished("S12 u(pX)", r.u("pX"), "29");
    expectPublished("S12 c(aS) (l K)", r.c("aS"), "-1000");
    expectPublished("S12 c(tS) (l/K)", r.c("tS"), "-0.0198");
    expectPublished("S12 c(aW) (l K)", r.c("aW"), "200");
    expectPublished("S12 c(tX) (l/K)", r.c("tX"), "0.0300");
    expectPublished("S12 c(bW) (l kPa)", r.c("bW"), "-1.00e5");
    expectPublished("S12 c(pX) (l/kPa)", r.c("pX"), "-9.2e-5");
    expectPublished("S12 u_c (l)", r.uc, "0.109");
  });

  it("EA402-S12b/c - relative error and its mean: u(e_X) = 0,68e-3, nu_eff of about 10, k = 2,28 (Table E.1), U = 2e-3", () => {
    const stage1 = evaluate(volume);
    const relative = {
      formula: "(ViX + dV2 - dV1) / VX - 1",
      quantities: {
        ViX: { estimate: "200.0", standardUncertainty: 0 },
        dV1: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.1" } },
        dV2: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.1" } },
        VX: { estimate: String(stage1.value), standardUncertainty: stage1.uc },
      },
      coverageProbability: 0.9545,
    } satisfies MeasurementModelInput;
    const stage2 = evaluate(relative);
    expectPublished("S12 e_X", stage2.value, "0.0003");
    expectPublished("S12 u(dV1)", stage2.u("dV1"), "0.058");
    expectPublished("S12 c(dV1) (1/l)", stage2.c("dV1"), "-5.0e-3");
    expectPublished("S12 c(dV2) (1/l)", stage2.c("dV2"), "5.0e-3");
    expectPublished("S12 c(VX) (1/l)", stage2.c("VX"), "-5.0e-3");
    expectPublished("S12 u(e_X)", stage2.uc, "0.68e-3");

    // S12.12-S12.14: three runs; the repeatability correction has nu = 2, e_X(published mean) = 0,001.
    const mean = {
      formula: "eX + drep",
      quantities: {
        eX: { estimate: "0.001", standardUncertainty: stage2.uc },
        drep: { repeatedObservations: ["0.0007", "0.0005", "-0.0012"] },
      },
      coverageProbability: 0.9545,
    } satisfies MeasurementModelInput;
    const r = evaluate(mean);
    expectPublished("S12 e_Xav", r.value, "0.001");
    expectPublished("S12 u(drep)", r.u("drep"), "0.60e-3");
    expectPublished("S12 u(e_Xav)", r.uc, "0.91e-3");
    // The document truncates nu_eff to the next lower integer (E2 c); the engine keeps the real value.
    expect(Math.floor(r.nuEff), `S12 nu_eff ${r.nuEff}`).toBe(10);
    expectPublished("S12 nu_eff (engine keeps the real value)", r.nuEff, "10");
    // Table E.1 is entered at the truncated nu_eff = 10: k = 2,28. The engine evaluates the t quantile at the
    // real nu_eff (10,3), which is smaller (10,36 -> 2,273), a documented policy difference (dossier, section 5),
    // not an error: the engine's k at the document's truncated value is the published one.
    expectPublished("S12 k at the truncated nu_eff (Table E.1)", coverageFactorForProbability(0.9545, Math.floor(r.nuEff)), "2.28");
    deviation("S12 k", r.k, "2.28", {
      tolerance: 0.01,
      reason: "EA-4/02 E2(c) truncates nu_eff (10,36) to 10 before entering Table E.1; the engine keeps the real value (k = 2,273, 0,3 % lower).",
      closedForm: coverageFactorForProbability(0.9545, r.nuEff),
    });
    expectPublished("S12 U", r.U, "2e-3");
  });
});

describe("EA-4/02 S13 - ring gauge of nominal diameter 90 mm (Supplement 2, pp. 72-78)", () => {
  // Engine units: um. The temperature sub-budget (S13.5) is printed with the second-order products
  // (S13.3) already evaluated; its four standard uncertainties are inputs.
  const temperature = {
    formula: "lTA + lTS + lTX + lTR",
    quantities: {
      lTA: { estimate: 0, standardUncertainty: "0.018" },
      lTS: { estimate: 0, standardUncertainty: "0.053" },
      lTX: { estimate: 0, standardUncertainty: "0.12" },
      lTR: { estimate: 0, standardUncertainty: "0.066" },
    },
    coverageFactor: 2,
  } satisfies MeasurementModelInput;

  const diameter = (uT: number) =>
    ({
      formula: "dS + dlm + dl0 + dli + dlT + dlP + dlE + dlA",
      quantities: {
        dS: certificate("40000.7", "0.2", "2"),
        dlm: { repeatedObservations: ["49999.35", "49999.11", "49999.72", "49999.54", "49999.96"] },
        dl0: { estimate: 0, standardUncertainty: "0.25" }, // sp(0) of the zeroing, S13.9
        dli: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.375" } },
        dlT: { estimate: 0, standardUncertainty: uT },
        dlP: { estimate: "0.004", standardUncertainty: "0.0065" },
        dlE: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.03" } },
        dlA: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: "0.02" } },
      },
      coverageFactor: 2,
    }) satisfies MeasurementModelInput;

  it("EA402-S13a - temperature sub-budget: u(dlT) = 0,15 um", () => {
    expectPublished("S13 u(dlT) (um)", evaluate(temperature).uc, "0.15");
  });

  it("EA402-S13b - from the raw data: d_X, u(x_i), c_i; u_c, U and the printed result deviate for documented reasons", () => {
    const uT = evaluate(temperature).uc;
    const r = evaluate(diameter(uT));
    const readings = [49999.35, 49999.11, 49999.72, 49999.54, 49999.96];
    const mean = readings.reduce((a, b) => a + b, 0) / 5;
    const sMean = Math.sqrt(readings.reduce((sum, x) => sum + (x - mean) ** 2, 0) / 4) / Math.sqrt(5);
    const uDl = Math.hypot(sMean, 0.25);
    expectPublished("S13 u(dS) (um)", r.u("dS"), "0.10");
    expectPublished("S13 u(dli)", r.u("dli"), "0.22");
    expectPublished("S13 u(dlE)", r.u("dlE"), "0.017");
    expectPublished("S13 u(dlA)", r.u("dlA"), "0.012");
    expectPublished("S13 s(mean) of the five readings", sMean, "0.15");
    for (const symbol of ["dS", "dlm", "dl0", "dli", "dlT", "dlP", "dlE", "dlA"]) expectPublished(`S13 c(${symbol})`, r.c(symbol), "1.0");

    deviation("S13 d_X (um)", r.value, "90000.25", {
      tolerance: 0.02,
      reason: "S13.9 prints the mean of the five readings as 49,999 54 mm (exact 49,999 536) and the budget as 49,999 55: the document propagates its rounded 49,999 55.",
      closedForm: 40000.7 + mean + 0.004,
    });
    const contributions = [0.2 / 2, uDl, 0.375 / SQRT3, uT, 0.0065, 0.03 / SQRT3, 0.02 / SQRT3];
    expect(Math.abs(r.u("dlm") - sMean) / sMean).toBeLessThan(1e-12);
    deviation("S13 u_c (um)", r.uc, "0.411", {
      tolerance: 0.01,
      reason:
        "The printed 0,30 for u(dl) is not sqrt(0,15^2 + 0,25^2) = 0,29; with the printed contributions the sum is 0,414, and 0,411 is reproducible from neither. Document inconsistency (about 1 %).",
      closedForm: quadrature(contributions),
    });
    deviation("S13 U (um)", r.U, "0.9", {
      tolerance: 0.15,
      reason: "S13.11 prints U = 2 x 0,411 um = 0,9 um; 2 x 0,411 is 0,82 (0,8) and the printed 0,9 would need k = 2,19. Document inconsistency.",
      closedForm: 2 * quadrature(contributions),
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Appendix E
// ---------------------------------------------------------------------------------------------

describe("EA-4/02 Appendix E - Table E.1, coverage factors k for p = 95,45 % (p. 24)", () => {
  // Published to two decimals, so the tolerance is 0,005. The document truncates nu_eff to an integer first.
  const table: ReadonlyArray<readonly [number, string]> = [
    [1, "13.97"], [2, "4.53"], [3, "3.31"], [4, "2.87"], [5, "2.65"], [6, "2.52"], [7, "2.43"], [8, "2.37"], [9, "2.32"], [10, "2.28"],
    [11, "2.25"], [12, "2.23"], [13, "2.21"], [14, "2.20"], [15, "2.18"], [16, "2.17"], [17, "2.16"], [18, "2.15"], [19, "2.14"], [20, "2.13"],
    [25, "2.11"], [30, "2.09"], [35, "2.07"], [40, "2.06"], [45, "2.06"], [50, "2.05"],
  ];

  it.each(table)("EA402-E1 - nu_eff = %d gives k = %s", (nu, text) => {
    expectPublished(`Table E.1 k(nu = ${nu})`, coverageFactorForProbability(0.9545, nu), text);
  });

  it("EA402-E1 - nu_eff = infinity gives k = 2,00", () => {
    expectPublished("Table E.1 k(infinity)", coverageFactorForProbability(0.9545, Number.POSITIVE_INFINITY), "2.00");
  });
});
