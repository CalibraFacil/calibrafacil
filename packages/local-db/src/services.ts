import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

export type LocalServicesListInput = {
  page: number;
  limit: number;
  query?: string;
  assetTypeId?: number;
  isActive?: boolean;
};

export type LocalServicesListData = {
  data: Array<{
    id: number;
    name: string;
    description: string | null;
    methodId: number | null;
    methodName: string | null;
    methodVersion: number | null;
    methodStatus: string | null;
    assetTypeId: number | null;
    assetTypeName: string | null;
    price: number | null;
    currency: string;
    tat: number | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type LocalServiceRow = {
  id: string;
  remote_id: number | null;
  name: string;
  description: string | null;
  method_id: string | null;
  method_remote_id: number | null;
  method_name: string | null;
  method_version: number | null;
  asset_type_id: string | null;
  asset_type_remote_id: number | null;
  asset_type_name: string | null;
  status: string;
  pulled_at: string;
};

export type LocalService = LocalServicesListData["data"][number];

export function listLocalServices(
  database: LocalDatabase,
  input: LocalServicesListInput,
): LocalServicesListData {
  const page = Math.max(1, input.page);
  const limit = Math.max(1, Math.min(input.limit, 100));
  const offset = (page - 1) * limit;
  const conditions: string[] = ["1 = 1"];
  const params: Record<string, string | number> = {};

  if (input.isActive !== undefined) {
    conditions.push("s.status = @status");
    params.status = input.isActive ? "ACTIVE" : "INACTIVE";
  }

  if (input.assetTypeId) {
    conditions.push(
      "(at.remote_id = @assetTypeId OR at.id = @localAssetTypeId)",
    );
    params.assetTypeId = input.assetTypeId;
    params.localAssetTypeId = `asset-type:${input.assetTypeId}`;
  }

  if (input.query) {
    conditions.push("(s.name LIKE @query OR s.description LIKE @query)");
    params.query = `%${input.query}%`;
  }

  const whereClause = conditions.join(" AND ");
  const totalRow = database
    .prepare<typeof params, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM services s
LEFT JOIN asset_types at ON at.id = s.asset_type_id
WHERE ${whereClause}
`,
    )
    .get(params);

  const pageParams = { ...params, limit, offset };
  const rows = database
    .prepare<typeof pageParams, LocalServiceRow>(
      `
SELECT
  s.id,
  s.remote_id,
  s.name,
  s.description,
  s.method_id,
  pm.remote_id AS method_remote_id,
  pm.name AS method_name,
  pm.version AS method_version,
  s.asset_type_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name,
  s.status,
  s.pulled_at
FROM services s
LEFT JOIN published_methods pm ON pm.id = s.method_id
LEFT JOIN asset_types at ON at.id = s.asset_type_id
WHERE ${whereClause}
ORDER BY s.name ASC
LIMIT @limit OFFSET @offset
`,
    )
    .all(pageParams);

  return {
    data: rows.map((row) => ({
      id: row.remote_id ?? stableLocalNumericId(row.id),
      name: row.name,
      description: row.description,
      methodId: row.method_remote_id,
      methodName: row.method_name,
      methodVersion: row.method_version,
      methodStatus: row.method_id ? "PUBLISHED" : null,
      assetTypeId: row.asset_type_id
        ? (row.asset_type_remote_id ?? stableLocalNumericId(row.asset_type_id))
        : null,
      assetTypeName: row.asset_type_name,
      price: null,
      currency: "BRL",
      tat: null,
      isActive: row.status === "ACTIVE",
      createdAt: row.pulled_at,
      updatedAt: row.pulled_at,
    })),
    pagination: {
      page,
      limit,
      total: totalRow?.total ?? 0,
      totalPages: Math.ceil((totalRow?.total ?? 0) / limit),
    },
  };
}

export function getLocalServiceDetail(
  database: LocalDatabase,
  identifier: string,
): LocalService | null {
  const row = resolveLocalServiceRow(database, identifier);
  return row ? toLocalService(row) : null;
}

function resolveLocalServiceRow(
  database: LocalDatabase,
  identifier: string,
): LocalServiceRow | null {
  const numericIdentifier = Number(identifier);
  const params: Record<string, string | number> = { identifier };
  const directConditions = ["s.id = @identifier", "s.name = @identifier"];

  if (Number.isInteger(numericIdentifier)) {
    directConditions.push("s.remote_id = @numericIdentifier");
    params.numericIdentifier = numericIdentifier;
  }

  const directMatch = database
    .prepare<typeof params, LocalServiceRow>(
      `
SELECT
  s.id,
  s.remote_id,
  s.name,
  s.description,
  s.method_id,
  pm.remote_id AS method_remote_id,
  pm.name AS method_name,
  pm.version AS method_version,
  s.asset_type_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name,
  s.status,
  s.pulled_at
FROM services s
LEFT JOIN published_methods pm ON pm.id = s.method_id
LEFT JOIN asset_types at ON at.id = s.asset_type_id
WHERE ${directConditions.join(" OR ")}
LIMIT 1
`,
    )
    .get(params);

  if (directMatch) return directMatch;

  const rows = database
    .prepare<[], LocalServiceRow>(
      `
SELECT
  s.id,
  s.remote_id,
  s.name,
  s.description,
  s.method_id,
  pm.remote_id AS method_remote_id,
  pm.name AS method_name,
  pm.version AS method_version,
  s.asset_type_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name,
  s.status,
  s.pulled_at
FROM services s
LEFT JOIN published_methods pm ON pm.id = s.method_id
LEFT JOIN asset_types at ON at.id = s.asset_type_id
`,
    )
    .all();

  if (Number.isInteger(numericIdentifier)) {
    const stableMatch = rows.find(
      (row) => stableLocalNumericId(row.id) === numericIdentifier,
    );
    if (stableMatch) return stableMatch;
  }

  const normalizedIdentifier = slugifyRouteIdentifier(identifier);
  return (
    rows.find(
      (row) => slugifyRouteIdentifier(row.name) === normalizedIdentifier,
    ) ?? null
  );
}

function toLocalService(row: LocalServiceRow): LocalService {
  return {
    id: row.remote_id ?? stableLocalNumericId(row.id),
    name: row.name,
    description: row.description,
    methodId: row.method_remote_id,
    methodName: row.method_name,
    methodVersion: row.method_version,
    methodStatus: row.method_id ? "PUBLISHED" : null,
    assetTypeId: row.asset_type_id
      ? (row.asset_type_remote_id ?? stableLocalNumericId(row.asset_type_id))
      : null,
    assetTypeName: row.asset_type_name,
    price: null,
    currency: "BRL",
    tat: null,
    isActive: row.status === "ACTIVE",
    createdAt: row.pulled_at,
    updatedAt: row.pulled_at,
  };
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
