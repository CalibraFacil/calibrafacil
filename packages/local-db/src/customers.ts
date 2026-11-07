import { slugifyRouteIdentifier } from "@calibra-facil/shared/route-identifiers";
import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";
import { toRecord } from "@calibra-facil/shared/record";

export type LocalCustomersListInput = {
  page: number;
  limit: number;
  query?: string;
};

export type LocalCustomersListData = {
  data: Array<{
    id: number;
    name: string;
    taxId: string | null;
    email: string | null;
    phone: string | null;
    address: Record<string, unknown> | null;
    compliance: Record<string, unknown> | null;
    financialSummary: {
      openDocumentsCount: number;
      overdueDocumentsCount: number;
      openBalanceCents: number;
      overdueBalanceCents: number;
      overdueBalanceFlag: boolean;
    };
    authOrganizationId: string | null;
    createdAt: string;
    updatedAt: string;
    syncState: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type LocalCustomer = LocalCustomersListData["data"][number];

type LocalCustomerListRow = {
  id: string;
  remote_id: number | null;
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address_json: string | null;
  compliance_json: string | null;
  updated_at: string;
  sync_state: string;
};

export function listLocalCustomers(
  database: LocalDatabase,
  input: LocalCustomersListInput,
): LocalCustomersListData {
  const page = Math.max(1, input.page);
  const limit = Math.max(1, Math.min(input.limit, 100));
  const offset = (page - 1) * limit;
  const conditions: string[] = ["deleted_at IS NULL"];
  const params: Record<string, string | number> = {};

  if (input.query) {
    conditions.push(`(
      name LIKE @query OR
      tax_id LIKE @query OR
      email LIKE @query
    )`);
    params.query = `%${input.query}%`;
  }

  const whereClause = conditions.join(" AND ");
  const totalRow = database
    .prepare<typeof params, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM customers
WHERE ${whereClause}
`,
    )
    .get(params);

  const pageParams = { ...params, limit, offset };
  const rows = database
    .prepare<typeof pageParams, LocalCustomerListRow>(
      `
SELECT
  id,
  remote_id,
  name,
  tax_id,
  email,
  phone,
  address_json,
  compliance_json,
  updated_at,
  sync_state
FROM customers
WHERE ${whereClause}
ORDER BY name ASC
LIMIT @limit OFFSET @offset
`,
    )
    .all(pageParams);

  return {
    data: rows.map(toLocalCustomer),
    pagination: {
      page,
      limit,
      total: totalRow?.total ?? 0,
      totalPages: Math.ceil((totalRow?.total ?? 0) / limit),
    },
  };
}

export function getLocalCustomerDetail(
  database: LocalDatabase,
  identifier: string,
): LocalCustomer | null {
  const row = resolveLocalCustomerRow(database, identifier);
  return row ? toLocalCustomer(row) : null;
}

function resolveLocalCustomerRow(
  database: LocalDatabase,
  identifier: string,
): LocalCustomerListRow | null {
  const numericIdentifier = Number(identifier);
  const hasNumericIdentifier =
    Number.isInteger(numericIdentifier) && numericIdentifier > 0;
  const directRow = database
    .prepare<
      {
        identifier: string;
        numericIdentifier: number | null;
        hasNumericIdentifier: number;
      },
      LocalCustomerListRow
    >(
      `
SELECT
  id,
  remote_id,
  name,
  tax_id,
  email,
  phone,
  address_json,
  compliance_json,
  updated_at,
  sync_state
FROM customers
WHERE deleted_at IS NULL
  AND (
    id = @identifier OR
    tax_id = @identifier OR
    (@hasNumericIdentifier = 1 AND remote_id = @numericIdentifier)
  )
LIMIT 1
`,
    )
    .get({
      identifier,
      numericIdentifier: hasNumericIdentifier ? numericIdentifier : null,
      hasNumericIdentifier: hasNumericIdentifier ? 1 : 0,
    });

  if (directRow) return directRow;

  const rows = database
    .prepare<[], LocalCustomerListRow>(
      `
SELECT
  id,
  remote_id,
  name,
  tax_id,
  email,
  phone,
  address_json,
  compliance_json,
  updated_at,
  sync_state
FROM customers
WHERE deleted_at IS NULL
`,
    )
    .all();
  const normalizedIdentifier = slugifyRouteIdentifier(identifier);
  const slugMatch = rows.find(
    (candidate) =>
      slugifyRouteIdentifier(candidate.name) === normalizedIdentifier ||
      (candidate.tax_id &&
        slugifyRouteIdentifier(candidate.tax_id) === normalizedIdentifier),
  );
  if (slugMatch) return slugMatch;

  if (!hasNumericIdentifier) return null;

  return (
    rows.find((candidate) => {
      return stableLocalNumericId(candidate.id) === numericIdentifier;
    }) ?? null
  );
}

function toLocalCustomer(row: LocalCustomerListRow): LocalCustomer {
  return {
    id: row.remote_id ?? stableLocalNumericId(row.id),
    name: row.name,
    taxId: row.tax_id,
    email: row.email,
    phone: row.phone,
    address: parseJsonRecordOrNull(row.address_json),
    compliance: parseJsonRecordOrNull(row.compliance_json),
    financialSummary: {
      openDocumentsCount: 0,
      overdueDocumentsCount: 0,
      openBalanceCents: 0,
      overdueBalanceCents: 0,
      overdueBalanceFlag: false,
    },
    authOrganizationId: null,
    createdAt: row.updated_at,
    updatedAt: row.updated_at,
    syncState: row.sync_state,
  };
}

function parseJson(value: string | null) {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

function parseJsonRecordOrNull(value: string | null) {
  const record = toRecord(parseJson(value));
  return Object.keys(record).length > 0 ? record : null;
}
