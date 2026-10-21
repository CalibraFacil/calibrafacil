/**
 * Source pin + golden propagation gate.
 *
 * Companion to engine-dossier-gate.spec.ts (REQ-DOM-GAT-001/002), which checks the
 * version strings and the fingerprint of one trivial formula. That gate cannot see
 * a change to the GUM propagation code, so this one pins:
 *
 *  - REQ-DOM-GAT-003: ENGINE_VERSION equals the package.json version;
 *  - REQ-DOM-GAT-004: the engine's numerical source hashes to the digest recorded in
 *    the current dossier's manifest. Changing the code without a new ENGINE_VERSION,
 *    a new dossier directory and a new manifest fails here;
 *  - REQ-DOM-GAT-005: complete results (value, u_c, nu_eff, k, U, sensitivities) of the
 *    golden models equal the ones recorded in the manifest, to the last digit.
 *
 * The version string is deliberately not derived from the hash: certificates and
 * dossiers cite "0.4.0". The hash pins the code to that identity.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../engine/options.js";
import { resolveCurrentDossierDir } from "./engine-dossier-gate.js";
import {
  PROPAGATION_GOLDENS,
  canonicalGoldenModel,
  diffGoldenExpected,
  evaluateGolden,
  extractGoldenExpected,
  parseManifestGoldens,
} from "./propagation-goldens.js";
import {
  aggregateSourceDigest,
  computeSourcePin,
  describeSourcePinDifference,
  diffSourcePins,
  listPinnedSourceFiles,
  parseManifestSourcePin,
} from "./source-pin.js";
import { canonicalJson } from "./canonical-json.js";

const specDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(specDir, "../..");
const validationRoot = resolve(packageRoot, "../../validation/math-engine");

const currentDossier = resolveCurrentDossierDir(
  readdirSync(validationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
if (currentDossier === null) throw new Error(`No versioned dossier directory under ${validationRoot}.`);

const manifestJson: unknown = JSON.parse(readFileSync(join(validationRoot, currentDossier, "manifest.json"), "utf8"));
const packageJson: unknown = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

const RELEASE_INSTRUCTION =
  "If the numerical behaviour is meant to change: bump ENGINE_VERSION and package.json together, create " +
  "validation/math-engine/v<new>/ (dossier.tex + manifest.json), and run `pnpm --filter @calibra-facil/math-engine run engine:pin`. " +
  "If it is not (refactor, comment): revert the change.";

describe("REQ-DOM-GAT-003: ENGINE_VERSION equals the package version", () => {
  it("REQ-DOM-GAT-003 — packages/math-engine/package.json declares the same version as ENGINE_VERSION", () => {
    const version = typeof packageJson === "object" && packageJson !== null && "version" in packageJson ? packageJson.version : undefined;
    expect(version).toBe(ENGINE_VERSION);
  });
});

describe("REQ-DOM-GAT-004: engine source is pinned to the validated version", () => {
  const pin = parseManifestSourcePin(manifestJson);

  it("REQ-DOM-GAT-004 — the current dossier manifest records a source pin", () => {
    expect(pin, `validation/math-engine/${currentDossier}/manifest.json has no sourcePin; run engine:pin`).not.toBeNull();
  });

  it("REQ-DOM-GAT-004 — the engine source on disk hashes to the pinned digest", () => {
    if (pin === null) throw new Error("manifest has no sourcePin");
    const live = computeSourcePin(packageRoot);
    const difference = describeSourcePinDifference(diffSourcePins(pin.files, live.files));
    expect(
      live.sha256,
      `Engine source no longer matches the code validated as ${ENGINE_VERSION} (${difference}). ${RELEASE_INSTRUCTION}`,
    ).toBe(pin.sha256);
  });

  it("REQ-DOM-GAT-004 — the pinned aggregate digest is consistent with the pinned per-file digests", () => {
    if (pin === null) throw new Error("manifest has no sourcePin");
    expect(aggregateSourceDigest(pin.files)).toBe(pin.sha256);
  });

  it("REQ-DOM-GAT-004 — the pinned file list equals the live file list", () => {
    if (pin === null) throw new Error("manifest has no sourcePin");
    expect(Object.keys(pin.files).sort()).toStrictEqual([...listPinnedSourceFiles(packageRoot)]);
  });

  it("REQ-DOM-GAT-004 — the propagation code is part of the pin", () => {
    const files = listPinnedSourceFiles(packageRoot);
    for (const required of [
      "src/gum/measurement.ts",
      "src/gum/statistics.ts",
      "src/uncertainty/type-a.ts",
      "src/uncertainty/type-b.ts",
      "src/numeric/decimal.ts",
      "src/numeric/backend.ts",
      "src/parser/parser.ts",
      "src/evaluator/evaluate.ts",
      "src/formula/derivative.ts",
      "src/engine/options.ts",
    ]) {
      expect(files).toContain(required);
    }
    expect(files.some((file) => file.endsWith(".spec.ts"))).toBe(false);
  });

  describe("the gate detects divergence (mutation checks on a scratch copy)", () => {
    const scratch = mkdtempSync(join(tmpdir(), "engine-pin-"));
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));

    function writeSource(root: string, relativePath: string, content: string): void {
      const target = join(root, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }

    function fixture(name: string): string {
      const root = join(scratch, name);
      writeSource(root, "src/gum/measurement.ts", "export const u = 1;\n");
      writeSource(root, "src/numeric/decimal.ts", "export const d = 2;\n");
      writeSource(root, "src/gum/measurement.spec.ts", "// not engine code\n");
      writeSource(root, "src/testing/index.ts", "// test helper\n");
      writeSource(root, "src/audit/engine-dossier-gate.ts", "// gate\n");
      return root;
    }

    it("REQ-DOM-GAT-004 — a one-character change to a propagation file changes the digest and is named", () => {
      const original = computeSourcePin(fixture("a"));
      const edited = fixture("b");
      writeSource(edited, "src/gum/measurement.ts", "export const u = 2;\n");
      const mutated = computeSourcePin(edited);
      expect(mutated.sha256).not.toBe(original.sha256);
      expect(diffSourcePins(original.files, mutated.files)).toStrictEqual({
        added: [],
        removed: [],
        changed: ["src/gum/measurement.ts"],
      });
    });

    it("REQ-DOM-GAT-004 — an added or removed engine file changes the digest", () => {
      const original = computeSourcePin(fixture("c"));
      const added = fixture("d");
      writeSource(added, "src/gum/new-rule.ts", "export const n = 3;\n");
      expect(computeSourcePin(added).sha256).not.toBe(original.sha256);
      expect(diffSourcePins(original.files, computeSourcePin(added).files).added).toStrictEqual(["src/gum/new-rule.ts"]);

      const removed = fixture("e");
      rmSync(join(removed, "src/numeric/decimal.ts"));
      expect(computeSourcePin(removed).sha256).not.toBe(original.sha256);
      expect(diffSourcePins(original.files, computeSourcePin(removed).files).removed).toStrictEqual(["src/numeric/decimal.ts"]);
    });

    it("REQ-DOM-GAT-004 — specs, test helpers and the gate machinery are not pinned; a new directory is", () => {
      const root = fixture("f");
      const original = computeSourcePin(root);
      writeSource(root, "src/gum/measurement.spec.ts", "// edited spec\n");
      writeSource(root, "src/testing/index.ts", "// edited helper\n");
      writeSource(root, "src/audit/engine-dossier-gate.ts", "// edited gate\n");
      expect(computeSourcePin(root).sha256).toBe(original.sha256);

      writeSource(root, "src/newdir/anything.ts", "export const x = 1;\n");
      expect(computeSourcePin(root).sha256).not.toBe(original.sha256);
    });

    it("REQ-DOM-GAT-004 — the digest does not depend on the checkout's line endings", () => {
      const lf = fixture("g");
      const crlf = fixture("h");
      writeSource(crlf, "src/gum/measurement.ts", "export const u = 1;\r\n");
      expect(computeSourcePin(crlf).sha256).toBe(computeSourcePin(lf).sha256);
    });
  });
});

describe("REQ-DOM-GAT-005: golden propagation results are pinned", () => {
  const pinned = parseManifestGoldens(manifestJson);

  it("REQ-DOM-GAT-005 — the current dossier manifest records the golden results", () => {
    expect(pinned, `validation/math-engine/${currentDossier}/manifest.json has no propagationGoldens; run engine:pin`).not.toBeNull();
  });

  it("REQ-DOM-GAT-005 — the manifest covers exactly the golden models, with identical inputs", () => {
    if (pinned === null) throw new Error("manifest has no propagationGoldens");
    expect(pinned.map((entry) => entry.id)).toStrictEqual(PROPAGATION_GOLDENS.map((golden) => golden.id));
    for (const golden of PROPAGATION_GOLDENS) {
      const entry = pinned.find((candidate) => candidate.id === golden.id);
      expect(entry && canonicalJson(entry.model)).toBe(canonicalGoldenModel(golden));
    }
  });

  it.each(PROPAGATION_GOLDENS.map((golden) => [golden.id, golden]))(
    "REQ-DOM-GAT-005 — %s reproduces value, u_c, nu_eff, k, U and sensitivities exactly",
    (_id, golden) => {
      if (pinned === null) throw new Error("manifest has no propagationGoldens");
      const entry = pinned.find((candidate) => candidate.id === golden.id);
      if (entry === undefined) throw new Error(`manifest has no golden ${golden.id}`);
      const differences = diffGoldenExpected(entry.expected, extractGoldenExpected(evaluateGolden(golden)));
      expect(
        differences,
        `Propagation output changed for ${golden.id} while ENGINE_VERSION is still ${ENGINE_VERSION}. ${RELEASE_INSTRUCTION}`,
      ).toStrictEqual([]);
    },
  );

  it("REQ-DOM-GAT-005 — the goldens exercise a Student-t k, a finite nu_eff and an explicit k", () => {
    if (pinned === null) throw new Error("manifest has no propagationGoldens");
    const finite = pinned.filter((entry) => entry.expected.effectiveDegreesOfFreedom !== "Infinity");
    expect(finite.length).toBeGreaterThanOrEqual(3);
    for (const entry of finite) {
      const nu = Number(entry.expected.effectiveDegreesOfFreedom);
      const k = Number(entry.expected.coverageFactor);
      // k from Student-t is strictly above the normal quantile (1.960 at 95 %).
      expect(k).toBeGreaterThan(1.96);
      expect(nu).toBeGreaterThan(0);
    }
    const explicit = pinned.find((entry) => entry.id === "explicit-coverage-factor");
    expect(Number(explicit?.expected.coverageFactor)).toBe(2);
  });

  it("REQ-DOM-GAT-005 — a drifted propagation output SHALL be reported (mutation check)", () => {
    const golden = PROPAGATION_GOLDENS[0];
    if (golden === undefined) throw new Error("no goldens");
    const live = extractGoldenExpected(evaluateGolden(golden));
    expect(diffGoldenExpected(live, live)).toStrictEqual([]);
    // Last-digit drift in k, as a changed Student-t routine would produce.
    const drifted = { ...live, coverageFactor: `${live.coverageFactor.slice(0, -1)}${live.coverageFactor.endsWith("9") ? "8" : "9"}` };
    expect(diffGoldenExpected(live, drifted).map((line) => line.split(":")[0])).toStrictEqual(["coverageFactor"]);
    const driftedSensitivity = { ...live, sensitivityCoefficients: { ...live.sensitivityCoefficients, a: "1.0000000000000002" } };
    expect(diffGoldenExpected(live, driftedSensitivity)).toHaveLength(1);
  });
});
