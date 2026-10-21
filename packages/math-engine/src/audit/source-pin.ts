/**
 * Source pin: binds the engine's numerical source code to the validated version.
 *
 * `ENGINE_VERSION` is a hand-maintained string. Nothing structural stops a change
 * to the GUM propagation code (measurement.ts, type-a/type-b, Welch-Satterthwaite,
 * the coverage factor, the decimal backend) from landing without a version bump,
 * and the dossier gate's reference fingerprint only covers a trivial formula. This
 * module hashes the engine's source so that gate can fail when the code under a
 * validated version has changed.
 *
 * The version string itself is NOT derived from the hash: certificates and
 * dossiers cite "0.4.0", a human-readable release identity. The hash pins the code
 * to that identity; it does not replace it.
 *
 * Node-only (reads the file system). Deliberately not re-exported from the
 * package root: it is used by the gate spec and by `scripts/engine-pin.ts`.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Human-readable description of the pin algorithm, recorded in the manifest. */
export const SOURCE_PIN_ALGORITHM =
  "sha256 over the `<sha256(file)>  <path>\\n` listing (sha256sum format) of every " +
  "src/**/*.ts file except specs, src/testing/ and the gate machinery, paths POSIX " +
  "relative to the package root, sorted by code unit; CRLF normalised to LF before hashing";

/**
 * Files that are not engine code: the gate machinery itself and the golden
 * fixtures it replays. Everything else under `src/` that is not a spec or under
 * `src/testing/` is pinned, so a new directory is pinned by default.
 */
const EXCLUDED_FILES: ReadonlySet<string> = new Set([
  "src/audit/engine-dossier-gate.ts",
  "src/audit/source-pin.ts",
  "src/audit/propagation-goldens.ts",
]);
const EXCLUDED_DIRECTORIES: readonly string[] = ["src/testing/"];

function isPinnedSourceFile(relativePath: string): boolean {
  if (!relativePath.endsWith(".ts")) return false;
  if (relativePath.endsWith(".spec.ts") || relativePath.endsWith(".test.ts")) return false;
  if (EXCLUDED_FILES.has(relativePath)) return false;
  return !EXCLUDED_DIRECTORIES.some((directory) => relativePath.startsWith(directory));
}

function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function collectFiles(packageRoot: string, relativeDirectory: string, into: string[]): void {
  const entries = readdirSync(join(packageRoot, relativeDirectory), { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      collectFiles(packageRoot, relativePath, into);
    } else if (entry.isFile() && isPinnedSourceFile(relativePath)) {
      into.push(relativePath);
    }
  }
}

/** The pinned files, POSIX paths relative to the package root, sorted. */
export function listPinnedSourceFiles(packageRoot: string): readonly string[] {
  const files: string[] = [];
  collectFiles(packageRoot, "src", files);
  return files.sort(compareCodeUnits);
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** SHA-256 of a source file's bytes with CRLF normalised to LF (checkout-independent). */
function hashSourceFile(packageRoot: string, relativePath: string): string {
  const text = readFileSync(join(packageRoot, relativePath), "utf8");
  return sha256Hex(text.replaceAll("\r\n", "\n"));
}

export interface SourcePin {
  /** Aggregate digest: the single value the gate compares. */
  readonly sha256: string;
  /** Per-file digests, so a failure can name the files that changed. */
  readonly files: Readonly<Record<string, string>>;
}

export function aggregateSourceDigest(files: Readonly<Record<string, string>>): string {
  const listing = Object.keys(files)
    .sort(compareCodeUnits)
    .map((path) => `${files[path]}  ${path}\n`)
    .join("");
  return sha256Hex(listing);
}

/** Compute the pin of the engine source currently on disk. */
export function computeSourcePin(packageRoot: string): SourcePin {
  const files: Record<string, string> = {};
  for (const relativePath of listPinnedSourceFiles(packageRoot)) {
    files[relativePath] = hashSourceFile(packageRoot, relativePath);
  }
  return { sha256: aggregateSourceDigest(files), files };
}

export interface SourcePinDifference {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

export function diffSourcePins(
  pinned: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): SourcePinDifference {
  const added = Object.keys(actual).filter((path) => !(path in pinned));
  const removed = Object.keys(pinned).filter((path) => !(path in actual));
  const changed = Object.keys(actual).filter((path) => path in pinned && pinned[path] !== actual[path]);
  return {
    added: added.sort(compareCodeUnits),
    removed: removed.sort(compareCodeUnits),
    changed: changed.sort(compareCodeUnits),
  };
}

export function describeSourcePinDifference(difference: SourcePinDifference): string {
  const parts: string[] = [];
  if (difference.changed.length > 0) parts.push(`changed: ${difference.changed.join(", ")}`);
  if (difference.added.length > 0) parts.push(`added: ${difference.added.join(", ")}`);
  if (difference.removed.length > 0) parts.push(`removed: ${difference.removed.join(", ")}`);
  return parts.length === 0 ? "no per-file difference (aggregate digest only)" : parts.join("; ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

/** Parse the optional `sourcePin` member of a dossier manifest (untrusted JSON). */
export function parseManifestSourcePin(manifest: unknown): SourcePin | null {
  if (!isRecord(manifest) || !("sourcePin" in manifest)) return null;
  const candidate = manifest.sourcePin;
  if (!isRecord(candidate)) throw new Error('Dossier manifest "sourcePin" must be a JSON object.');
  const { sha256, files } = candidate;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error('Dossier manifest "sourcePin.sha256" must be a lowercase hex SHA-256.');
  }
  if (!isStringRecord(files)) {
    throw new Error('Dossier manifest "sourcePin.files" must map paths to digests.');
  }
  return { sha256, files };
}
