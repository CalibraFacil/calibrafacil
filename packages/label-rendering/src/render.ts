import type { PrinterLanguage } from "@calibra-facil/schemas";

import { tsplRenderer } from "./tspl/renderer";
import type { LabelInput, LabelRenderer, LabelRenderOptions } from "./types";
import { zplRenderer } from "./zpl/renderer";

const RENDERERS: Record<PrinterLanguage, LabelRenderer> = {
  zpl: zplRenderer,
  tspl: tsplRenderer,
};

/** The renderer for a printer command language. */
export function getRenderer(language: PrinterLanguage): LabelRenderer {
  return RENDERERS[language];
}

/** Render a calibration label in the language named by `options.language`. */
export function renderLabel(
  input: LabelInput,
  options: LabelRenderOptions,
): string {
  return getRenderer(options.language).renderLabel(input, options);
}

/** Render a diagnostic test label in the language named by `options.language`. */
export function renderTestLabel(options: LabelRenderOptions): string {
  return getRenderer(options.language).renderTestLabel(options);
}
