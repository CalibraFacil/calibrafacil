import type { LocalDatabase } from "./database";

export type LocalEffectiveEnvironmentalLimitsInput = {
  assetTypeId: number;
  unitId: number | null;
};

type EnvironmentalLimitRow = {
  limits_json: string;
};

/**
 * The limits that apply to an asset type in a unit, and which row won, in the
 * cloud's vocabulary (`GET /api/environmental-limits/effective`): the
 * asset-type override, else the unit default, else nothing.
 */
export function resolveLocalEffectiveEnvironmentalLimits(
  database: LocalDatabase,
  input: LocalEffectiveEnvironmentalLimitsInput,
) {
  const rows = database
    .prepare<{ unitId: number | null }, EnvironmentalLimitRow>(
      `
SELECT limits_json
FROM environmental_limits
WHERE unit_id = @unitId OR unit_id IS NULL
ORDER BY pulled_at DESC
`,
    )
    .all({ unitId: input.unitId });

  const parsedRows = rows
    .map((row) => parseJsonRecord(row.limits_json))
    .filter((row) => Object.keys(row).length > 0);

  const specific = parsedRows.find(
    (row) => row.assetTypeId === input.assetTypeId,
  );
  if (specific) return { limits: specific, source: "asset_type" as const };

  const unitDefault = parsedRows.find((row) => row.assetTypeId == null);
  if (unitDefault) {
    return { limits: unitDefault, source: "unit_default" as const };
  }

  return { limits: null, source: null };
}

export function getLocalEffectiveEnvironmentalLimits(
  database: LocalDatabase,
  input: LocalEffectiveEnvironmentalLimitsInput,
) {
  return resolveLocalEffectiveEnvironmentalLimits(database, input).limits;
}

function parseJsonRecord(value: string | null | undefined) {
  if (!value) return {};

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch {
    return {};
  }
}
