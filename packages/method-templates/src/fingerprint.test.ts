import { describe, expect, it } from "vitest";
import {
  compileMethodDraft,
  type MethodDraft,
} from "@calibra-facil/method-definition";

import { createTemplateEngine, templateEngineMetadata } from "./engine";
import { buildDraft as buildMassBalanceDraft } from "./templates/mass-balance";
import type { BuildDraftArgs } from "./types";

/**
 * Fingerprint-stability gate.
 *
 * Each fixture pins a lab-specific method's compiled `methodFingerprint`. The
 * module (e.g. `mass-balance.ts`, imported directly — it is NOT a platform
 * catalog template) MUST reproduce it byte-for-byte, compiled with no preview
 * scenarios and the same `methodId`/`version`. A drift here means a published
 * method would silently change; update a fixture only with a deliberate,
 * reviewed metrology change (or an engine release, which embeds
 * `engine.version` in every compiled method).
 */
const FINGERPRINT_FIXTURES: ReadonlyArray<{
  label: string;
  buildDraft: (args?: BuildDraftArgs) => MethodDraft;
  methodId: number;
  version: number;
  fingerprint: string;
}> = [
  {
    label: "mass-balance (example lab method, id=6)",
    buildDraft: buildMassBalanceDraft,
    methodId: 6,
    version: 1,
    fingerprint:
      "method:7deeb2cbe489497293dc6b271c90741e093de8be98f6b1525bba1252d0d0da7c",
  },
];

describe("lab-method fingerprint stability", () => {
  const engine = createTemplateEngine();
  const engineMetadata = templateEngineMetadata();

  for (const fixture of FINGERPRINT_FIXTURES) {
    it(`${fixture.label} reproduces the pinned fingerprint`, () => {
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
