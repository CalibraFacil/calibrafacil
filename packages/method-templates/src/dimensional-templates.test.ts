import { describe, expect, test } from "vitest";

import { checkMethodDraftDimensions } from "@calibra-facil/method-definition";

import { forceIndicationTemplate } from "./templates/force-indication";
import { humidityMagnusTemplate } from "./templates/humidity-magnus";
import { weighingInstrumentTemplate } from "./templates/weighing-instrument";
import * as massBalance from "./templates/mass-balance";
import { TEMPLATE_REGISTRY } from "./registry";

/**
 * REQ-DIM-102 (the false-positive guard): the REAL platform templates are
 * imported (never copy-pasted) and their compiled drafts must produce ZERO
 * dimensional diagnostics. A false positive here would block publishing a
 * correct method.
 */
describe("REQ-DIM-102 real templates are dimensionally coherent", () => {
  test("the humidity Magnus template produces zero diagnostics", () => {
    const draft = humidityMagnusTemplate.buildDraft();
    expect(checkMethodDraftDimensions(draft)).toEqual([]);
  });

  test("the force-indication template produces zero diagnostics", () => {
    const draft = forceIndicationTemplate.buildDraft();
    expect(checkMethodDraftDimensions(draft)).toEqual([]);
  });

  test("the weighing-instrument (mass) template produces zero diagnostics", () => {
    const draft = weighingInstrumentTemplate.buildDraft();
    expect(checkMethodDraftDimensions(draft)).toEqual([]);
  });

  test("the lab mass-balance template produces zero diagnostics", () => {
    const draft = massBalance.buildDraft();
    expect(checkMethodDraftDimensions(draft)).toEqual([]);
  });

  test("every platform template in the registry produces zero diagnostics", () => {
    for (const template of Object.values(TEMPLATE_REGISTRY)) {
      const draft = template.buildDraft();
      const diagnostics = checkMethodDraftDimensions(draft);
      expect(
        diagnostics,
        `${template.key} should be dimensionally coherent, got ${JSON.stringify(diagnostics)}`,
      ).toEqual([]);
    }
  });
});
