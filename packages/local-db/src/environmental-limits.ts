import type { LocalDatabase } from "./database";

export type LocalEffectiveEnvironmentalLimitsInput = {
  assetTypeId: number;
  unitId: number | null;
};

type EnvironmentalLimitRow = {
  limits_json: string;
};

export function getLocalEffectiveEnvironmentalLimits(
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

  return (
    parsedRows.find((row) => row.assetTypeId === input.assetTypeId) ??
    parsedRows.find((row) => row.assetTypeId == null) ??
    null
  );
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
