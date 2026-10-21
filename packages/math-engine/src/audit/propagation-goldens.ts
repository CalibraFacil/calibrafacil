/**
 * Golden propagation models: complete GUM results pinned in the dossier manifest.
 *
 * The dossier gate's reference fingerprint compiles one trivial formula, so it
 * says nothing about uncertainty propagation. These models exercise the full
 * path (Type A and Type B inputs, sensitivities, combined variance, Welch-
 * Satterthwaite, Student-t coverage factor, expanded uncertainty) and the gate
 * compares every output, as the exact text the engine emits, against the values
 * recorded in `validation/math-engine/v<ENGINE_VERSION>/manifest.json`.
 *
 * The outputs are pinned at full float64 precision on purpose: propagation runs
 * in binary64 (dossier, limitation 5), so the last digits are part of the
 * contract of a version. The models avoid transcendental functions, whose last
 * ULP is runtime-dependent (README, "Determinism scope"); `sqrt` is correctly
 * rounded and appears only inside the engine.
 *
 * Test fixtures, not engine code: excluded from the source pin. Changing a model
 * here without regenerating the manifest fails the gate (the manifest carries a
 * copy of each model).
 */

import { createCalculationEngine } from "../engine/create.js";
import { METHOD_ENGINE_OPTIONS } from "../engine/options.js";
import type { NumericOutput } from "../numeric/types.js";
import type { MeasurementModelInput, MeasurementModelResult } from "../gum/measurement.js";
import { canonicalJson, type CanonicalJsonValue } from "./canonical-json.js";

export interface PropagationGolden {
  readonly id: string;
  readonly description: string;
  readonly model: MeasurementModelInput;
}

export const PROPAGATION_GOLDENS: readonly PropagationGolden[] = [
  {
    id: "additive-type-a-type-b-finite-dof",
    description:
      "y = a + b1 + b2: Type A mean of five readings (nu 4), rectangular Type B with 24 assigned degrees of freedom, triangular Type B with infinite degrees of freedom; k from Student-t at nu_eff of about 36, p = 95.45 %.",
    model: {
      formula: "a + b1 + b2",
      quantities: {
        a: { repeatedObservations: [0.1835, 0.1835, 0.197, 0.2105, 0.2105] },
        b1: { estimate: 0, typeB: { distribution: "rectangular", halfWidth: 0.065 }, degreesOfFreedom: 24 },
        b2: { estimate: 0, typeB: { distribution: "triangular", halfWidth: 0.041 }, degreesOfFreedom: "Infinity" },
      },
      coverageProbability: 0.9545,
    },
  },
  {
    id: "nonlinear-thermal-expansion",
    description:
      "L = L0 (1 + alpha (T - 20)) + dl: product model with symbolic sensitivities, Type A temperature with 9 degrees of freedom, rectangular alpha, triangular dl, p = 95 %.",
    model: {
      formula: "L0 * (1 + alpha * (T - 20)) + dl",
      quantities: {
        L0: { estimate: "100.0004", standardUncertainty: "0.0003", degreesOfFreedom: 15 },
        alpha: { estimate: "0.0000115", typeB: { distribution: "rectangular", halfWidth: "0.000001" }, degreesOfFreedom: "Infinity" },
        T: { estimate: "23.4", standardUncertainty: "0.3", degreesOfFreedom: 9 },
        dl: { estimate: 0, typeB: { distribution: "triangular", halfWidth: "0.0002" }, degreesOfFreedom: "Infinity" },
      },
      coverageProbability: 0.95,
    },
  },
  {
    id: "nonlinear-quotient-and-power",
    description:
      "P = V^2 / R: quotient and integer power, sensitivities 2V/R and -V^2/R^2, small effective degrees of freedom (dominated by a three-reading Type A input), p = 95 %.",
    model: {
      formula: "V ^ 2 / R",
      quantities: {
        V: { repeatedObservations: ["12.341", "12.352", "12.347"] },
        R: { estimate: "47.5", standardUncertainty: "0.05", degreesOfFreedom: 12 },
      },
      coverageProbability: 0.95,
    },
  },
  {
    id: "correlated-generalized-welch-satterthwaite",
    description:
      "y = x + y1 + z with correlations x-y1 = 0.5 and y1-z = 0.3: shared-index cross-terms of the generalized nu_eff (Castrup 2010/2020 Eq. 46), p = 95 %.",
    model: {
      formula: "x + y1 + z",
      quantities: {
        x: { estimate: "10.01", standardUncertainty: "0.020", degreesOfFreedom: 6 },
        y1: { estimate: "9.98", standardUncertainty: "0.015", degreesOfFreedom: 8 },
        z: { estimate: "0.004", standardUncertainty: "0.010", degreesOfFreedom: 11 },
      },
      correlations: [
        ["x", "y1", "0.5"],
        ["y1", "z", "0.3"],
      ],
      coverageProbability: 0.95,
    },
  },
  {
    id: "explicit-coverage-factor",
    description:
      "y = gain * reading + offset with an explicitly assigned coverage factor k = 2 (the path that bypasses the Student-t quantile).",
    model: {
      formula: "gain * reading + offset",
      quantities: {
        gain: { estimate: "1.0002", standardUncertainty: "0.0001", degreesOfFreedom: "Infinity" },
        reading: { estimate: "250.00", standardUncertainty: "0.05", degreesOfFreedom: "Infinity" },
        offset: { estimate: "0.02", typeB: { distribution: "rectangular", halfWidth: "0.05" }, degreesOfFreedom: "Infinity" },
      },
      coverageFactor: 2,
    },
  },
];

/** The pinned outputs of one golden model, as the exact text the engine emits. */
export interface GoldenExpected {
  readonly value: string;
  readonly combinedStandardUncertainty: string;
  readonly effectiveDegreesOfFreedom: string;
  readonly coverageFactor: string;
  readonly expandedUncertainty: string;
  readonly sensitivityCoefficients: Readonly<Record<string, string>>;
  readonly calculationFingerprint: string;
}

export interface ManifestGolden {
  readonly id: string;
  readonly description: string;
  /** Copy of the model inputs, so the manifest is self-describing and drift in the TS fixture is caught. */
  readonly model: CanonicalJsonValue;
  readonly expected: GoldenExpected;
}

/** Evaluate a golden under the production configuration, as the certificate path does. */
export function evaluateGolden(golden: PropagationGolden): MeasurementModelResult {
  return createCalculationEngine(METHOD_ENGINE_OPTIONS).evaluateMeasurementModel(golden.model);
}

function outputText(value: NumericOutput | "Infinity", label: string): string {
  // The goldens run in decimal mode, where every output is canonical text.
  if (typeof value !== "string") throw new Error(`Golden output ${label} is not canonical text (numeric mode must be decimal).`);
  return value;
}

export function extractGoldenExpected(result: MeasurementModelResult): GoldenExpected {
  const sensitivityCoefficients: Record<string, string> = {};
  for (const [symbol, value] of Object.entries(result.sensitivityCoefficients)) {
    sensitivityCoefficients[symbol] = outputText(value, `sensitivityCoefficients.${symbol}`);
  }
  return {
    value: outputText(result.value, "value"),
    combinedStandardUncertainty: outputText(result.combinedStandardUncertainty, "combinedStandardUncertainty"),
    effectiveDegreesOfFreedom: outputText(result.effectiveDegreesOfFreedom, "effectiveDegreesOfFreedom"),
    coverageFactor: outputText(result.coverageFactor, "coverageFactor"),
    expandedUncertainty: outputText(result.expandedUncertainty, "expandedUncertainty"),
    sensitivityCoefficients,
    calculationFingerprint: result.calculationFingerprint,
  };
}

/** Names every output that differs between a pinned and a live golden result (empty when identical). */
export function diffGoldenExpected(pinned: GoldenExpected, live: GoldenExpected): readonly string[] {
  const differences: string[] = [];
  const scalarKeys = [
    "value",
    "combinedStandardUncertainty",
    "effectiveDegreesOfFreedom",
    "coverageFactor",
    "expandedUncertainty",
    "calculationFingerprint",
  ] as const;
  for (const key of scalarKeys) {
    if (pinned[key] !== live[key]) differences.push(`${key}: pinned ${pinned[key]}, engine ${live[key]}`);
  }
  const symbols = new Set([...Object.keys(pinned.sensitivityCoefficients), ...Object.keys(live.sensitivityCoefficients)]);
  for (const symbol of [...symbols].sort()) {
    const was = pinned.sensitivityCoefficients[symbol];
    const now = live.sensitivityCoefficients[symbol];
    if (was !== now) differences.push(`sensitivityCoefficients.${symbol}: pinned ${String(was)}, engine ${String(now)}`);
  }
  return differences;
}

/** The model as canonical JSON, for comparison with the manifest copy. */
export function canonicalGoldenModel(golden: PropagationGolden): string {
  return canonicalJson(JSON.parse(JSON.stringify(golden.model)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalJsonValue(value: unknown): value is CanonicalJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isCanonicalJsonValue);
  if (isRecord(value)) return Object.values(value).every(isCanonicalJsonValue);
  return false;
}

function readExpected(value: unknown, path: string): GoldenExpected {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  const text = (key: string): string => {
    const entry = value[key];
    if (typeof entry !== "string" || entry.length === 0) throw new Error(`${path}.${key} must be a non-empty string.`);
    return entry;
  };
  const sensitivities = value.sensitivityCoefficients;
  if (!isRecord(sensitivities)) throw new Error(`${path}.sensitivityCoefficients must be an object.`);
  const sensitivityCoefficients: Record<string, string> = {};
  for (const [symbol, entry] of Object.entries(sensitivities)) {
    if (typeof entry !== "string") throw new Error(`${path}.sensitivityCoefficients.${symbol} must be a string.`);
    sensitivityCoefficients[symbol] = entry;
  }
  return {
    value: text("value"),
    combinedStandardUncertainty: text("combinedStandardUncertainty"),
    effectiveDegreesOfFreedom: text("effectiveDegreesOfFreedom"),
    coverageFactor: text("coverageFactor"),
    expandedUncertainty: text("expandedUncertainty"),
    sensitivityCoefficients,
    calculationFingerprint: text("calculationFingerprint"),
  };
}

/** Parse the optional `propagationGoldens` member of a dossier manifest (untrusted JSON). */
export function parseManifestGoldens(manifest: unknown): readonly ManifestGolden[] | null {
  if (!isRecord(manifest) || !("propagationGoldens" in manifest)) return null;
  const list = manifest.propagationGoldens;
  if (!Array.isArray(list)) throw new Error('Dossier manifest "propagationGoldens" must be an array.');
  return list.map((entry, index) => {
    const path = `propagationGoldens[${index}]`;
    if (!isRecord(entry)) throw new Error(`${path} must be an object.`);
    const { id, description, model } = entry;
    if (typeof id !== "string" || id.length === 0) throw new Error(`${path}.id must be a non-empty string.`);
    if (typeof description !== "string") throw new Error(`${path}.description must be a string.`);
    if (!isCanonicalJsonValue(model)) throw new Error(`${path}.model must be JSON.`);
    return { id, description, model, expected: readExpected(entry.expected, `${path}.expected`) };
  });
}

/** Build the manifest entries for the current engine (used by `engine:pin`). */
export function buildManifestGoldens(): readonly ManifestGolden[] {
  return PROPAGATION_GOLDENS.map((golden) => ({
    id: golden.id,
    description: golden.description,
    model: JSON.parse(JSON.stringify(golden.model)),
    expected: extractGoldenExpected(evaluateGolden(golden)),
  }));
}
