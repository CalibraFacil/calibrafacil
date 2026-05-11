import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

export type LocalMethodsListInput = {
  page: number;
  limit: number;
  status?: string;
  assetTypeId?: number;
  query?: string;
};

export type LocalMethodsListData = {
  data: Array<{
    id: number;
    name: string;
    description: string | null;
    version: number;
    status: "PUBLISHED";
    assetTypeId: number | null;
    assetTypeName: string | null;
    dataFields: unknown[];
    variableBindings: unknown[];
    formulas: unknown[];
    measurementModels: unknown[];
    validations: unknown[];
    uncertaintyParams: unknown[];
    certificateContent: unknown | null;
    compiledMethod: unknown | null;
    methodFingerprint: string | null;
    methodEngine: {
      version?: string;
      optionsFingerprint?: string;
    } | null;
    methodCompiledAt: string | null;
    publicationEvidence: unknown | null;
    createdAt: string;
    publishedAt: string | null;
    parentId: number | null;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type LocalMethod = LocalMethodsListData["data"][number];

type LocalMethodRow = {
  id: string;
  remote_id: number;
  name: string;
  version: number;
  method_fingerprint: string;
  engine_version: string;
  engine_options_fingerprint: string;
  normalized_method_json: string;
  compiled_method_json: string;
  publication_evidence_json: string | null;
  pulled_at: string;
  asset_type_id: string | null;
  asset_type_remote_id: number | null;
  asset_type_name: string | null;
};

export function listLocalMethods(
  database: LocalDatabase,
  input: LocalMethodsListInput,
): LocalMethodsListData {
  const page = Math.max(1, input.page);
  const limit = Math.max(1, Math.min(input.limit, 100));
  const offset = (page - 1) * limit;
  const conditions: string[] = ["1 = 1"];
  const params: Record<string, string | number> = {};

  if (input.status && input.status !== "PUBLISHED") {
    return emptyMethodsPage(page, limit);
  }

  if (input.assetTypeId) {
    conditions.push(
      "(at.remote_id = @assetTypeId OR at.id = @localAssetTypeId)",
    );
    params.assetTypeId = input.assetTypeId;
    params.localAssetTypeId = `asset-type:${input.assetTypeId}`;
  }

  if (input.query) {
    conditions.push("pm.name LIKE @query");
    params.query = `%${input.query}%`;
  }

  const whereClause = conditions.join(" AND ");
  const totalRow = database
    .prepare(
      `
SELECT COUNT(*) AS total
FROM published_methods pm
LEFT JOIN asset_types at ON at.id = pm.asset_type_id
WHERE ${whereClause}
`,
    )
    .get(params) as { total: number };

  const rows = database
    .prepare(
      `
SELECT
  pm.id,
  pm.remote_id,
  pm.name,
  pm.version,
  pm.method_fingerprint,
  pm.engine_version,
  pm.engine_options_fingerprint,
  pm.normalized_method_json,
  pm.compiled_method_json,
  pm.publication_evidence_json,
  pm.pulled_at,
  pm.asset_type_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name
FROM published_methods pm
LEFT JOIN asset_types at ON at.id = pm.asset_type_id
WHERE ${whereClause}
ORDER BY pm.name ASC, pm.version DESC
LIMIT @limit OFFSET @offset
`,
    )
    .all({ ...params, limit, offset }) as LocalMethodRow[];

  return {
    data: rows.map(toLocalMethod),
    pagination: {
      page,
      limit,
      total: totalRow.total,
      totalPages: Math.ceil(totalRow.total / limit),
    },
  };
}

export function getLocalMethodDetail(
  database: LocalDatabase,
  identifier: string,
): LocalMethod | null {
  const row = resolveLocalMethodRow(database, identifier);
  return row ? toLocalMethod(row) : null;
}

function resolveLocalMethodRow(
  database: LocalDatabase,
  identifier: string,
): LocalMethodRow | null {
  const numericIdentifier = Number(identifier);
  const params: Record<string, string | number> = { identifier };
  const directConditions = ["pm.id = @identifier", "pm.name = @identifier"];

  if (Number.isInteger(numericIdentifier)) {
    directConditions.push("pm.remote_id = @numericIdentifier");
    params.numericIdentifier = numericIdentifier;
  }

  const directMatch = database
    .prepare(
      `
SELECT
  pm.id,
  pm.remote_id,
  pm.name,
  pm.version,
  pm.method_fingerprint,
  pm.engine_version,
  pm.engine_options_fingerprint,
  pm.normalized_method_json,
  pm.compiled_method_json,
  pm.publication_evidence_json,
  pm.pulled_at,
  pm.asset_type_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name
FROM published_methods pm
LEFT JOIN asset_types at ON at.id = pm.asset_type_id
WHERE ${directConditions.join(" OR ")}
LIMIT 1
`,
    )
    .get(params) as LocalMethodRow | undefined;

  if (directMatch) return directMatch;

  const rows = database
    .prepare(
      `
SELECT
  pm.id,
  pm.remote_id,
  pm.name,
  pm.version,
  pm.method_fingerprint,
  pm.engine_version,
  pm.engine_options_fingerprint,
  pm.normalized_method_json,
  pm.compiled_method_json,
  pm.publication_evidence_json,
  pm.pulled_at,
  pm.asset_type_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name
FROM published_methods pm
LEFT JOIN asset_types at ON at.id = pm.asset_type_id
`,
    )
    .all() as LocalMethodRow[];

  if (Number.isInteger(numericIdentifier)) {
    const stableMatch = rows.find(
      (row) => stableLocalNumericId(row.id) === numericIdentifier,
    );
    if (stableMatch) return stableMatch;
  }

  const normalizedIdentifier = slugifyRouteIdentifier(identifier);
  return (
    rows.find((row) => {
      return (
        `${slugifyRouteIdentifier(row.name)}-v${row.version}` ===
          normalizedIdentifier ||
        slugifyRouteIdentifier(row.name) === normalizedIdentifier
      );
    }) ?? null
  );
}

function toLocalMethod(row: LocalMethodRow): LocalMethod {
  const normalized = safeParseRecord(row.normalized_method_json);
  const compiled = safeParseUnknown(row.compiled_method_json);
  const publicationEvidence = row.publication_evidence_json
    ? safeParseUnknown(row.publication_evidence_json)
    : null;

  return {
    id: row.remote_id ?? stableLocalNumericId(row.id),
    name: getString(normalized, "name") ?? row.name,
    description: getNullableString(normalized, "description"),
    version: row.version,
    status: "PUBLISHED",
    assetTypeId: row.asset_type_id
      ? (row.asset_type_remote_id ?? stableLocalNumericId(row.asset_type_id))
      : null,
    assetTypeName: row.asset_type_name,
    dataFields: getArray(normalized, "dataFields"),
    variableBindings: getArray(normalized, "variableBindings"),
    formulas: getArray(normalized, "formulas"),
    measurementModels: getArray(normalized, "measurementModels"),
    validations: getArray(normalized, "validations"),
    uncertaintyParams: getArray(normalized, "uncertaintyParams"),
    certificateContent: normalized.certificateContent ?? null,
    compiledMethod: compiled,
    methodFingerprint: row.method_fingerprint,
    methodEngine: {
      version: row.engine_version,
      optionsFingerprint: row.engine_options_fingerprint,
    },
    methodCompiledAt: row.pulled_at,
    publicationEvidence,
    createdAt: row.pulled_at,
    publishedAt: row.pulled_at,
    parentId: null,
  };
}

function emptyMethodsPage(page: number, limit: number): LocalMethodsListData {
  return {
    data: [],
    pagination: {
      page,
      limit,
      total: 0,
      totalPages: 0,
    },
  };
}

function safeParseUnknown(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function safeParseRecord(value: string): Record<string, unknown> {
  const parsed = safeParseUnknown(value);
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

function getArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function getString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getNullableString(record: Record<string, unknown>, key: string) {
  return getString(record, key);
}

function slugifyRouteIdentifier(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}
