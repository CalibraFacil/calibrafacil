/**
 * Statistics behind the coverage factor: erf, the normal quantile, the regularized
 * incomplete beta function and Student's t.
 *
 * Every expected value below was computed outside the engine, with mpmath at 60
 * significant digits (erf, erfinv and betainc; the t quantile by bisection on the
 * t tail), and is written with 20. The tolerances are the ones the dossier
 * declares (section "Limitações Declaradas").
 *
 * The cases under "0.5.0 corrections" failed on 0.4.0.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createCalculationEngine } from "../engine/create.js";
import { ERROR_CODES } from "../errors/codes.js";
import {
  coverageFactorForProbability,
  erf,
  normalQuantile,
  regularizedIncompleteBeta,
  studentTCdf,
  studentTQuantile,
} from "./statistics.js";

function relativeError(received: number, expected: number): number {
  return Math.abs(received - expected) / Math.abs(expected);
}

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("erf", () => {
  const table: readonly (readonly [number, number])[] = [
    [1e-10, 1.1283791670955125739e-10],
    [0.001, 0.0011283787909692363799],
    [0.1, 0.1124629160182848922],
    [0.5, 0.52049987781304653768],
    [1, 0.84270079294971486934],
    [1.5, 0.96610514647531072707],
    [1.9999, 0.99532019790702939146],
    [2, 0.99532226501895273416],
    [2.5, 0.99959304798255504106],
    [3, 0.99997790950300141456],
    [4, 0.99999998458274209972],
    [5, 0.99999999999846254021],
  ];

  it.each(table)("erf(%d) agrees with the reference to 4 units in the 16th place", (x, expected) => {
    expect(Math.abs(erf(x) - expected)).toBeLessThanOrEqual(4e-16);
    expect(erf(-x)).toBe(-erf(x));
  });

  it("is exactly 0 at 0 and exactly 1 where the complement is below half a unit in the last place", () => {
    expect(erf(0)).toBe(0);
    expect(erf(6)).toBe(1);
    expect(erf(1e200)).toBe(1);
  });
});

describe("normalQuantile", () => {
  const lowerTail: readonly (readonly [number, number])[] = [
    [1e-250, -33.799586172694837471],
    [1e-100, -21.273453560965324295],
    [1e-20, -9.2623400897984075737],
    [1e-10, -6.3613409024040562047],
    [0.001, -3.0902323061678135415],
    [0.02, -2.0537489106318230529],
    [0.02425, -1.9729610513118848503],
    [0.025, -1.9599639845400542355],
    [0.1, -1.281551565544600467],
    [0.3, -0.52440051270804078404],
    [0.45, -0.12566134685507403421],
  ];
  const upperTail: readonly (readonly [number, number])[] = [
    [0.84134474606854293, 0.99999999999999990574],
    [0.95, 1.6448536269514722843],
    [0.975, 1.9599639845400538556],
    [0.97725, 2.0000024438996030105],
    [0.99, 2.3263478740408407676],
    [0.995, 2.5758293035489004539],
    [0.9995, 3.2905267314919257787],
    [0.999999, 4.7534243088170877657],
  ];

  it.each([...lowerTail, ...upperTail])("normalQuantile(%d) agrees with the reference to 1e-13 relative", (p, expected) => {
    expect(relativeError(normalQuantile(p), expected)).toBeLessThanOrEqual(1e-13);
  });

  it("is exactly 0 at the median and odd around it", () => {
    expect(normalQuantile(0.5)).toBe(0);
    for (const p of [0.25, 0.125, 0.0625, 2 ** -20]) {
      expect(normalQuantile(1 - p)).toBe(-normalQuantile(p));
    }
  });

  it("is the inverse of the normal distribution function (ν = ∞)", () => {
    for (const p of [1e-12, 1e-6, 0.001, 0.02275, 0.2, 0.5, 0.7, 0.975, 0.99999]) {
      const roundTrip = studentTCdf(normalQuantile(p), Number.POSITIVE_INFINITY);
      expect(Math.abs(roundTrip - p)).toBeLessThanOrEqual(4e-16 + 1e-13 * Math.min(p, 1 - p));
    }
  });

  it("gives the conventional coverage factors for a normal result", () => {
    expect(relativeError(coverageFactorForProbability(0.95, Number.POSITIVE_INFINITY), 1.9599639845400542355)).toBeLessThanOrEqual(1e-13);
    expect(relativeError(coverageFactorForProbability(0.9545, Number.POSITIVE_INFINITY), 2.0000024438996027)).toBeLessThanOrEqual(1e-13);
  });
});

describe("regularizedIncompleteBeta", () => {
  const table: readonly (readonly [number, number, number, number])[] = [
    [0.3, 2.5, 7, 0.64122246297172117081],
    [0.9, 30, 2, 0.16956463310086491132],
    [1e-8, 3, 400, 1.0746767840252199018e-17],
    [0.2, 0.05, 0.5, 0.86867068031344623413],
    [0.75, 12, 0.5, 0.0092936974303938768571],
  ];

  it.each(table)("I_%d(%d, %d) agrees with the reference to 1e-13 relative", (x, a, b, expected) => {
    expect(relativeError(regularizedIncompleteBeta(x, a, b), expected)).toBeLessThanOrEqual(1e-13);
  });

  it("reproduces the closed forms I_x(1, 1) = x, I_x(a, 1) = x^a and I_x(1, b) = 1 - (1 - x)^b", () => {
    for (const x of [0.001, 0.2, 0.5, 0.8, 0.999]) {
      expect(Math.abs(regularizedIncompleteBeta(x, 1, 1) - x)).toBeLessThanOrEqual(1e-14);
      expect(relativeError(regularizedIncompleteBeta(x, 3.5, 1), x ** 3.5)).toBeLessThanOrEqual(1e-13);
      expect(Math.abs(regularizedIncompleteBeta(x, 1, 4) - (1 - (1 - x) ** 4))).toBeLessThanOrEqual(1e-14);
    }
  });

  it("returns the end points exactly", () => {
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0);
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1);
  });
});

describe("Student's t", () => {
  // [p, ν, t_p]
  const quantiles: readonly (readonly [number, number, number])[] = [
    [0.6, 0.5, 0.39797542678479058738],
    [0.841345, 0.5, 4.0491959044937827208],
    [0.975, 0.5, 164.5576734804882408],
    [0.97725, 0.5, 198.71749780138442014],
    [0.995, 0.5, 4113.9645888041738438],
    [0.9999, 0.5, 1.0284911563165650973e+7],
    [0.6, 1, 0.32491969623290624903],
    [0.841345, 1, 1.8373406922740247083],
    [0.975, 1, 12.706204736174693314],
    [0.97725, 1, 13.967811487502547733],
    [0.995, 1, 63.656741162871524447],
    [0.9999, 1, 3183.0987571185014745],
    [0.6, 2, 0.28867513459481281549],
    [0.841345, 2, 1.3212792138223054446],
    [0.975, 2, 4.3026527297494617894],
    [0.97725, 2, 4.5265507600819860456],
    [0.995, 2, 9.9248432009182886403],
    [0.9999, 2, 70.700071074968171991],
    [0.6, 3, 0.27667066233268984701],
    [0.841345, 3, 1.1968828625972517753],
    [0.975, 3, 3.1824463052837084359],
    [0.97725, 3, 3.30682992072010883],
    [0.995, 3, 5.8409093097333554113],
    [0.9999, 3, 22.203742273205002038],
    [0.6, 4.6, 0.268409892925206647],
    [0.841345, 4.6, 1.1211648362278939101],
    [0.975, 4.6, 2.6392916097470016535],
    [0.97725, 4.6, 2.7222061965919450914],
    [0.995, 4.6, 4.2187411863129783601],
    [0.9999, 4.6, 10.710377887825481135],
    [0.6, 10, 0.26018482949208017615],
    [0.841345, 10, 1.0525635783633691405],
    [0.975, 10, 2.2281388519862742245],
    [0.97725, 10, 2.2836816132996403677],
    [0.995, 10, 3.1692726726169507118],
    [0.9999, 10, 5.693820101457592645],
    [0.6, 50, 0.25469934298858811403],
    [0.841345, 50, 1.0101015699868082003],
    [0.975, 50, 2.0085591121007607009],
    [0.97725, 50, 2.05125078185188125],
    [0.995, 50, 2.6777932709408439081],
    [0.9999, 50, 4.0140473201558350235],
    [0.6, 1000, 0.25341451583949870728],
    [0.841345, 1000, 1.0005013005438024499],
    [0.975, 1000, 1.9623390808264081039],
    [0.97725, 1000, 2.0025055172186721892],
    [0.995, 1000, 2.5807546980659507706],
    [0.9999, 1000, 3.7328516045753962333],
    [0.6, 9430, 0.25335425087321487088],
    [0.841345, 9430, 1.0000540746231296157],
    [0.975, 9430, 1.9602155826916557461],
    [0.97725, 9430, 2.0002675905314000503],
    [0.995, 9430, 2.576350775936330993],
    [0.9999, 9430, 3.7204792758333040735],
    [0.6, 100000, 0.25334777715717988552],
    [0.841345, 100000, 1.0000060494665395108],
    [0.975, 100000, 1.9599877075346092587],
    [0.97725, 100000, 2.0000274442852842113],
    [0.995, 100000, 2.5758784699083749963],
    [0.9999, 100000, 3.7191543826413721848],
    [0.6, 100001, 0.25334777715043972844],
    [0.841345, 100001, 1.0000060494165394058],
    [0.975, 100001, 1.9599877072973788629],
    [0.97725, 100001, 2.000027444035279792],
    [0.995, 100001, 2.5758784694167074834],
    [0.9999, 100001, 3.7191543812623683728],
    [0.6, 9268196, 0.25334711040820014714],
    [0.841345, 9268196, 1.0000011033790923694],
    [0.975, 9268196, 1.9599642404983368736],
    [0.97725, 9268196, 2.0000027136401515612],
    [0.995, 9268196, 2.5758298340241463219],
    [0.9999, 9268196, 3.7190179732604607558],
    [0.6, 10000000, 0.25334710987600296805],
    [0.841345, 10000000, 1.0000010994311524897],
    [0.975, 10000000, 1.9599642217672051104],
    [0.97725, 10000000, 2.000002693900427904],
    [0.995, 10000000, 2.5758297952037486634],
    [0.9999, 10000000, 3.719017864382277737],
    [0.6, 10000024, 0.2533471098759867916],
    [0.841345, 10000024, 1.0000010994310324897],
    [0.975, 10000024, 1.9599642217666357666],
    [0.97725, 10000024, 2.0000026938998279033],
    [0.995, 10000024, 2.5758297952025686944],
    [0.9999, 10000024, 3.71901786437896832],
    [0.6, 1000000000, 0.25334710320320177253],
    [0.841345, 1000000000, 1.0000010499310460962],
    [0.975, 1000000000, 1.9599639869123250887],
    [0.97725, 1000000000, 2.0000024463996109563],
    [0.995, 1000000000, 2.5758293084654480613],
    [0.9999, 1000000000, 3.7190164992449695516],
    [0.6, 1e15, 0.25334710313579980873],
    [0.841345, 1e15, 1.0000010494310455465],
    [0.975, 1e15, 1.9599639845400562279],
    [0.97725, 1e15, 2.0000024438996055105],
    [0.995, 1e15, 2.5758293035489053704],
    [0.9999, 1e15, 3.719016485455722176],
  ];
  // [t, ν, P(T <= t)]
  const distribution: readonly (readonly [number, number, number])[] = [
    [-40, 0.5, 0.050704899964747178098],
    [-6, 0.5, 0.13065468873499942429],
    [-2, 0.5, 0.22275744509156561559],
    [-1e-4, 0.5, 0.49997303237007541918],
    [-1e-8, 0.5, 0.49999999730323699406],
    [-1e-12, 0.5, 0.4999999999997303237],
    [1e-9, 0.5, 0.50000000026967630059],
    [0.5, 0.5, 0.62134096353528168433],
    [1.7, 0.5, 0.75993243504211519363],
    [1.75, 0.5, 0.76308239175922584794],
    [3, 0.5, 0.8163459220070282759],
    [-40, 1, 0.0079560899120258133183],
    [-6, 1, 0.052568456711253429951],
    [-2, 1, 0.14758361765043327418],
    [-1e-4, 1, 0.49996816901148772423],
    [-1e-8, 1, 0.49999999681690113816],
    [-1e-12, 1, 0.49999999999968169011],
    [1e-9, 1, 0.50000000031830988618],
    [0.5, 1, 0.64758361765043327418],
    [1.7, 1, 0.83074697266966733624],
    [1.75, 1, 0.83475065946143209036],
    [3, 1, 0.89758361765043327418],
    [-40, 3, 1.7190340394579264142e-5],
    [-6, 3, 0.0046363574461423337021],
    [-2, 3, 0.069662984279421588424],
    [-1e-4, 3, 0.49996324474038689222],
    [-1e-8, 3, 0.49999999632447403052],
    [-1e-12, 3, 0.4999999999996324474],
    [1e-9, 3, 0.50000000036755259695],
    [0.5, 3, 0.67427601757592450278],
    [1.7, 3, 0.90615467922329496],
    [1.75, 3, 0.91078728695086429616],
    [3, 3, 0.97116555718878134571],
    [-40, 10, 1.1404288715428773225e-12],
    [-6, 10, 6.6054430177392802118e-5],
    [-2, 10, 0.036694017385370182809],
    [-1e-4, 10, 0.49996108916167473343],
    [-1e-8, 10, 0.49999999610891616034],
    [-1e-12, 10, 0.49999999999961089162],
    [1e-9, 10, 0.50000000038910838397],
    [0.5, 10, 0.68605319712851352865],
    [1.7, 10, 0.94001532704548980163],
    [1.75, 10, 0.94465952786702645348],
    [3, 10, 0.9933281724887152114],
    [-40, 1000, 5.2394260775866804698e-210],
    [-6, 1000, 1.3776845866887345563e-9],
    [-2, 1000, 0.022885173246625820024],
    [-1e-4, 1000, 0.49996011574433515442],
    [-1e-8, 1000, 0.49999999601157442686],
    [-1e-12, 1000, 0.49999999999960115744],
    [1e-9, 1000, 0.50000000039884255731],
    [0.5, 1000, 0.69140745958306259268],
    [1.7, 1000, 0.95527905652037998315],
    [1.75, 1000, 0.9597874953202710974],
    [3, 1000, 0.99861664547788090377],
    [-40, 100000, 2.0731343228002414848e-347],
    [-6, 100000, 9.899647278008812792e-10],
    [-2, 100000, 0.022751481728753231625],
    [-1e-4, 100000, 0.49996010587176179304],
    [-1e-8, 100000, 0.49999999601058716953],
    [-1e-12, 100000, 0.49999999999960105872],
    [1e-9, 100000, 0.50000000039894128305],
    [0.5, 100000, 0.69146191117279098053],
    [1.7, 100000, 0.95543298237566855124],
    [1.75, 100000, 0.95993930969130256813],
    [3, 100000, 0.9986497695579676404],
    [-40, 1000000, 6.9341452709792962472e-350],
    [-6, 1000000, 9.8692490617721733495e-10],
    [-2, 1000000, 0.022750266925659604211],
    [-1e-4, 1000000, 0.49996010578199990293],
    [-1e-8, 1000000, 0.49999999601057819334],
    [-1e-12, 1000000, 0.49999999999960105782],
    [1e-9, 1000000, 0.50000000039894218067],
    [0.5, 1000000, 0.69146240626381430611],
    [1.7, 1000000, 0.95543438175482561966],
    [1.75, 1000000, 0.95994068979172606048],
    [3, 1000000, 0.99865006872928910147],
    [-40, 1000000000, 3.6582369848466825615e-350],
    [-6, 1000000000, 9.865879822492459432e-10],
    [-2, 1000000000, 0.022750132083156623547],
    [-1e-4, 1000000000, 0.49996010577203632067],
    [-1e-8, 1000000000, 0.49999999601057719698],
    [-1e-12, 1000000000, 0.49999999999960105772],
    [1e-9, 1000000000, 0.5000000003989422803],
    [0.5, 1000000000, 0.69146246121900289634],
    [1.7, 1000000000, 0.95543453708597032335],
    [1.75, 1000000000, 0.95994084298283845619],
    [3, 1000000000, 0.99865010193513104217],
  ];

  // Declared: 1e-11 up to ν = 1e5, where the continued fraction in
  // x = ν/(ν + t²) loses about ν·1e-17 near x = 1; 1e-13 above, where the series
  // in 1/ν takes over (for |t| <= 8; every row here is).
  const quantileTolerance = (nu: number): number => (nu <= 1e5 ? 1e-11 : 1e-13);

  it.each(quantiles)("studentTQuantile(%d, ν = %d) agrees with the reference", (p, nu, expected) => {
    expect(relativeError(studentTQuantile(p, nu), expected)).toBeLessThanOrEqual(quantileTolerance(nu));
  });

  it.each(distribution)("studentTCdf(%d, ν = %d) agrees with the reference", (t, nu, expected) => {
    // Relative on the lower tail, where the value is small; a unit in the last
    // place of 1 on the upper side, where it is not.
    const tolerance = t < 0 ? expected * quantileTolerance(nu) : 4e-16 + expected * quantileTolerance(nu) * (1 - expected);
    expect(Math.abs(studentTCdf(t, nu) - expected)).toBeLessThanOrEqual(tolerance);
  });

  it("reproduces the closed forms for ν = 1 (Cauchy) and ν = 2", () => {
    for (const p of [0.6, 0.75, 0.9, 0.975, 0.999]) {
      expect(relativeError(studentTQuantile(p, 1), Math.tan(Math.PI * (p - 0.5)))).toBeLessThanOrEqual(1e-12);
      expect(relativeError(studentTQuantile(p, 2), (2 * p - 1) / Math.sqrt(2 * p * (1 - p)))).toBeLessThanOrEqual(1e-12);
    }
  });

  describe("0.5.0 corrections", () => {
    it("the median is exactly 0 for every ν (0.4.0: -1.5e-8 at ν = 2, -3.1e-5 at ν = 1e7)", () => {
      for (const nu of [0.5, 1, 2, 2.5, 30, 1e4, 1e6, 9_268_196, 1e7, 1e9, Number.POSITIVE_INFINITY]) {
        expect(studentTQuantile(0.5, nu)).toBe(0);
        expect(studentTCdf(0, nu)).toBe(0.5);
      }
    });

    it("the distribution function is not flat around t = 0 (0.4.0: exactly 0.5 for |t| < 1e-8·√ν)", () => {
      for (const nu of [1, 10, 1e4, 1e7]) {
        const below = studentTCdf(-1e-9, nu);
        const above = studentTCdf(1e-9, nu);
        expect(below).toBeLessThan(0.5);
        expect(above).toBeGreaterThan(0.5);
        // Around 0 the density is nearly constant: F(t) - ½ = t·f(0), f(0) between 1/π (ν = 1) and 1/√(2π).
        expect(0.5 - below).toBeGreaterThan(1e-9 * 0.318);
        expect(0.5 - below).toBeLessThan(1e-9 * 0.399);
        // Symmetric to the spacing of doubles just above ½.
        expect(Math.abs(above - 0.5 - (0.5 - below))).toBeLessThanOrEqual(2 ** -53);
      }
    });

    it("quantiles next to the median follow the density instead of the flat stretch", () => {
      // t_p ≈ (p - ½)·π for ν = 1.
      expect(relativeError(studentTQuantile(0.5 + 2 ** -30, 1), Math.tan(Math.PI * 2 ** -30))).toBeLessThanOrEqual(1e-6);
      expect(relativeError(studentTQuantile(0.5 - 2 ** -30, 1), -Math.tan(Math.PI * 2 ** -30))).toBeLessThanOrEqual(1e-6);
    });

    it("the quantile is odd around the median to the last bit", () => {
      for (const nu of [1, 3.7, 12, 1e3, 1e6]) {
        for (const p of [0.25, 0.125, 0.03125, 2 ** -12]) {
          expect(studentTQuantile(1 - p, nu)).toBe(-studentTQuantile(p, nu));
        }
      }
    });

    it("the far upper tail is as accurate as the lower one (0.4.0: 1.1e-6 at p = 1 - 1e-12)", () => {
      const p = 1 - 2 ** -40;
      expect(studentTQuantile(p, 10)).toBe(-studentTQuantile(2 ** -40, 10));
      // ν = 1: t = tan(π(p - ½)) = cot(π·2^-40).
      expect(relativeError(studentTQuantile(p, 1), 1 / Math.tan(Math.PI * 2 ** -40))).toBeLessThanOrEqual(1e-12);
    });

    it("a tail beyond √(max double) is still computed (0.4.0: P(T <= -1e200) = 0 for ν = 1)", () => {
      // Cauchy: P(T <= -t) = atan(1/t)/π.
      expect(relativeError(studentTCdf(-1e200, 1), 1 / (Math.PI * 1e200))).toBeLessThanOrEqual(1e-12);
      expect(relativeError(studentTCdf(-1e160, 0.05), 4.4856311e-9)).toBeLessThanOrEqual(1e-6);
    });

    it("a quantile no double can hold is an error, not √(max double) (0.4.0: 1.34e154 for ν = 0.001)", () => {
      expect(errorCode(() => studentTQuantile(0.975, 0.001))).toBe(ERROR_CODES.INVALID_STATISTIC_INPUT);
      expect(errorCode(() => studentTQuantile(0.025, 0.001))).toBe(ERROR_CODES.INVALID_STATISTIC_INPUT);
    });

    it("the incomplete beta continued fraction converges or says it did not (0.4.0: I_0.5(1e6, 1e6) = 0.4997)", () => {
      expect(Math.abs(regularizedIncompleteBeta(0.5, 1e6, 1e6) - 0.5)).toBeLessThanOrEqual(1e-8);
      expect(errorCode(() => regularizedIncompleteBeta(0.5, 1e12, 1e12))).toBe(ERROR_CODES.INVALID_STATISTIC_INPUT);
    });

    it("the normal distribution function is exact at 0 and agrees with its quantile (0.4.0: erf(0) = 1e-9)", () => {
      expect(studentTCdf(0, Number.POSITIVE_INFINITY)).toBe(0.5);
      expect(relativeError(studentTCdf(-3, Number.POSITIVE_INFINITY), 0.0013498980316300945267)).toBeLessThanOrEqual(1e-13);
      expect(relativeError(studentTCdf(-37, Number.POSITIVE_INFINITY), 5.7255712225239266e-300)).toBeLessThanOrEqual(1e-11);
    });
  });

  describe("0.6.0: large ν", () => {
    it("has no step where the series in 1/ν takes over (ν = 1e5), nor at 1e7 (0.5.0: 1.25e-7 there)", () => {
      for (const p of [0.6, 0.975, 0.97725, 0.995, 0.999999]) {
        for (const nu of [1e5, 1e7]) {
          const below = studentTQuantile(p, nu);
          const above = studentTQuantile(p, nu + 1);
          // t_p decreases with ν by about (z³ + z)/(4ν²) per unit of ν.
          expect(below).toBeGreaterThan(above);
          const expectedDrop = (below ** 3 + below) / (4 * nu * nu);
          expect(Math.abs(below - above - expectedDrop)).toBeLessThanOrEqual(1e-11 * below);
        }
      }
    });

    it("tends to the normal quantile as (z² + 1)/(4ν)", () => {
      for (const p of [0.841345, 0.97725, 0.9995]) {
        const z = normalQuantile(p);
        for (const nu of [1e6, 1e9, 1e12]) {
          const excess = studentTQuantile(p, nu) / z - 1;
          expect(Math.abs(excess - (z * z + 1) / (4 * nu))).toBeLessThanOrEqual(1e-14 + 10 / (nu * nu));
        }
        expect(studentTQuantile(p, 1e300)).toBe(studentTQuantile(p, 1e200));
        expect(relativeError(studentTQuantile(p, 1e300), z)).toBeLessThanOrEqual(1e-14);
      }
    });

    it("the distribution function and the quantile are inverse of each other above 1e5", () => {
      for (const nu of [100001, 1e6, 1e9, 1e15]) {
        for (const p of [1e-12, 0.001, 0.02275, 0.3, 0.7, 0.975, 0.999999]) {
          const roundTrip = studentTCdf(studentTQuantile(p, nu), nu);
          expect(Math.abs(roundTrip - p)).toBeLessThanOrEqual(4e-16 + 1e-13 * Math.min(p, 1 - p));
        }
      }
    });

    it("a tail below the smallest double is 0, not an error", () => {
      expect(studentTCdf(-41, 1e6)).toBe(0);
      expect(studentTCdf(41, 1e6)).toBe(1);
      expect(studentTCdf(-1e200, 1e9)).toBe(0);
    });
  });
});

describe("the calculation fingerprint does not depend on the locale of the process", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const quantity = { standardUncertainty: "0.1", degreesOfFreedom: 10 };
  const model = {
    formula: "s + t + z + B + a",
    quantities: {
      s: { estimate: "1", ...quantity },
      t: { estimate: "2", ...quantity },
      z: { estimate: "3", ...quantity },
      B: { estimate: "4", ...quantity },
      a: { estimate: "5", ...quantity },
    },
  };

  it("orders the declared relationships without localeCompare (0.4.0: et-EE sorted z before t and changed the fingerprint)", () => {
    const localeCompare = vi.spyOn(String.prototype, "localeCompare");
    const engine = createCalculationEngine({ numericMode: "decimal" });
    engine.evaluateMeasurementModel({ ...model, correlations: [["s", "z", "0.5"], ["s", "t", "0.5"], ["B", "a", "0.25"]] });
    expect(localeCompare).not.toHaveBeenCalled();
  });

  it("gives one fingerprint for the same relationships declared in any order", () => {
    const engine = createCalculationEngine({ numericMode: "decimal" });
    const first = engine.evaluateMeasurementModel({ ...model, correlations: [["s", "z", "0.5"], ["s", "t", "0.5"], ["B", "a", "0.25"]] });
    const second = engine.evaluateMeasurementModel({ ...model, correlations: [["B", "a", "0.25"], ["s", "t", "0.5"], ["s", "z", "0.5"]] });
    expect(second.calculationFingerprint).toBe(first.calculationFingerprint);
  });
});
