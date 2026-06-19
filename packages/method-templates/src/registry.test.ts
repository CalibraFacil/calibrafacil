import { describe, expect, it } from "vitest";
import { compileMethodDraft } from "@calibra-facil/method-definition";

import { createTemplateEngine, templateEngineMetadata } from "./engine";
import { listTemplates } from "./registry";
import type { TemplateModule } from "./types";

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

/**
 * Every identifier a `governance.verificarItems[].fieldKeys` entry is allowed to
 * reference: input/column keys, formula output keys, uncertainty-component names,
 * and measurement-model quantity symbols, gathered from the product definition.
 */
function collectDefinitionKeys(template: TemplateModule): Set<string> {
  const keys = new Set<string>();
  const KEY_PROPS = new Set(["key", "outputKey", "name", "symbol"]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [prop, val] of Object.entries(value)) {
        if (KEY_PROPS.has(prop) && typeof val === "string") keys.add(val);
        visit(val);
      }
    }
  };
  const def = template.productDefinition;
  visit(def.dataFields);
  visit(def.formulas);
  visit(def.uncertaintyParams);
  visit(def.measurementModels);
  return keys;
}

/**
 * Governance contract for the from-template picker. A template that ships a
 * `governance` block must keep it structurally honest — so the disclosed context
 * can never silently drift from the compiled definition. (Templates without
 * governance are filtered out of the catalog endpoint; they never render as a
 * bare "trust-me" card.)
 */
describe("method-templates governance — picker contract", () => {
  for (const template of listTemplates()) {
    const governance = template.governance;
    if (!governance) continue;

    describe(template.key, () => {
      it("is complete (summary, measurand, sources, verificarItems, reviewStatus)", () => {
        expect(governance.summary.trim().length).toBeGreaterThan(0);
        expect(governance.measurand.trim().length).toBeGreaterThan(0);
        expect(governance.sources.length).toBeGreaterThan(0);
        expect(governance.verificarItems.length).toBeGreaterThan(0);
        expect(governance.reviewStatus).toBe("draft_pending_revalidation");
        for (const source of governance.sources) {
          expect(source.title.trim().length, "source title").toBeGreaterThan(0);
          expect(
            source.edition.trim().length,
            "source edition",
          ).toBeGreaterThan(0);
        }
      });

      it("verificarItems fieldKeys resolve to real definition keys", () => {
        const known = collectDefinitionKeys(template);
        for (const item of governance.verificarItems) {
          for (const fieldKey of item.fieldKeys ?? []) {
            expect(known.has(fieldKey), `fieldKey "${fieldKey}"`).toBe(true);
          }
        }
      });

      it("does not understate the literal [VERIFICAR] markers in the definition", () => {
        const serialized = JSON.stringify(
          template.productDefinition.certificateContent ?? {},
        );
        const literalMarkers = serialized.split("[VERIFICAR]").length - 1;
        expect(governance.verificarItems.length).toBeGreaterThanOrEqual(
          literalMarkers,
        );
      });

      const workedExample = governance.workedExample;
      if (workedExample) {
        it("workedExample.scenarioKey exists in previewScenarios", () => {
          const scenarioKeys = template.previewScenarios.map((s) => s.key);
          expect(scenarioKeys).toContain(workedExample.scenarioKey);
        });

        if (workedExample.provenance === "cited_guide_table") {
          it("cited_guide_table workedExample matches its scenario's shipped expected", () => {
            expect(workedExample.source.trim().length).toBeGreaterThan(0);
            const scenario = template.previewScenarios.find(
              (s) => s.key === workedExample.scenarioKey,
            );
            const formulas = scenario?.expected?.formulas ?? {};
            for (const [key, value] of Object.entries(workedExample.expected)) {
              // Row-scoped methods store per-row arrays; a worked example is one
              // representative point, so compare against the first row.
              const shipped = formulas[key];
              const representative = Array.isArray(shipped) ? shipped[0] : shipped;
              expect(representative, `expected.${key}`).toBe(value);
            }
          });
        }
      }

      it("governance prose is pt-BR (no English stopwords)", () => {
        // High-signal English words with clear pt-BR equivalents that must never
        // appear in user-facing governance prose. Source TITLES (proper guide
        // names) are intentionally excluded; formula expressions/refs are pt-BR-safe.
        const EN_STOPWORDS =
          /\b(the|and|with|assumed|uncertainty|readings?|weights?|combined?|applies|OMITTED)\b/i;
        const prose = [
          governance.summary,
          governance.measurand,
          ...governance.conformanceNotes.map((note) => note.note),
          ...governance.verificarItems.map((entry) => entry.item),
          ...governance.omittedComponents.map((component) => component.component),
          ...governance.omittedComponents.map(
            (component) => component.appliesWhen ?? "",
          ),
        ];
        for (const text of prose) {
          const match = EN_STOPWORDS.exec(text);
          expect(
            match,
            `English stopword "${match?.[0] ?? ""}" in: ${text.slice(0, 70)}`,
          ).toBeNull();
        }
      });
    });
  }
});
