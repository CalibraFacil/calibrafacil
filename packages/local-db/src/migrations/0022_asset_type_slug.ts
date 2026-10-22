// The asset-type slug is part of the API contract (`assetTypeSlug` on assets and
// jobs, `slug` on `GET /api/asset-types`): the worksheet keys behaviour off it
// (e.g. the eccentricity indicator). The mirror kept only the name, and the
// local read model answered with its own row id as the "slug". Mirrors the
// cloud column; rows pulled before this migration get it on the next sync.
export const migration0022AssetTypeSlug = {
  id: 22,
  name: "asset_type_slug",
  sql: `
ALTER TABLE asset_types ADD COLUMN slug TEXT;
`,
};
