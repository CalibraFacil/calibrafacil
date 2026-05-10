import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

export type LocalAssetType = {
  id: number;
  name: string;
  slug: string | null;
  description: string | null;
  definition: unknown;
};

type LocalAssetTypeRow = {
  id: string;
  remote_id: number | null;
  name: string;
  description: string | null;
  specifications_schema_json: string | null;
};

export function listLocalAssetTypes(database: LocalDatabase): {
  data: LocalAssetType[];
} {
  const rows = database
    .prepare(
      `
SELECT
  id,
  remote_id,
  name,
  description,
  specifications_schema_json
FROM asset_types
ORDER BY name ASC
`,
    )
    .all() as LocalAssetTypeRow[];

  return {
    data: rows.map((row) => ({
      id: row.remote_id ?? stableLocalNumericId(row.id),
      name: row.name,
      slug: row.id,
      description: row.description,
      definition: parseJson(row.specifications_schema_json) ?? [],
    })),
  };
}

function parseJson(value: string | null) {
  if (!value) return null;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
