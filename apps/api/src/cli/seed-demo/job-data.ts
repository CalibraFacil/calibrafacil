import type { DemoTemplateKey } from "./methods";
import type { StandardKey } from "./standards";
import type { Rng } from "./prng";

/** What the technician types into the worksheet, plus the standards they used. */
export type ExecutionData = {
  data: Record<string, unknown>;
  standardKeys: StandardKey[];
};

type Specs = Readonly<Record<string, string | number>>;

function num(specs: Specs, key: string, fallback: number): number {
  const value = specs[key];
  return typeof value === "number" ? value : fallback;
}

/** Decimal places needed to print a resolution such as 0.0001 or 0.5. */
export function decimalsOf(resolution: number): number {
  if (!Number.isFinite(resolution) || resolution <= 0) return 0;
  let places = 0;
  let scaled = resolution;
  while (Math.abs(scaled - Math.round(scaled)) > 1e-9 && places < 9) {
    scaled *= 10;
    places += 1;
  }
  return places;
}

/** Rounds to the instrument's resolution, the way a display would show it. */
export function roundTo(value: number, resolution: number): number {
  const step = resolution > 0 ? resolution : 1e-9;
  const rounded = Math.round(value / step) * step;
  return Number(rounded.toFixed(decimalsOf(resolution)));
}

function isPerfectSquare(value: bigint): boolean {
  if (value < 0n) return false;
  if (value < 2n) return true;
  let low = 1n;
  let high = value;
  while (low <= high) {
    const mid = (low + high) / 2n;
    const square = mid * mid;
    if (square === value) return true;
    if (square < value) low = mid + 1n;
    else high = mid - 1n;
  }
  return false;
}

/** True when the sample standard deviation of the readings is an exact decimal (or zero). */
export function hasExactStandardDeviation(
  readings: number[],
  resolution: number,
): boolean {
  const n = BigInt(readings.length);
  const counts = readings.map((value) =>
    BigInt(Math.round(value / resolution)),
  );
  const sum = counts.reduce((total, count) => total + count, 0n);
  const sumSquares = counts.reduce((total, count) => total + count * count, 0n);
  const scaled = n * (n - 1n) * (n * sumSquares - sum * sum);
  return isPerfectSquare(scaled);
}

/**
 * Repeatability readings must not give a degenerate standard deviation. All
 * readings identical means zero Type A uncertainty (undefined effective degrees
 * of freedom); one that is an exact decimal makes the exact-arithmetic engine
 * divide a long irrational expansion by a short number and overflow its digit
 * limit. Real readings jitter by a count now and then: nudge the last reading by
 * one resolution step until neither happens.
 */
export function withSpread(readings: number[], resolution: number): number[] {
  if (readings.length < 2) return readings;
  const copy = [...readings];
  const last = copy.length - 1;
  for (
    let attempt = 0;
    attempt < 12 && hasExactStandardDeviation(copy, resolution);
    attempt += 1
  ) {
    copy[last] = roundTo(
      (copy[last] ?? 0) + (attempt % 2 === 0 ? 1 : -2) * resolution,
      resolution,
    );
  }
  return copy;
}

// --- weighing instruments -----------------------------------------------------

const LOAD_LADDER_G = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
];

// OIML R 111-1 E2 maximum permissible error in mg, indexed by nominal in g.
const E2_MPE_MG: ReadonlyArray<readonly [number, number]> = [
  [1, 0.04],
  [2, 0.05],
  [5, 0.06],
  [10, 0.08],
  [20, 0.1],
  [50, 0.12],
  [100, 0.16],
  [200, 0.3],
  [500, 0.8],
  [1000, 1.6],
  [2000, 3.2],
  [5000, 8],
  [10000, 16],
  [20000, 32],
];

/** Log-log interpolation of the E2 mpe table (mg) at a nominal load in grams. */
export function e2MpeMg(nominalG: number): number {
  const first = E2_MPE_MG[0];
  const last = E2_MPE_MG[E2_MPE_MG.length - 1];
  if (!first || !last) return 0;
  if (nominalG <= first[0]) return first[1];
  if (nominalG >= last[0]) return last[1];
  for (let i = 1; i < E2_MPE_MG.length; i += 1) {
    const lower = E2_MPE_MG[i - 1];
    const upper = E2_MPE_MG[i];
    if (!lower || !upper || nominalG > upper[0]) continue;
    const t =
      (Math.log(nominalG) - Math.log(lower[0])) /
      (Math.log(upper[0]) - Math.log(lower[0]));
    return Math.exp(
      Math.log(lower[1]) + t * (Math.log(upper[1]) - Math.log(lower[1])),
    );
  }
  return last[1];
}

/** Test loads: the five largest ladder steps that fit the balance capacity. */
export function weighingLoads(capacityG: number): number[] {
  return LOAD_LADDER_G.filter((load) => load <= capacityG).slice(-5);
}

function weighingStandard(capacityG: number): {
  standardKey: StandardKey;
  uncertaintyFactor: number;
} {
  if (capacityG <= 620)
    return { standardKey: "pesos-e2", uncertaintyFactor: 1 };
  if (capacityG <= 6200)
    return { standardKey: "pesos-f1", uncertaintyFactor: 3.1 };
  return { standardKey: "pesos-m1", uncertaintyFactor: 31 };
}

function buildWeighing(specs: Specs, rng: Rng): ExecutionData {
  const capacity = num(specs, "capacity", 220);
  const resolution = num(specs, "resolution", 0.0001);
  const { standardKey, uncertaintyFactor } = weighingStandard(capacity);
  const eccentricityLoad =
    LOAD_LADDER_G.filter((load) => load <= capacity / 3).pop() ?? 1;
  // Systematic offset of this particular instrument, in resolution steps.
  const bias = rng.normal(0, 0.8) * resolution;

  const rows = weighingLoads(capacity).map((nominal, index) => {
    const correction = ((index % 3) - 1) * 1.2e-7;
    const reference = Number((nominal * (1 + correction)).toFixed(7));
    const error = bias + rng.normal(0, 0.5 * resolution);
    const indication = roundTo(reference + error, resolution);
    const readings = withSpread(
      Array.from({ length: 5 }, () =>
        roundTo(indication + rng.normal(0, 0.45 * resolution), resolution),
      ),
      resolution,
    );
    return {
      m_ref: reference,
      indicacao: indication,
      incerteza_padrao: Number(
        (((e2MpeMg(nominal) / 3) * uncertaintyFactor) / 1000).toPrecision(3),
      ),
      k_referencia: 2,
      resolucao: resolution,
      rep_1: readings[0],
      rep_2: readings[1],
      rep_3: readings[2],
      rep_4: readings[3],
      rep_5: readings[4],
      excentricidade_max: roundTo(
        Math.abs(rng.normal(0, 1.1)) * resolution,
        resolution,
      ),
      carga_excentricidade: eccentricityLoad,
      u_empuxo: Number(
        (nominal * 8.9e-6 * Math.min(uncertaintyFactor, 1)).toPrecision(3),
      ),
      u_deriva: Number((nominal * 3.6e-7 * uncertaintyFactor).toPrecision(3)),
    };
  });

  return { data: { pontos_pesagem: rows }, standardKeys: [standardKey] };
}

// --- electrical (DC voltage) --------------------------------------------------

const DC_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.1, 2.2e-6],
  [1, 9e-6],
  [10, 4e-5],
  [100, 3.2e-4],
];

function buildElectrical(specs: Specs, rng: Rng): ExecutionData {
  const digits =
    typeof specs.displayDigits === "string" ? specs.displayDigits : "4½";
  const base = digits.startsWith("6")
    ? 1e-6
    : digits.startsWith("5")
      ? 1e-5
      : digits.startsWith("4")
        ? 1e-4
        : 1e-3;
  const bias = rng.normal(0, 1.5) * base;
  const rows = DC_POINTS.map(([reference, uncertainty]) => {
    const resolution = Math.max(base * Math.max(reference, 1), base);
    const readings = withSpread(
      Array.from({ length: 3 }, () =>
        roundTo(
          reference + bias * reference + rng.normal(0, 1.2 * resolution),
          resolution,
        ),
      ),
      resolution,
    );
    return {
      valor_referencia: reference,
      incerteza_referencia: uncertainty,
      k_referencia: 2,
      resolucao: resolution,
      leitura_1: readings[0],
      leitura_2: readings[1],
      leitura_3: readings[2],
    };
  });
  return { data: { pontos_tensao: rows }, standardKeys: ["calibrador"] };
}

// --- force ---------------------------------------------------------------------

function buildForce(specs: Specs, rng: Rng): ExecutionData {
  const capacity = num(specs, "capacity", 5000);
  const resolution = num(specs, "resolution", 1);
  const bias = rng.normal(0, 0.002);
  const rows = [0.2, 0.4, 0.6, 0.8, 1].map((fraction) => {
    const reference = roundTo(capacity * fraction, resolution);
    const readings = withSpread(
      Array.from({ length: 3 }, () =>
        roundTo(
          reference * (1 + bias) +
            rng.normal(0, Math.max(resolution, reference * 0.0006)),
          resolution,
        ),
      ),
      resolution,
    );
    return {
      valor_referencia: reference,
      incerteza_referencia: Number((reference * 0.0005 + 0.05).toPrecision(3)),
      k_referencia: 2,
      resolucao: resolution,
      u_deriva: 0,
      u_temperatura: 0,
      leitura_1: readings[0],
      leitura_2: readings[1],
      leitura_3: readings[2],
    };
  });
  return { data: { pontos_forca: rows }, standardKeys: ["celula-carga"] };
}

// --- frequency (tachometer) ----------------------------------------------------

function buildFrequency(specs: Specs, rng: Rng): ExecutionData {
  const rangeMax = num(specs, "rangeMax", 99999);
  const resolution = num(specs, "resolution", 1);
  const bias = rng.normal(0, 0.0004);
  const rows = [100, 500, 1500, 3000, 10000]
    .filter((rpm) => rpm <= rangeMax)
    .map((reference) => {
      const readings = withSpread(
        Array.from({ length: 3 }, () =>
          roundTo(
            reference * (1 + bias) +
              rng.normal(0, Math.max(resolution * 0.6, reference * 0.0002)),
            resolution,
          ),
        ),
        resolution,
      );
      return {
        valor_referencia: reference,
        incerteza_referencia: Number(
          (reference * 0.0001 + 0.02).toPrecision(3),
        ),
        k_referencia: 2,
        resolucao: resolution,
        u_deriva_padrao: 0,
        u_resolucao_referencia: 0,
        leitura_1: readings[0],
        leitura_2: readings[1],
        leitura_3: readings[2],
      };
    });
  return { data: { pontos_rotacao: rows }, standardKeys: ["tacometro"] };
}

/** Worksheet data for a calibration of the given method on an instrument with these specifications. */
export function buildExecutionData(
  templateKey: DemoTemplateKey,
  specs: Specs,
  rng: Rng,
): ExecutionData {
  switch (templateKey) {
    case "weighing-instrument":
      return buildWeighing(specs, rng);
    case "electrical-indication":
      return buildElectrical(specs, rng);
    case "force-indication":
      return buildForce(specs, rng);
    case "frequency-indication":
      return buildFrequency(specs, rng);
  }
}
