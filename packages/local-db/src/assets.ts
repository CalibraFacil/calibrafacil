import { randomUUID } from "node:crypto";
import type { MetrologyRegime } from "@calibra-facil/schemas";
import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

export type LocalAssetStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "MAINTENANCE"
  | "SCRAPPED";

export type LocalAssetsListInput = {
  page: number;
  limit: number;
  customerId?: number;
  assetTypeId?: number;
  status?: LocalAssetStatus;
  query?: string;
};

export type LocalAssetsListData = {
  data: Array<{
    id: number;
    customerId: number;
    customerName: string;
    customerTaxId: string | null;
    assetTypeId: number;
    assetTypeName: string;
    assetTypeSlug: string | null;
    assetTypeDefinition: unknown;
    name: string;
    manufacturer: string | null;
    model: string | null;
    serialNumber: string;
    tag: string;
    status: LocalAssetStatus;
    baseMeasurementUnit: string | null;
    specifications: unknown;
    lastCalibrationDate: string | null;
    nextCalibrationDate: string | null;
    comments: string | null;
    subjectToLegalMetrology: boolean;
    // Legal-metrology TRACK 2 (mirrors the cloud `asset` columns). `regulatedInterval`
    // is the structured period (stored loosely like `specifications`).
    metrologyRegime: MetrologyRegime;
    regulatedInterval: Record<string, unknown> | null;
    nextLegalVerificationDate: string | null;
    installedAt: string | null;
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

export type CreateLocalAssetInput = {
  organizationId: string | null;
  unitId: number | null;
  customerId: number;
  assetTypeId: number;
  name: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber: string;
  tag: string;
  status?: LocalAssetStatus;
  baseMeasurementUnit?: string | null;
  lastCalibrationDate?: string | null;
  nextCalibrationDate?: string | null;
  comments?: string | null;
  subjectToLegalMetrology?: boolean;
  metrologyRegime?: MetrologyRegime;
  regulatedInterval?: Record<string, unknown> | null;
  nextLegalVerificationDate?: string | null;
  installedAt?: string | null;
  specifications?: Record<string, unknown> | null;
  actorUserId?: string | null;
  deviceId?: string | null;
};

export type UpdateLocalAssetInput = {
  identifier: string;
  name?: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string;
  tag?: string;
  status?: LocalAssetStatus;
  baseMeasurementUnit?: string | null;
  lastCalibrationDate?: string | null;
  nextCalibrationDate?: string | null;
  comments?: string | null;
  subjectToLegalMetrology?: boolean;
  metrologyRegime?: MetrologyRegime;
  regulatedInterval?: Record<string, unknown> | null;
  nextLegalVerificationDate?: string | null;
  installedAt?: string | null;
  specifications?: Record<string, unknown> | null;
  actorUserId?: string | null;
  deviceId?: string | null;
};

export type LocalAsset = LocalAssetsListData["data"][number];

type LocalAssetListRow = {
  id: string;
  remote_id: number | null;
  customer_id: string;
  customer_remote_id: number | null;
  customer_name: string | null;
  customer_tax_id: string | null;
  asset_type_id: string;
  asset_type_remote_id: number | null;
  asset_type_name: string | null;
  asset_type_definition_json: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string;
  tag: string;
  status: LocalAssetStatus;
  base_measurement_unit: string | null;
  specifications_json: string | null;
  last_calibration_date: string | null;
  next_calibration_date: string | null;
  comments: string | null;
  subject_to_legal_metrology: number;
  metrology_regime: MetrologyRegime;
  regulated_interval: string | null;
  next_legal_verification_date: string | null;
  installed_at: string | null;
  updated_at: string;
  sync_state: string;
};

export function createLocalAsset(
  database: LocalDatabase,
  input: CreateLocalAssetInput,
): LocalAsset {
  if (!input.organizationId || !input.unitId) {
    throw new Error("Contexto local sem organizacao ou unidade ativa");
  }

  const customerId = resolveLocalEntityId(
    database,
    "customers",
    input.customerId,
  );
  if (!customerId) {
    throw new Error("Cliente local nao encontrado");
  }

  const assetTypeId = resolveLocalEntityId(
    database,
    "asset_types",
    input.assetTypeId,
  );
  if (!assetTypeId) {
    throw new Error("Tipo de instrumento local nao encontrado");
  }

  const existingTag = database
    .prepare<{ tag: string }, { id: string }>(
      `
SELECT id
FROM assets
WHERE tag = @tag
  AND deleted_at IS NULL
LIMIT 1
`,
    )
    .get({ tag: input.tag });

  if (existingTag) {
    throw new Error("Tag ja esta em uso");
  }

  const now = new Date().toISOString();
  const id = `asset:${randomUUID()}`;
  const payload = {
    customerId: input.customerId,
    assetTypeId: input.assetTypeId,
    name: input.name,
    manufacturer: input.manufacturer || null,
    model: input.model || null,
    serialNumber: input.serialNumber,
    tag: input.tag,
    status: input.status ?? "ACTIVE",
    baseMeasurementUnit: input.baseMeasurementUnit ?? null,
    lastCalibrationDate: input.lastCalibrationDate ?? null,
    nextCalibrationDate: input.nextCalibrationDate ?? null,
    comments: input.comments || null,
    subjectToLegalMetrology: input.subjectToLegalMetrology ?? false,
    metrologyRegime: input.metrologyRegime ?? "INDUSTRIAL",
    regulatedInterval: input.regulatedInterval ?? null,
    installedAt: input.installedAt ?? null,
    specifications: input.specifications ?? null,
  };

  database.transaction(() => {
    database
      .prepare(
        `
INSERT INTO assets (
  id,
  organization_id,
  unit_id,
  customer_id,
  asset_type_id,
  name,
  serial_number,
  tag,
  manufacturer,
  model,
  base_measurement_unit,
  specifications_json,
  last_calibration_date,
  next_calibration_date,
  comments,
  subject_to_legal_metrology,
  metrology_regime,
  regulated_interval,
  next_legal_verification_date,
  installed_at,
  status,
  updated_at,
  sync_state
) VALUES (
  @id,
  @organizationId,
  @unitId,
  @customerId,
  @assetTypeId,
  @name,
  @serialNumber,
  @tag,
  @manufacturer,
  @model,
  @baseMeasurementUnit,
  @specificationsJson,
  @lastCalibrationDate,
  @nextCalibrationDate,
  @comments,
  @subjectToLegalMetrology,
  @metrologyRegime,
  @regulatedIntervalJson,
  @nextLegalVerificationDate,
  @installedAt,
  @status,
  @updatedAt,
  'local'
)
`,
      )
      .run({
        id,
        organizationId: input.organizationId,
        unitId: input.unitId,
        customerId,
        assetTypeId,
        name: input.name,
        serialNumber: input.serialNumber,
        tag: input.tag,
        manufacturer: input.manufacturer || null,
        model: input.model || null,
        baseMeasurementUnit: input.baseMeasurementUnit ?? null,
        specificationsJson: JSON.stringify(input.specifications ?? null),
        lastCalibrationDate: input.lastCalibrationDate ?? null,
        nextCalibrationDate: input.nextCalibrationDate ?? null,
        comments: input.comments || null,
        subjectToLegalMetrology: input.subjectToLegalMetrology ? 1 : 0,
        metrologyRegime: input.metrologyRegime ?? "INDUSTRIAL",
        regulatedIntervalJson: JSON.stringify(input.regulatedInterval ?? null),
        nextLegalVerificationDate: input.nextLegalVerificationDate ?? null,
        installedAt: input.installedAt ?? null,
        status: input.status ?? "ACTIVE",
        updatedAt: now,
      });

    enqueueLocalAssetEvent(database, {
      entityId: id,
      operation: "create_local_asset",
      payload,
      actorUserId: input.actorUserId ?? null,
      deviceId: input.deviceId ?? "local",
      occurredAt: now,
    });
  })();

  return getLocalAssetById(database, id);
}

export function listLocalAssets(
  database: LocalDatabase,
  input: LocalAssetsListInput,
): LocalAssetsListData {
  const page = Math.max(1, input.page);
  const limit = Math.max(1, Math.min(input.limit, 100));
  const offset = (page - 1) * limit;
  const conditions: string[] = ["a.deleted_at IS NULL"];
  const params: Record<string, string | number> = {};

  if (input.customerId) {
    conditions.push("c.remote_id = @customerId");
    params.customerId = input.customerId;
  }

  if (input.assetTypeId) {
    conditions.push("at.remote_id = @assetTypeId");
    params.assetTypeId = input.assetTypeId;
  }

  if (input.status) {
    conditions.push("a.status = @status");
    params.status = input.status;
  }

  if (input.query) {
    conditions.push(`(
      a.name LIKE @query OR
      a.tag LIKE @query OR
      a.serial_number LIKE @query OR
      a.manufacturer LIKE @query OR
      a.model LIKE @query
    )`);
    params.query = `%${input.query}%`;
  }

  const whereClause = conditions.join(" AND ");
  const totalRow = database
    .prepare<typeof params, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM assets a
LEFT JOIN customers c ON c.id = a.customer_id
LEFT JOIN asset_types at ON at.id = a.asset_type_id
WHERE ${whereClause}
`,
    )
    .get(params);

  const pageParams = { ...params, limit, offset };
  const rows = database
    .prepare<typeof pageParams, LocalAssetListRow>(
      `
SELECT
  a.id,
  a.remote_id,
  a.customer_id,
  c.remote_id AS customer_remote_id,
  c.name AS customer_name,
  c.tax_id AS customer_tax_id,
  a.asset_type_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name,
  at.specifications_schema_json AS asset_type_definition_json,
  a.name,
  a.manufacturer,
  a.model,
  a.serial_number,
  a.tag,
  a.status,
  a.base_measurement_unit,
  a.specifications_json,
  a.last_calibration_date,
  a.next_calibration_date,
  a.comments,
  a.subject_to_legal_metrology,
  a.metrology_regime,
  a.regulated_interval,
  a.next_legal_verification_date,
  a.installed_at,
  a.updated_at,
  a.sync_state
FROM assets a
LEFT JOIN customers c ON c.id = a.customer_id
LEFT JOIN asset_types at ON at.id = a.asset_type_id
WHERE ${whereClause}
ORDER BY a.tag ASC
LIMIT @limit OFFSET @offset
`,
    )
    .all(pageParams);

  return {
    data: rows.map(toLocalAsset),
    pagination: {
      page,
      limit,
      total: totalRow?.total ?? 0,
      totalPages: Math.ceil((totalRow?.total ?? 0) / limit),
    },
  };
}

function getLocalAssetById(database: LocalDatabase, id: string): LocalAsset {
  const row = database
    .prepare<{ id: string }, LocalAssetListRow>(
      `
SELECT
  a.id,
  a.remote_id,
  a.customer_id,
  c.remote_id AS customer_remote_id,
  c.name AS customer_name,
  c.tax_id AS customer_tax_id,
  a.asset_type_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name,
  at.specifications_schema_json AS asset_type_definition_json,
  a.name,
  a.manufacturer,
  a.model,
  a.serial_number,
  a.tag,
  a.status,
  a.base_measurement_unit,
  a.specifications_json,
  a.last_calibration_date,
  a.next_calibration_date,
  a.comments,
  a.subject_to_legal_metrology,
  a.metrology_regime,
  a.regulated_interval,
  a.next_legal_verification_date,
  a.installed_at,
  a.updated_at,
  a.sync_state
FROM assets a
LEFT JOIN customers c ON c.id = a.customer_id
LEFT JOIN asset_types at ON at.id = a.asset_type_id
WHERE a.id = @id
LIMIT 1
`,
    )
    .get({ id });

  if (!row) {
    throw new Error("Ativo local nao encontrado");
  }

  return toLocalAsset(row);
}

export function getLocalAssetDetail(
  database: LocalDatabase,
  identifier: string,
): LocalAsset | null {
  const directMatch = getLocalAssetDetailByDirectIdentifier(
    database,
    identifier,
  );
  if (directMatch) return directMatch;

  const rows = database
    .prepare<[], LocalAssetListRow>(
      `
SELECT
  a.id,
  a.remote_id,
  a.customer_id,
  c.remote_id AS customer_remote_id,
  c.name AS customer_name,
  c.tax_id AS customer_tax_id,
  a.asset_type_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name,
  at.specifications_schema_json AS asset_type_definition_json,
  a.name,
  a.manufacturer,
  a.model,
  a.serial_number,
  a.tag,
  a.status,
  a.base_measurement_unit,
  a.specifications_json,
  a.last_calibration_date,
  a.next_calibration_date,
  a.comments,
  a.subject_to_legal_metrology,
  a.metrology_regime,
  a.regulated_interval,
  a.next_legal_verification_date,
  a.installed_at,
  a.updated_at,
  a.sync_state
FROM assets a
LEFT JOIN customers c ON c.id = a.customer_id
LEFT JOIN asset_types at ON at.id = a.asset_type_id
WHERE a.deleted_at IS NULL
`,
    )
    .all();

  const normalizedIdentifier = slugifyRouteIdentifier(identifier);
  const row = rows.find(
    (candidate) =>
      slugifyRouteIdentifier(candidate.tag) === normalizedIdentifier ||
      slugifyRouteIdentifier(candidate.serial_number) === normalizedIdentifier,
  );

  return row ? toLocalAsset(row) : null;
}

export function updateLocalAsset(
  database: LocalDatabase,
  input: UpdateLocalAssetInput,
): LocalAsset {
  const row = resolveLocalAssetRow(database, input.identifier);
  if (!row) {
    throw new Error("Ativo local nao encontrado");
  }

  const tag = input.tag ?? row.tag;
  if (tag !== row.tag) {
    const existingTag = database
      .prepare<{ tag: string; id: string }, { id: string }>(
        `
SELECT id
FROM assets
WHERE tag = @tag
  AND id <> @id
  AND deleted_at IS NULL
LIMIT 1
`,
      )
      .get({ tag, id: row.id });

    if (existingTag) {
      throw new Error("Tag ja esta em uso");
    }
  }

  const now = new Date().toISOString();
  const values = {
    remoteId: row.remote_id,
    name: input.name ?? row.name,
    manufacturer:
      input.manufacturer === undefined ? row.manufacturer : input.manufacturer,
    model: input.model === undefined ? row.model : input.model,
    serialNumber: input.serialNumber ?? row.serial_number,
    tag,
    status: input.status ?? row.status,
    baseMeasurementUnit:
      input.baseMeasurementUnit === undefined
        ? row.base_measurement_unit
        : input.baseMeasurementUnit,
    lastCalibrationDate:
      input.lastCalibrationDate === undefined
        ? row.last_calibration_date
        : input.lastCalibrationDate,
    nextCalibrationDate:
      input.nextCalibrationDate === undefined
        ? row.next_calibration_date
        : input.nextCalibrationDate,
    comments: input.comments === undefined ? row.comments : input.comments,
    subjectToLegalMetrology:
      input.subjectToLegalMetrology === undefined
        ? row.subject_to_legal_metrology === 1
        : input.subjectToLegalMetrology,
    metrologyRegime:
      input.metrologyRegime === undefined
        ? row.metrology_regime
        : input.metrologyRegime,
    regulatedInterval:
      input.regulatedInterval === undefined
        ? parseRecord(row.regulated_interval)
        : input.regulatedInterval,
    nextLegalVerificationDate:
      input.nextLegalVerificationDate === undefined
        ? row.next_legal_verification_date
        : input.nextLegalVerificationDate,
    installedAt:
      input.installedAt === undefined ? row.installed_at : input.installedAt,
    specifications:
      input.specifications === undefined
        ? parseJson(row.specifications_json)
        : input.specifications,
  };

  database.transaction(() => {
    database
      .prepare(
        `
UPDATE assets
SET name = @name,
  manufacturer = @manufacturer,
  model = @model,
  serial_number = @serialNumber,
  tag = @tag,
  status = @status,
  base_measurement_unit = @baseMeasurementUnit,
  specifications_json = @specificationsJson,
  last_calibration_date = @lastCalibrationDate,
  next_calibration_date = @nextCalibrationDate,
  comments = @comments,
  subject_to_legal_metrology = @subjectToLegalMetrology,
  metrology_regime = @metrologyRegime,
  regulated_interval = @regulatedIntervalJson,
  next_legal_verification_date = @nextLegalVerificationDate,
  installed_at = @installedAt,
  updated_at = @updatedAt,
  sync_state = 'local'
WHERE id = @id
`,
      )
      .run({
        id: row.id,
        name: values.name,
        manufacturer: values.manufacturer || null,
        model: values.model || null,
        serialNumber: values.serialNumber,
        tag: values.tag,
        status: values.status,
        baseMeasurementUnit: values.baseMeasurementUnit ?? null,
        specificationsJson: JSON.stringify(values.specifications ?? null),
        lastCalibrationDate: values.lastCalibrationDate ?? null,
        nextCalibrationDate: values.nextCalibrationDate ?? null,
        comments: values.comments || null,
        subjectToLegalMetrology: values.subjectToLegalMetrology ? 1 : 0,
        metrologyRegime: values.metrologyRegime,
        regulatedIntervalJson: JSON.stringify(values.regulatedInterval ?? null),
        nextLegalVerificationDate: values.nextLegalVerificationDate ?? null,
        installedAt: values.installedAt ?? null,
        updatedAt: now,
      });

    enqueueLocalAssetEvent(database, {
      entityId: row.id,
      operation: "update_local_asset",
      payload: values,
      actorUserId: input.actorUserId ?? null,
      deviceId: input.deviceId ?? "local",
      occurredAt: now,
    });
  })();

  return getLocalAssetById(database, row.id);
}

function getLocalAssetDetailByDirectIdentifier(
  database: LocalDatabase,
  identifier: string,
): LocalAsset | null {
  const numericIdentifier = Number(identifier);
  const hasNumericIdentifier =
    Number.isInteger(numericIdentifier) && numericIdentifier > 0;
  const row = database
    .prepare<
      {
        identifier: string;
        numericIdentifier: number | null;
        hasNumericIdentifier: number;
      },
      LocalAssetListRow
    >(
      `
SELECT
  a.id,
  a.remote_id,
  a.customer_id,
  c.remote_id AS customer_remote_id,
  c.name AS customer_name,
  c.tax_id AS customer_tax_id,
  a.asset_type_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name,
  at.specifications_schema_json AS asset_type_definition_json,
  a.name,
  a.manufacturer,
  a.model,
  a.serial_number,
  a.tag,
  a.status,
  a.base_measurement_unit,
  a.specifications_json,
  a.last_calibration_date,
  a.next_calibration_date,
  a.comments,
  a.subject_to_legal_metrology,
  a.metrology_regime,
  a.regulated_interval,
  a.next_legal_verification_date,
  a.installed_at,
  a.updated_at,
  a.sync_state
FROM assets a
LEFT JOIN customers c ON c.id = a.customer_id
LEFT JOIN asset_types at ON at.id = a.asset_type_id
WHERE a.deleted_at IS NULL
  AND (
    a.id = @identifier OR
    a.tag = @identifier OR
    a.serial_number = @identifier OR
    (@hasNumericIdentifier = 1 AND a.remote_id = @numericIdentifier)
  )
LIMIT 1
`,
    )
    .get({
      identifier,
      numericIdentifier: hasNumericIdentifier ? numericIdentifier : null,
      hasNumericIdentifier: hasNumericIdentifier ? 1 : 0,
    });

  if (row) return toLocalAsset(row);
  if (!hasNumericIdentifier) return null;

  const rows = database
    .prepare<
      [],
      { id: string }
    >(`SELECT id FROM assets WHERE deleted_at IS NULL`)
    .all();
  const stableMatch = rows.find(
    (assetRow) => stableLocalNumericId(assetRow.id) === numericIdentifier,
  );

  return stableMatch ? getLocalAssetById(database, stableMatch.id) : null;
}

function resolveLocalAssetRow(
  database: LocalDatabase,
  identifier: string,
): LocalAssetListRow | null {
  const numericIdentifier = Number(identifier);
  const hasNumericIdentifier =
    Number.isInteger(numericIdentifier) && numericIdentifier > 0;
  const rows = database
    .prepare<[], LocalAssetListRow>(
      `
SELECT
  a.id,
  a.remote_id,
  a.customer_id,
  c.remote_id AS customer_remote_id,
  c.name AS customer_name,
  c.tax_id AS customer_tax_id,
  a.asset_type_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name,
  at.specifications_schema_json AS asset_type_definition_json,
  a.name,
  a.manufacturer,
  a.model,
  a.serial_number,
  a.tag,
  a.status,
  a.base_measurement_unit,
  a.specifications_json,
  a.last_calibration_date,
  a.next_calibration_date,
  a.comments,
  a.subject_to_legal_metrology,
  a.metrology_regime,
  a.regulated_interval,
  a.next_legal_verification_date,
  a.installed_at,
  a.updated_at,
  a.sync_state
FROM assets a
LEFT JOIN customers c ON c.id = a.customer_id
LEFT JOIN asset_types at ON at.id = a.asset_type_id
WHERE a.deleted_at IS NULL
`,
    )
    .all();

  const directMatch = rows.find(
    (candidate) =>
      candidate.id === identifier ||
      candidate.tag === identifier ||
      candidate.serial_number === identifier ||
      (hasNumericIdentifier &&
        (candidate.remote_id === numericIdentifier ||
          stableLocalNumericId(candidate.id) === numericIdentifier)),
  );
  if (directMatch) return directMatch;

  const normalizedIdentifier = slugifyRouteIdentifier(identifier);
  return (
    rows.find(
      (candidate) =>
        slugifyRouteIdentifier(candidate.tag) === normalizedIdentifier ||
        slugifyRouteIdentifier(candidate.serial_number) ===
          normalizedIdentifier,
    ) ?? null
  );
}

function toLocalAsset(row: LocalAssetListRow): LocalAsset {
  return {
    id: row.remote_id ?? stableLocalNumericId(row.id),
    customerId: row.customer_remote_id ?? stableLocalNumericId(row.customer_id),
    customerName: row.customer_name ?? "Cliente local",
    customerTaxId: row.customer_tax_id,
    assetTypeId:
      row.asset_type_remote_id ?? stableLocalNumericId(row.asset_type_id),
    assetTypeName: row.asset_type_name ?? "Tipo local",
    assetTypeSlug: null,
    assetTypeDefinition: parseJson(row.asset_type_definition_json) ?? null,
    name: row.name,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serial_number,
    tag: row.tag,
    status: row.status,
    baseMeasurementUnit: row.base_measurement_unit,
    specifications: parseJson(row.specifications_json),
    lastCalibrationDate: row.last_calibration_date,
    nextCalibrationDate: row.next_calibration_date,
    comments: row.comments,
    subjectToLegalMetrology: row.subject_to_legal_metrology === 1,
    metrologyRegime: row.metrology_regime,
    regulatedInterval: parseRecord(row.regulated_interval),
    nextLegalVerificationDate: row.next_legal_verification_date,
    installedAt: row.installed_at,
    createdAt: row.updated_at,
    updatedAt: row.updated_at,
    syncState: row.sync_state,
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

function resolveLocalEntityId(
  database: LocalDatabase,
  table: "customers" | "asset_types",
  numericId: number,
) {
  const remoteRow = database
    .prepare<
      { remoteId: number },
      { id: string }
    >(`SELECT id FROM ${table} WHERE remote_id = @remoteId LIMIT 1`)
    .get({ remoteId: numericId });
  if (remoteRow) return remoteRow.id;

  const rows = database
    .prepare<[], { id: string }>(`SELECT id FROM ${table}`)
    .all();
  return (
    rows.find((row) => stableLocalNumericId(row.id) === numericId)?.id ?? null
  );
}

function enqueueLocalAssetEvent(
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
  'asset',
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

function parseJson(value: string | null) {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

// Parse a stored JSON object column (e.g. `regulated_interval`) back into a plain
// record, mirroring the cloud column's `Record<string, unknown>` shape. Non-objects
// (and arrays / parse failures) collapse to null so the round-trip stays well-typed.
function parseRecord(value: string | null): Record<string, unknown> | null {
  const parsed = parseJson(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return Object.fromEntries(Object.entries(parsed));
  }
  return null;
}
