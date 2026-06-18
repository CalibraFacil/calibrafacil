import { electricalIndicationTemplate } from "./templates/electrical-indication";
import { forceIndicationTemplate } from "./templates/force-indication";
import { frequencyIndicationTemplate } from "./templates/frequency-indication";
import { humidityMagnusTemplate } from "./templates/humidity-magnus";
import { volumeGlasswareTemplate } from "./templates/volume-glassware";
import { weighingInstrumentTemplate } from "./templates/weighing-instrument";
import type { TemplateKey, TemplateModule } from "./types";

/**
 * The curated PLATFORM method-template catalog. The
 * `satisfies Record<TemplateKey, TemplateModule>` guard makes this total: add a
 * key to {@link TemplateKey} and this map fails to compile until it is filled.
 *
 * Lab-specific methods (Exemplo `mass-balance`) are intentionally absent — they are
 * controlled by their seed script, not offered as platform templates.
 */
export const TEMPLATE_REGISTRY = {
  "force-indication": forceIndicationTemplate,
  "frequency-indication": frequencyIndicationTemplate,
  "electrical-indication": electricalIndicationTemplate,
  "volume-glassware": volumeGlasswareTemplate,
  "humidity-magnus": humidityMagnusTemplate,
  "weighing-instrument": weighingInstrumentTemplate,
} as const satisfies Record<TemplateKey, TemplateModule>;

export function getTemplate(key: TemplateKey): TemplateModule {
  return TEMPLATE_REGISTRY[key];
}

export function listTemplates(): readonly TemplateModule[] {
  return Object.values(TEMPLATE_REGISTRY);
}
