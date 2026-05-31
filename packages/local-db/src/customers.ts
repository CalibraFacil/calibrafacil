import { randomUUID } from "node:crypto";
import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

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

export type CreateLocalCustomerInput = {
  organizationId: string | null;
  unitId: number | null;
  name: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: Record<string, unknown> | null;
  actorUserId?: string | null;
  deviceId?: string | null;
};

export type UpdateLocalCustomerInput = {
  identifier: string;
  name?: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: Record<string, unknown> | null;
  actorUserId?: string | null;
  deviceId?: string | null;
};

export type UpdateLocalCustomerComplianceInput = {
  identifier: string;
  compliance: Record<string, unknown>;
  reason: string;
  actorUserId?: string | null;
  deviceId?: string | null;
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

export function createLocalCustomer(
  database: LocalDatabase,
  input: CreateLocalCustomerInput,
): LocalCustomer {
  if (!input.organizationId) {
    throw new Error("Contexto local sem organizacao ativa");
  }

  const now = new Date().toISOString();
  const id = `customer:${randomUUID()}`;
  const payload: Record<string, unknown> = {
    name: input.name,
  };
  assignSyncPayloadValue(payload, "taxId", input.taxId);
  assignSyncPayloadValue(payload, "email", input.email);
  assignSyncPayloadValue(payload, "phone", input.phone);
  assignSyncPayloadValue(payload, "address", input.address);

  database.transaction(() => {
    database
      .prepare(
        `
INSERT INTO customers (
  id,
  organization_id,
  unit_id,
  name,
  tax_id,
  email,
  phone,
  address_json,
  updated_at,
  sync_state
) VALUES (
  @id,
  @organizationId,
  @unitId,
  @name,
  @taxId,
  @email,
  @phone,
  @addressJson,
  @updatedAt,
  'local'
)
`,
      )
      .run({
        id,
        organizationId: input.organizationId,
        unitId: input.unitId,
        name: input.name,
        taxId: input.taxId || null,
        email: input.email || null,
        phone: input.phone || null,
        addressJson: JSON.stringify(input.address ?? null),
        updatedAt: now,
      });

    enqueueLocalCustomerEvent(database, {
      entityId: id,
      operation: "create_local_customer",
      payload,
      actorUserId: input.actorUserId ?? null,
      deviceId: input.deviceId ?? "local",
      occurredAt: now,
    });
  })();

  return getLocalCustomerById(database, id);
}

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

export function updateLocalCustomer(
  database: LocalDatabase,
  input: UpdateLocalCustomerInput,
): LocalCustomer {
  const row = resolveLocalCustomerRow(database, input.identifier);
  if (!row) {
    throw new Error("Cliente local nao encontrado");
  }

  const now = new Date().toISOString();
  const values = {
    name: input.name ?? row.name,
    taxId: input.taxId === undefined ? row.tax_id : input.taxId || null,
    email: input.email === undefined ? row.email : input.email || null,
    phone: input.phone === undefined ? row.phone : input.phone || null,
    address:
      input.address === undefined
        ? parseJsonRecordOrNull(row.address_json)
        : input.address,
  };
  const payload: Record<string, unknown> = {};
  assignSyncPayloadValue(payload, "remoteId", row.remote_id);
  assignSyncPayloadValue(payload, "name", input.name);
  assignSyncPayloadValue(payload, "taxId", input.taxId);
  assignSyncPayloadValue(payload, "email", input.email);
  assignSyncPayloadValue(payload, "phone", input.phone);
  assignSyncPayloadValue(payload, "address", input.address);

  database.transaction(() => {
    database
      .prepare(
        `
UPDATE customers
SET name = @name,
  tax_id = @taxId,
  email = @email,
  phone = @phone,
  address_json = @addressJson,
  updated_at = @updatedAt,
  sync_state = 'local'
WHERE id = @id
`,
      )
      .run({
        id: row.id,
        name: values.name,
        taxId: values.taxId,
        email: values.email,
        phone: values.phone,
        addressJson: JSON.stringify(values.address ?? null),
        updatedAt: now,
      });

    enqueueLocalCustomerEvent(database, {
      entityId: row.id,
      operation: "update_local_customer",
      payload,
      actorUserId: input.actorUserId ?? null,
      deviceId: input.deviceId ?? "local",
      occurredAt: now,
    });
  })();

  const updated = getLocalCustomerById(database, row.id);
  return updated;
}

export function updateLocalCustomerCompliance(
  database: LocalDatabase,
  input: UpdateLocalCustomerComplianceInput,
): LocalCustomer {
  const row = resolveLocalCustomerRow(database, input.identifier);
  if (!row) {
    throw new Error("Cliente local nao encontrado");
  }

  const currentCompliance = parseJsonRecordOrNull(row.compliance_json) ?? {};
  const compliance = {
    qualificationStatus: "pending",
    qualityRequirementsAcknowledged: false,
    ...currentCompliance,
    ...input.compliance,
    ...(input.compliance.qualityRequirementsAcknowledged &&
    !currentCompliance.qualityRequirementsAcknowledged
      ? { qualityRequirementsAcknowledgedAt: new Date().toISOString() }
      : {}),
  };
  const now = new Date().toISOString();
  const payload = {
    remoteId: row.remote_id,
    compliance,
    reason: input.reason,
  };

  database.transaction(() => {
    database
      .prepare(
        `
UPDATE customers
SET compliance_json = @complianceJson,
  updated_at = @updatedAt,
  sync_state = 'local'
WHERE id = @id
`,
      )
      .run({
        id: row.id,
        complianceJson: JSON.stringify(compliance),
        updatedAt: now,
      });

    enqueueLocalCustomerEvent(database, {
      entityId: row.id,
      operation: "update_local_customer_compliance",
      payload,
      actorUserId: input.actorUserId ?? null,
      deviceId: input.deviceId ?? "local",
      occurredAt: now,
    });
  })();

  return getLocalCustomerById(database, row.id);
}

function getLocalCustomerById(
  database: LocalDatabase,
  id: string,
): LocalCustomer {
  const row = database
    .prepare<{ id: string }, LocalCustomerListRow>(
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
WHERE id = @id
LIMIT 1
`,
    )
    .get({ id });

  if (!row) {
    throw new Error("Cliente local nao encontrado");
  }

  return toLocalCustomer(row);
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

function enqueueLocalCustomerEvent(
  database: LocalDatabase,
  input: {
    entityId: string;
    operation: string;
    payload: unknown;
    actorUserId: string | null;
    deviceId: string;
    occurredAt: string;
  },
) {
  const eventId = `event:${randomUUID()}`;
  const idempotencyKey = `local:${eventId}`;

  database
    .prepare(
      `
INSERT INTO domain_events (
  event_id,
  aggregate_kind,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_json,
  metadata_json,
  actor_user_id,
  device_id,
  occurred_at,
  sync_state
) VALUES (
  @eventId,
  'customer',
  @aggregateId,
  0,
  @eventType,
  @payloadJson,
  '{}',
  @actorUserId,
  @deviceId,
  @occurredAt,
  'pending'
)
`,
    )
    .run({
      eventId,
      aggregateId: input.entityId,
      eventType: input.operation,
      payloadJson: JSON.stringify(input.payload),
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: input.occurredAt,
    });

  database
    .prepare(
      `
INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  created_at
) VALUES (
  @id,
  @eventId,
  @operation,
  @payloadJson,
  @idempotencyKey,
  'pending',
  @createdAt
)
`,
    )
    .run({
      id: `outbox:${randomUUID()}`,
      eventId,
      operation: input.operation,
      payloadJson: JSON.stringify(input.payload),
      idempotencyKey,
      createdAt: input.occurredAt,
    });
}

function assignSyncPayloadValue(
  payload: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value.length === 0) return;
  payload[key] = value;
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

function parseJson(value: string | null) {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function parseJsonRecordOrNull(value: string | null) {
  const record = recordFromUnknown(parseJson(value));
  return Object.keys(record).length > 0 ? record : null;
}
