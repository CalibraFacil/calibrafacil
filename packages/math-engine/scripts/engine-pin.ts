/**
 * `pnpm --filter @calibra-facil/math-engine run engine:pin [-- --check]`
 *
 * Records the engine source pin and the golden propagation results in the
 * manifest of the CURRENT validated dossier (highest-semver directory under
 * `validation/math-engine/`), for a deliberate release.
 *
 * Release procedure (see validation/math-engine/v0.4.0/README.md):
 *   1. bump ENGINE_VERSION and the package.json version together;
 *   2. create `validation/math-engine/v<new>/` with `dossier.tex` and a
 *      `manifest.json` copied from the previous version WITHOUT its `sourcePin`
 *      and `propagationGoldens` members, and update `engineVersion`/`fingerprint`;
 *   3. run this script to record the new pin and goldens;
 *   4. review the numerical diff against the previous version in the dossier.
 *
 * A manifest that already carries a pin is IMMUTABLE: a validated version's
 * evidence is never rewritten. If the pin no longer matches the source the
 * script refuses and tells you to bump the version instead of re-pinning.
 *
 * `--check` writes nothing and exits non-zero when the manifest has no pin or
 * the pin does not match.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCurrentDossierDir } from "../src/audit/engine-dossier-gate.js";
import { buildManifestGoldens, parseManifestGoldens } from "../src/audit/propagation-goldens.js";
import {
  SOURCE_PIN_ALGORITHM,
  computeSourcePin,
  describeSourcePinDifference,
  diffSourcePins,
  parseManifestSourcePin,
} from "../src/audit/source-pin.js";
import { canonicalJson } from "../src/audit/canonical-json.js";
import { ENGINE_VERSION } from "../src/engine/options.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validationRoot = resolve(packageRoot, "../../validation/math-engine");
const checkOnly = process.argv.slice(2).includes("--check");

function fail(message: string): never {
  console.error(`engine:pin: ${message}`);
  process.exit(1);
}

const currentDirectory = resolveCurrentDossierDir(
  readdirSync(validationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
if (currentDirectory === null) fail(`no versioned dossier directory under ${validationRoot}.`);

const manifestPath = join(validationRoot, currentDirectory, "manifest.json");
const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
  fail(`${manifestPath} must be a JSON object.`);
}
if (!("engineVersion" in manifest) || manifest.engineVersion !== ENGINE_VERSION) {
  fail(
    `ENGINE_VERSION is ${ENGINE_VERSION} but the current dossier (${currentDirectory}) validates ` +
      `${"engineVersion" in manifest ? String(manifest.engineVersion) : "no version"}. ` +
      `Create validation/math-engine/v${ENGINE_VERSION}/ first (see the header of this script).`,
  );
}

const livePin = computeSourcePin(packageRoot);
const liveGoldens = buildManifestGoldens();
const pinnedPin = parseManifestSourcePin(manifest);
const pinnedGoldens = parseManifestGoldens(manifest);

if (pinnedPin !== null || pinnedGoldens !== null) {
  const problems: string[] = [];
  if (pinnedPin === null) {
    problems.push("sourcePin is missing");
  } else if (pinnedPin.sha256 !== livePin.sha256) {
    problems.push(`source differs from the pin (${describeSourcePinDifference(diffSourcePins(pinnedPin.files, livePin.files))})`);
  }
  if (pinnedGoldens === null) {
    problems.push("propagationGoldens is missing");
  } else if (canonicalJson(JSON.parse(JSON.stringify(pinnedGoldens))) !== canonicalJson(JSON.parse(JSON.stringify(liveGoldens)))) {
    problems.push("golden propagation results differ from the pinned ones");
  }
  if (problems.length === 0) {
    console.log(`engine:pin: ${currentDirectory}/manifest.json is up to date (source ${livePin.sha256}).`);
    process.exit(0);
  }
  fail(
    `${currentDirectory}/manifest.json already carries pinned evidence and it does not match: ${problems.join("; ")}. ` +
      `A validated version's evidence is immutable. If the numerical behaviour is meant to change, bump ` +
      `ENGINE_VERSION and package.json, create the next validation/math-engine/v<version>/ dossier, and pin there.`,
  );
}

if (checkOnly) fail(`${currentDirectory}/manifest.json has no sourcePin / propagationGoldens yet.`);

const updated = {
  ...manifest,
  sourcePin: { algorithm: SOURCE_PIN_ALGORITHM, sha256: livePin.sha256, files: livePin.files },
  propagationGoldens: liveGoldens,
};
writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
console.log(
  `engine:pin: recorded source pin ${livePin.sha256} (${Object.keys(livePin.files).length} files) and ` +
    `${liveGoldens.length} golden models in ${currentDirectory}/manifest.json.`,
);
