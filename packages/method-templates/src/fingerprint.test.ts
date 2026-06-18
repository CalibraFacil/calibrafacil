import { describe, expect, it } from "vitest";
import { compileMethodDraft } from "@calibra-facil/method-definition";

import { createTemplateEngine, templateEngineMetadata } from "./engine";
import { getTemplate } from "./registry";
import type { TemplateKey } from "./types";

/**
 * Fingerprint-stability gate (vs production).
 *
 * Each fixture pins a template's compiled `methodFingerprint` to the value
 * stored on the production `calibration_method` row the seed maintains. The
 * template MUST reproduce it byte-for-byte — compiled exactly as the seed
 * compiles it (the seed passes NO preview scenarios), with the same
 * `methodId`/`version` the seed used. A drift here means a published method
 * would silently change; update a fixture only with a deliberate, reviewed
 * metrology change plus a coordinated re-seed.
 *
 * Source of truth: Neon project neon-project-id, calibration_method.
 */
const FINGERPRINT_FIXTURES: ReadonlyArray<{
  key: TemplateKey;
  methodId: number;
  version: number;
  fingerprint: string;
}> = [
  {
    key: "mass-balance",
    methodId: 6,
    version: 1,
    fingerprint:
      "method:a614c64c40b142acec5681ffe73c8de04b15fa223300103599efdde750394da4",
  },
];

describe("method-templates fingerprint stability (vs production)", () => {
  const engine = createTemplateEngine();
  const engineMetadata = templateEngineMetadata();

  for (const fixture of FINGERPRINT_FIXTURES) {
    it(`${fixture.key} reproduces the production fingerprint`, () => {
      const template = getTemplate(fixture.key);
      const result = compileMethodDraft(
        template.buildDraft({
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
