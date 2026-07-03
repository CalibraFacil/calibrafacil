/**
 * DOM-11 (#664) — automated gate: shipped math engine ↔ validated dossier.
 *
 * CUT-LINE: a divergence between the engine running in production and the
 * validated dossier in `validation/math-engine/` would otherwise pass silently.
 * This gate cross-reads BOTH sides — the engine's own `ENGINE_VERSION` / compiled
 * fingerprint AND the values declared by the current validated dossier — and
 * fails on any mismatch.
 *
 * "Vigente" (current) dossier = the highest-semver `vX.Y.Z` directory under
 * `validation/math-engine/` (there is no pointer file).
 *
 * Source of truth per dossier version: `manifest.json` next to `dossier.tex`.
 * `dossier.tex` declares the version machine-parseably (`\docVersion`) but records
 * no fingerprint value, so the manifest holds the human-ratified reference
 * fingerprint. The gate additionally checks the manifest's version against the
 * dossier prose so the two cannot drift apart unnoticed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "../engine/options.js";
import {
  computeEngineReferenceFingerprint,
  evaluateEngineDossierGate,
  parseDossierDeclaredVersion,
  parseDossierManifest,
  resolveCurrentDossierDir,
} from "./engine-dossier-gate.js";

const specDir = dirname(fileURLToPath(import.meta.url));
// packages/math-engine/src/audit → repo root is four levels up.
const repoRoot = resolve(specDir, "../../../..");
const validationRoot = join(repoRoot, "validation", "math-engine");

const dossierDirs = readdirSync(validationRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const currentDossierVersion = resolveCurrentDossierDir(dossierDirs);
if (currentDossierVersion === null) {
  throw new Error(
    `No versioned dossier directory found under ${validationRoot}.`,
  );
}

const currentDossierDir = join(validationRoot, currentDossierVersion);
const manifest = parseDossierManifest(
  JSON.parse(readFileSync(join(currentDossierDir, "manifest.json"), "utf8")),
);
const dossierTex = readFileSync(join(currentDossierDir, "dossier.tex"), "utf8");
const dossierDeclaredVersion = parseDossierDeclaredVersion(dossierTex);

describe("DOM-11: math engine ↔ validated dossier gate", () => {
  describe("REQ-DOM-GAT-001: ENGINE_VERSION matches the current validated dossier", () => {
    it("REQ-DOM-GAT-001 — dossier.tex declares a machine-parseable \\docVersion", () => {
      expect(dossierDeclaredVersion).not.toBeNull();
    });

    it("REQ-DOM-GAT-001 — ENGINE_VERSION equals the version declared in dossier.tex", () => {
      // Core cross-check: the shipped engine constant vs. the human-authored
      // dossier's declared version. Bumping the engine without re-validating the
      // dossier (or vice-versa) fails here.
      expect(ENGINE_VERSION).toBe(dossierDeclaredVersion);
    });

    it("REQ-DOM-GAT-001 — the current dossier is the highest-semver directory", () => {
      expect(dossierDirs).toContain(currentDossierVersion);
      expect(`v${manifest.engineVersion}`).toBe(currentDossierVersion);
    });

    it("REQ-DOM-GAT-001 — manifest.json version agrees with dossier.tex and ENGINE_VERSION", () => {
      expect(manifest.engineVersion).toBe(dossierDeclaredVersion);
      expect(manifest.engineVersion).toBe(ENGINE_VERSION);
    });

    it("REQ-DOM-GAT-001 — a divergent engine version SHALL be reported as a mismatch", () => {
      const result = evaluateEngineDossierGate(
        { version: "9.9.9-divergent", fingerprint: manifest.fingerprint },
        manifest,
      );
      expect(result.ok).toBe(false);
      expect(result.mismatches.map((m) => m.field)).toContain("engineVersion");
    });
  });

  describe("REQ-DOM-GAT-002: engine fingerprint matches the one recorded in the dossier", () => {
    it("REQ-DOM-GAT-002 — recompiling the reference model reproduces the recorded fingerprint", () => {
      const engineFingerprint = computeEngineReferenceFingerprint(
        manifest.referenceFormula,
      );
      expect(engineFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
      // Live engine side vs. the pinned manifest side. A change to the engine's
      // compilation/normalization behavior diverges from the ratified value.
      expect(engineFingerprint).toBe(manifest.fingerprint);
    });

    it("REQ-DOM-GAT-002 — the full gate passes for the shipped engine", () => {
      const result = evaluateEngineDossierGate(
        {
          version: ENGINE_VERSION,
          fingerprint: computeEngineReferenceFingerprint(
            manifest.referenceFormula,
          ),
        },
        manifest,
      );
      expect(result).toStrictEqual({ ok: true, mismatches: [] });
    });

    it("REQ-DOM-GAT-002 — a divergent fingerprint SHALL be reported as a mismatch", () => {
      const result = evaluateEngineDossierGate(
        {
          version: ENGINE_VERSION,
          fingerprint: `sha256:${"0".repeat(64)}`,
        },
        manifest,
      );
      expect(result.ok).toBe(false);
      expect(result.mismatches.map((m) => m.field)).toContain("fingerprint");
    });
  });
});
