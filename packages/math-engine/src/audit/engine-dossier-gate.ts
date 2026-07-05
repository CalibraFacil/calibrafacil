import { createCalculationEngine } from "../engine/create.js";

/**
 * Machine-readable identity of a validated dossier version.
 *
 * The `dossier.tex` LaTeX source declares the validated package version as prose
 * (`\newcommand{\docVersion}{...}`) but records NO machine-readable fingerprint.
 * `manifest.json` sits next to `dossier.tex` as the parseable source of truth the
 * automated gate compares the shipped engine against. See DOM-11 (#664).
 */
export interface DossierManifest {
  /** Validated `ENGINE_VERSION` — MUST match `\docVersion` in the same `dossier.tex`. */
  readonly engineVersion: string;
  /**
   * Canonical reference model the gate recompiles to obtain a deterministic,
   * runtime-stable engine fingerprint. Kept free of numeric literals and
   * transcendental calls so the SHA-256 fingerprint is reproducible bit-for-bit
   * across Node, Bun, the browser preview and the container worker.
   */
  readonly referenceFormula: string;
  /**
   * `formulaFingerprint` (a `sha256:` canonical digest over the frozen AST +
   * compilation options + engine version) produced by compiling `referenceFormula`
   * with the validated engine. A human ratifies this pinned value; the gate fails
   * if the running engine no longer reproduces it.
   */
  readonly fingerprint: string;
}

/** The identity of the engine actually shipping in the package. */
export interface EngineIdentity {
  readonly version: string;
  readonly fingerprint: string;
}

export interface GateMismatch {
  readonly field: "engineVersion" | "fingerprint";
  readonly engineValue: string;
  readonly dossierValue: string;
}

export interface GateResult {
  readonly ok: boolean;
  readonly mismatches: readonly GateMismatch[];
}

// `v<major>.<minor>.<patch>` with an optional pre-release/build suffix.
const SEMVER_DIR = /^v(\d+)\.(\d+)\.(\d+)(?:[-.].*)?$/;
const DOC_VERSION = /\\newcommand\{\\docVersion\}\{([^}]+)\}/;

type SemverTuple = readonly [number, number, number];

export function parseDossierVersionDir(name: string): SemverTuple | null {
  const match = SEMVER_DIR.exec(name);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a: SemverTuple, b: SemverTuple): number {
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

/**
 * Resolve the "vigente" (current) dossier: the highest-semver `vX.Y.Z` directory.
 * There is no pointer file, so highest version wins.
 */
export function resolveCurrentDossierDir(
  dirNames: readonly string[],
): string | null {
  let best: string | null = null;
  let bestKey: SemverTuple | null = null;
  for (const name of dirNames) {
    const key = parseDossierVersionDir(name);
    if (!key) continue;
    if (bestKey === null || compareSemver(key, bestKey) > 0) {
      best = name;
      bestKey = key;
    }
  }
  return best;
}

/** Extract the version declared as prose in `dossier.tex` (`\docVersion`). */
export function parseDossierDeclaredVersion(tex: string): string | null {
  const match = DOC_VERSION.exec(tex);
  const captured = match?.[1];
  return captured === undefined ? null : captured.trim();
}

function readStringField(entries: Map<string, unknown>, key: string): string {
  if (!entries.has(key)) {
    throw new Error(`Dossier manifest is missing required "${key}".`);
  }
  const value = entries.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Dossier manifest "${key}" must be a non-empty string.`);
  }
  return value;
}

/** Parse untrusted JSON into a {@link DossierManifest} without `as` assertions. */
export function parseDossierManifest(value: unknown): DossierManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Dossier manifest must be a JSON object.");
  }
  const entries = new Map<string, unknown>(Object.entries(value));
  return {
    engineVersion: readStringField(entries, "engineVersion"),
    referenceFormula: readStringField(entries, "referenceFormula"),
    fingerprint: readStringField(entries, "fingerprint"),
  };
}

/**
 * Compile the manifest's reference formula with the real engine and return its
 * `formulaFingerprint`. This is the live "engine side" of the fingerprint gate.
 */
export function computeEngineReferenceFingerprint(
  referenceFormula: string,
): string {
  const engine = createCalculationEngine();
  return engine.compileFormula(referenceFormula).formulaFingerprint;
}

/**
 * Pure comparison of the shipped engine against a validated dossier manifest.
 * Returns every mismatch so a caller can fail with a precise message; used both
 * by the gate spec and (given deliberately wrong input) to prove the gate catches
 * a divergence rather than tautologically passing.
 */
export function evaluateEngineDossierGate(
  engine: EngineIdentity,
  manifest: DossierManifest,
): GateResult {
  const mismatches: GateMismatch[] = [];
  if (engine.version !== manifest.engineVersion) {
    mismatches.push({
      field: "engineVersion",
      engineValue: engine.version,
      dossierValue: manifest.engineVersion,
    });
  }
  if (engine.fingerprint !== manifest.fingerprint) {
    mismatches.push({
      field: "fingerprint",
      engineValue: engine.fingerprint,
      dossierValue: manifest.fingerprint,
    });
  }
  return { ok: mismatches.length === 0, mismatches };
}
