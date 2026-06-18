import { describe, expect, it } from "vitest";
import {
  compileMethodDraft,
  type MethodDraft,
} from "@calibra-facil/method-definition";

import { createTemplateEngine, templateEngineMetadata } from "./engine";
import { buildDraft as buildMassBalanceDraft } from "./templates/mass-balance";
import type { BuildDraftArgs } from "./types";

/**
 * Fingerprint-stability gate (vs production).
 *
 * Each fixture pins a SEEDED, lab-specific method's compiled `methodFingerprint`
 * to the value stored on its production `calibration_method` row. The seed-content
 * module (e.g. `mass-balance.ts` for Exemplo, imported directly — it is NOT a
 * platform catalog template) MUST reproduce it byte-for-byte: compiled exactly as
 * the seed compiles it (no preview scenarios), with the same `methodId`/`version`.
 * A drift here means a published method would silently change; update a fixture
 * only with a deliberate, reviewed metrology change plus a coordinated re-seed.
 *
 * Source of truth: Neon project neon-project-id, calibration_method.
 */
const FINGERPRINT_FIXTURES: ReadonlyArray<{
  label: string;
  buildDraft: (args?: BuildDraftArgs) => MethodDraft;
  methodId: number;
  version: number;
  fingerprint: string;
}> = [
  {
    label: "mass-balance (Exemplo, seeded method id=6)",
    buildDraft: buildMassBalanceDraft,
    methodId: 6,
    version: 1,
    fingerprint:
      "method:a614c64c40b142acec5681ffe73c8de04b15fa223300103599efdde750394da4",
  },
];

describe("seeded-method fingerprint stability (vs production)", () => {
  const engine = createTemplateEngine();
  const engineMetadata = templateEngineMetadata();

  for (const fixture of FINGERPRINT_FIXTURES) {
    it(`${fixture.label} reproduces the production fingerprint`, () => {
      const result = compileMethodDraft(
        fixture.buildDraft({
          methodId: fixture.methodId,
          version: fixture.version,
        }),
        { engine, engineMetadata },
      );
      if (!result.ok) {
        throw new Error(
          `compile failed:\n${result.diagnostics
            .map((d) => `  ${d.code}: ${d.message}`)
            .join("\n")}`,
        );
      }
      expect(result.method.methodFingerprint).toBe(fixture.fingerprint);
    });
  }
});
