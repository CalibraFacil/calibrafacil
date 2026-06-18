import { forceIndicationTemplate } from "./templates/force-indication";
import { frequencyIndicationTemplate } from "./templates/frequency-indication";
import { massBalanceTemplate } from "./templates/mass-balance";
import type { TemplateKey, TemplateModule } from "./types";

/**
 * The curated method-template catalog. The
 * `satisfies Record<TemplateKey, TemplateModule>` guard makes this total: add a
 * key to {@link TemplateKey} and this map fails to compile until it is filled.
 */
export const TEMPLATE_REGISTRY = {
  "mass-balance": massBalanceTemplate,
  "force-indication": forceIndicationTemplate,
  "frequency-indication": frequencyIndicationTemplate,
} as const satisfies Record<TemplateKey, TemplateModule>;

export function getTemplate(key: TemplateKey): TemplateModule {
  return TEMPLATE_REGISTRY[key];
}

export function listTemplates(): readonly TemplateModule[] {
  return Object.values(TEMPLATE_REGISTRY);
}
