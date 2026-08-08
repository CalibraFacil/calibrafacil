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
    // Bumped by the fixed-layout work (#865): media_indicacao_antes/apos moved
    // from role "primary_result" to "mean_indication" so a generic certificate
    // layout can tell the indication column from the error column. NOT a
    // metrology change — no expression, unit or constant moved, and every
    // computed value is identical. The fingerprint covers reporting metadata,
    // so it still churns, which means production's seeded method id=6 has to be
    // re-seeded (EXEMPLO_FORCE_METHOD_TEMPLATE_UPDATE) before it matches again.
    // Previous: method:a614c64c40b142acec5681ffe73c8de04b15fa223300103599efdde750394da4
    fingerprint:
      "method:c867d03d82615597ab28a318d6da7d3b6c47e8edf496622e987c10bff37ac624",
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
