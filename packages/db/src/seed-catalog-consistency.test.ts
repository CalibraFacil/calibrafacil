import { describe, expect, it } from "vitest";
import {
  REGULATION_CATEGORY_BY_ASSET_TYPE_SLUG,
  regulationCategoryForAssetTypeSlug,
} from "@calibra-facil/shared";
import { dominantKindForAssetType } from "@calibra-facil/shared/units";

import { ASSET_TYPE_SEED } from "./seed-asset-types";
import { LEGAL_METROLOGY_REGULATION_SEED } from "./seed-legal-metrology-regulations";

/**
 * Consistency guards between the three catalogs that must agree verbatim:
 * the asset-type seed, the legal-metrology regulation seed, and the shared
 * slug → regulation-category map that scopes the Regulamento picker.
 */
describe("asset-type seed ↔ legal-metrology catalog consistency", () => {
  const seedSlugs = new Set(ASSET_TYPE_SEED.map((type) => type.slug));
  const seedCategories = new Set(
    LEGAL_METROLOGY_REGULATION_SEED.map((row) => row.category),
  );

  it("every mapped slug exists in the asset-type seed", () => {
    for (const slug of Object.keys(REGULATION_CATEGORY_BY_ASSET_TYPE_SLUG)) {
      expect(seedSlugs).toContain(slug);
    }
  });

  it("every mapped category exists in the regulation seed (verbatim)", () => {
    for (const category of Object.values(
      REGULATION_CATEGORY_BY_ASSET_TYPE_SLUG,
    )) {
      expect(seedCategories).toContain(category);
    }
  });

  it("unmapped and unknown slugs resolve to null (full catalog)", () => {
    expect(regulationCategoryForAssetTypeSlug("paquimetro")).toBeNull();
    expect(regulationCategoryForAssetTypeSlug("custom-lab-type")).toBeNull();
    expect(regulationCategoryForAssetTypeSlug(null)).toBeNull();
    expect(regulationCategoryForAssetTypeSlug(undefined)).toBeNull();
  });

  it("medidor-gas technology options match the catalog byTechnology keys", () => {
    const gasType = ASSET_TYPE_SEED.find((type) => type.slug === "medidor-gas");
    const technologyField = gasType?.definition.find(
      (field) => field.key === "technology",
    );
    const gasRegulation = LEGAL_METROLOGY_REGULATION_SEED.find(
      (row) => row.category === "Medidores de gás",
    );
    expect(technologyField?.options).toBeDefined();
    expect(gasRegulation?.byTechnology).toBeDefined();
    expect([...(technologyField?.options ?? [])].sort()).toEqual(
      Object.keys(gasRegulation?.byTechnology ?? {}).sort(),
    );
  });

  it("asset-type slugs are unique", () => {
    expect(seedSlugs.size).toBe(ASSET_TYPE_SEED.length);
  });
});

describe("seeded asset types resolve their intended quantity kind", () => {
  // The dominant kind drives the base-unit picker and every unit normalization
  // in the GUM pipeline — a seed whose units don't resolve would silently skip
  // normalization for the whole instrument family.
  const expectedKinds: Record<string, string> = {
    "balanca-digital": "mass",
    hidrometro: "volume",
    esfigmomanometro: "pressure",
    "medidor-gas": "volume",
    "peso-padrao": "mass",
    "termometro-infravermelho": "temperature",
    "estufa-banho-termico": "temperature",
    "camara-climatica": "temperature",
    "vidraria-volumetrica": "volume",
    "trena-escala": "length",
    "analisador-umidade": "mass",
    "prensa-hidraulica": "force",
  };

  for (const [slug, kind] of Object.entries(expectedKinds)) {
    it(`${slug} → ${kind}`, () => {
      const type = ASSET_TYPE_SEED.find((entry) => entry.slug === slug);
      expect(type).toBeDefined();
      expect(dominantKindForAssetType(type?.definition)).toBe(kind);
    });
  }
});
