/**
 * Asset-type → legal-metrology regulation-category mapping.
 *
 * The GLOBAL regulation catalog (`legal_metrology_regulation`, seeded in
 * `packages/db/src/seed-legal-metrology-regulations.ts`) is keyed by `category`
 * — the instrument family a Portaria regulates ("Balanças (IPNA)",
 * "Hidrômetros", …). This map scopes the catalog PICKER in the asset form to
 * the categories that can apply to the selected asset type, so a Balança
 * Digital is never offered the Cronotacógrafos Portaria.
 *
 * It is a UI suggestion-scope only: the regime itself remains a regulatory
 * fact authored by the lab (enquadramento + finalidade de uso, never inferred
 * from assetType — see the `asset` schema comment), and every regulated field
 * stays manually editable. Asset types absent from this map (including
 * lab-created custom types) see the full catalog.
 *
 * Keys are `asset_type.slug` values from `seed-asset-types.ts`; values must
 * match a seeded `legal_metrology_regulation.category` verbatim (cross-checked
 * by `packages/db/src/seed-legal-metrology-regulations.test.ts`).
 */
export const REGULATION_CATEGORY_BY_ASSET_TYPE_SLUG = {
  "balanca-digital": "Balanças (IPNA)",
  hidrometro: "Hidrômetros",
  esfigmomanometro: "Esfigmomanômetros",
  "medidor-gas": "Medidores de gás",
} as const satisfies Record<string, string>;

/**
 * The regulation-catalog category scoped to an asset type, or `null` when the
 * type has no mapping (→ the picker shows the full catalog).
 */
export function regulationCategoryForAssetTypeSlug(
  slug: string | null | undefined,
): string | null {
  if (!slug) return null;
  const map: Record<string, string> = REGULATION_CATEGORY_BY_ASSET_TYPE_SLUG;
  return map[slug] ?? null;
}
