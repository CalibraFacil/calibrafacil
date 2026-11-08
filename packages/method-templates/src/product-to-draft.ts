import {
  buildDefaultVariableBindings,
  mapPersistedStatus,
  methodFormulaToDefinitionFormula,
  methodInputToDefinitionInput,
  methodValidationToAcceptanceCriterion,
  methodVariableBindingToDefinitionInput,
  parseMethodDraft,
  safeMethodId,
  type MethodDraft,
} from "@calibra-facil/method-definition";

import type { BuildDraftArgs } from "./types";
import { stripUndefinedDeep } from "./util";

/**
 * Product-format definition (data fields, formulas, validations) -> a
 * method-definition draft, for every template, so each authors a SINGLE
 * representation. The conversion itself is `@calibra-facil/method-definition`'s
 * `product-format` (the one the API compiles stored methods with); the fingerprint
 * tests of this package guard the drafts against drift.
 */

/**
 * Faithful port of the seed's `buildDefinitionDraft`. Produces the same draft
 * (and therefore the same fingerprint) the seed compiles. `methodId`/`version`
 * are fingerprint inputs; `status` is stripped before fingerprinting.
 */

export type ProductDraftSource = {
  name: string;
  description?: string;
  assetTypeId?: string;
  dataFields: readonly Record<string, unknown>[];
  formulas: readonly Record<string, unknown>[];
  // GUM measurement models, already in method-definition shape — passed through,
  // not converted. Defaults to [] for templates using formula-based uncertainty
  // (mass-balance, force, …), so their drafts (and fingerprints) are unchanged.
  measurementModels?: readonly Record<string, unknown>[];
  validations?: readonly unknown[];
  metadata: Record<string, unknown>;
};

/**
 * Build a compilable method-definition draft from a template's product-format
 * definition (data fields, formulas, validations). Mirrors the seed's original
 * buildDefinitionDraft, generalized over its inputs.
 */
export function buildDraftFromProduct(
  source: ProductDraftSource,
  args: BuildDraftArgs = {},
): MethodDraft {
  const { methodId, version, status } = args;
  const definitionInputs: Record<string, unknown>[] = [];
  const seenInputKeys = new Set<string>();

  for (const input of source.dataFields.map(methodInputToDefinitionInput)) {
    const key = input.key;
    if (typeof key !== "string") continue;
    definitionInputs.push(input);
    seenInputKeys.add(key);
  }

  for (const binding of buildDefaultVariableBindings(source.dataFields)) {
    const input = methodVariableBindingToDefinitionInput(binding);
    if (!input) continue;
    const key = input.key;
    if (typeof key !== "string" || seenInputKeys.has(key)) continue;
    definitionInputs.push(input);
    seenInputKeys.add(key);
  }

  return parseMethodDraft(
    stripUndefinedDeep({
      id: safeMethodId(methodId ?? source.name),
      version: version ?? 1,
      status: mapPersistedStatus(status),
      name: source.name,
      description: source.description,
      assetTypeId: source.assetTypeId,
      inputs: definitionInputs,
      formulas: source.formulas.map(methodFormulaToDefinitionFormula),
      measurementModels: source.measurementModels ?? [],
      acceptanceCriteria: (source.validations ?? [])
        .map(methodValidationToAcceptanceCriterion)
        .filter((criterion) => criterion !== null),
      previewScenarios: [],
      metadata: source.metadata,
    }),
  );
}
