import { describe, expect, it } from "vitest";
import { compileMethodDraft } from "@calibra-facil/method-definition";

import { createTemplateEngine, templateEngineMetadata } from "./engine";
import { listTemplates } from "./registry";

/**
 * The oracle. Every registered template must compile as publishable and pass
 * all of its preview scenarios. Preview scenarios are fed via the compile
 * option (kept out of the fingerprint) so they validate the metrology without
 * perturbing the method fingerprint.
 *
 * Step 0 of the /loop pack: flip a `previewScenarios.expected` value in a
 * template and this test must go RED.
 */
describe("method-templates registry — publishable oracle", () => {
  const engine = createTemplateEngine();
  const engineMetadata = templateEngineMetadata();

  for (const template of listTemplates()) {
    describe(template.key, () => {
      // A template that declares preview scenarios must be fully publishable;
      // one that doesn't (yet) need only compile cleanly. Publish-readiness is
      // additionally enforced at the API publish boundary.
      const hasScenarios = template.previewScenarios.length > 0;
      const result = compileMethodDraft(template.buildDraft(), {
        engine,
        engineMetadata,
        previewScenarios: [...template.previewScenarios],
        requirePublishable: hasScenarios,
        includePreviewScenariosInFingerprint: false,
      });

      it("compiles without errors", () => {
        if (!result.ok) {
          throw new Error(
            `compile failed:\n${result.diagnostics
              .map((d) => `  ${d.code}: ${d.message}`)
              .join("\n")}`,
          );
        }
        expect(result.ok).toBe(true);
      });

      it("passes every declared preview scenario", () => {
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        for (const preview of result.previewResults) {
          expect(preview.passed, `scenario "${preview.scenarioKey}"`).toBe(true);
        }
      });
    });
  }
});
