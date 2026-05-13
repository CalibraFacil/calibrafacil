import type {
  CloudSyncEvent,
  SyncBootstrapResponse,
  SyncPullResponse,
} from "@calibra-facil/contracts";
import type { LocalDatabase } from "./database";
import { setSyncCursor } from "./outbox";

type JsonRecord = Record<string, unknown>;

export function applySyncBootstrap(
  database: LocalDatabase,
  bootstrap: SyncBootstrapResponse,
  pulledAt = new Date().toISOString(),
) {
  const organizationId = bootstrap.organization.id;
  const activeUnitId = bootstrap.permissions.activeUnitId;

  database.transaction(() => {
    database
      .prepare(
        `
INSERT INTO tenant_snapshot (
  tenant_id,
  organization_id,
  active_unit_id,
  user_id,
  snapshot_json,
  pulled_at
) VALUES (
  @tenantId,
  @organizationId,
  @activeUnitId,
  @userId,
  @snapshotJson,
  @pulledAt
)
ON CONFLICT(tenant_id) DO UPDATE SET
  organization_id = excluded.organization_id,
  active_unit_id = excluded.active_unit_id,
  user_id = excluded.user_id,
  snapshot_json = excluded.snapshot_json,
  pulled_at = excluded.pulled_at
`,
      )
      .run({
        tenantId: organizationId,
        organizationId,
        activeUnitId,
        userId: bootstrap.user.id,
        snapshotJson: JSON.stringify(bootstrap),
        pulledAt,
      });

    database
      .prepare(
        `
INSERT INTO permission_snapshot (
  id,
  user_id,
  organization_id,
  unit_id,
  permissions_json,
  pulled_at
) VALUES (
  @id,
  @userId,
  @organizationId,
  @unitId,
  @permissionsJson,
  @pulledAt
)
ON CONFLICT(id) DO UPDATE SET
  unit_id = excluded.unit_id,
  permissions_json = excluded.permissions_json,
  pulled_at = excluded.pulled_at
`,
      )
      .run({
        id: `${organizationId}:${bootstrap.user.id}`,
        userId: bootstrap.user.id,
        organizationId,
        unitId: activeUnitId,
        permissionsJson: JSON.stringify(bootstrap.permissions),
        pulledAt,
      });

    database
      .prepare(
        `
INSERT INTO sync_cursors (scope, cursor, updated_at)
VALUES ('bootstrap', @cursor, @updatedAt)
ON CONFLICT(scope) DO UPDATE SET
  cursor = excluded.cursor,
  updated_at = excluded.updated_at
`,
      )
      .run({ cursor: bootstrap.syncCursor, updatedAt: pulledAt });
    database
      .prepare(
        `
INSERT INTO sync_cursors (scope, cursor, updated_at)
VALUES ('default', @cursor, @updatedAt)
ON CONFLICT(scope) DO UPDATE SET
  cursor = excluded.cursor,
  updated_at = excluded.updated_at
`,
      )
      .run({ cursor: bootstrap.syncCursor, updatedAt: pulledAt });

    for (const item of bootstrap.assetTypes) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      database
        .prepare(
          `
INSERT INTO asset_types (
  id,
  remote_id,
  organization_id,
  name,
  description,
  measurement_family,
  specifications_schema_json,
  pulled_at,
  sync_state
) VALUES (
  @id,
  @remoteId,
  @organizationId,
  @name,
  @description,
  NULL,
  @schemaJson,
  @pulledAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  specifications_schema_json = excluded.specifications_schema_json,
  pulled_at = excluded.pulled_at,
  sync_state = excluded.sync_state
`,
        )
        .run({
          id: remoteLocalId("asset-type", id),
          remoteId: id,
          organizationId,
          name: getString(row, "name") ?? `Tipo ${id}`,
          description: getNullableString(row, "description"),
          schemaJson: JSON.stringify(row.definition ?? null),
          pulledAt,
        });
    }

    for (const item of bootstrap.customers) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      database
        .prepare(
          `
INSERT INTO customers (
  id,
  remote_id,
  organization_id,
  unit_id,
  name,
  tax_id,
  email,
  phone,
  address_json,
  compliance_json,
  updated_at,
  sync_state
) VALUES (
  @id,
  @remoteId,
  @organizationId,
  @unitId,
  @name,
  @taxId,
  @email,
  @phone,
  @addressJson,
  @complianceJson,
  @updatedAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  tax_id = excluded.tax_id,
  email = excluded.email,
  phone = excluded.phone,
  address_json = excluded.address_json,
  compliance_json = excluded.compliance_json,
  updated_at = excluded.updated_at,
  sync_state = excluded.sync_state
`,
        )
        .run({
          id: remoteLocalId("customer", id),
          remoteId: id,
          organizationId,
          unitId: activeUnitId,
          name: getString(row, "name") ?? `Cliente ${id}`,
          taxId: getNullableString(row, "taxId"),
          email: getNullableString(row, "email"),
          phone: getNullableString(row, "phone"),
          addressJson: JSON.stringify(row.address ?? null),
          complianceJson: JSON.stringify(row.compliance ?? null),
          updatedAt: getDateString(row, "updatedAt") ?? pulledAt,
        });
    }

    for (const item of bootstrap.assets) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      const customerId = requiredNumber(row, "customerId");
      const assetTypeId = requiredNumber(row, "assetTypeId");
      database
        .prepare(
          `
INSERT INTO assets (
  id,
  remote_id,
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
  status,
  updated_at,
  sync_state
) VALUES (
  @id,
  @remoteId,
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
  @status,
  @updatedAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  customer_id = excluded.customer_id,
  asset_type_id = excluded.asset_type_id,
  name = excluded.name,
  serial_number = excluded.serial_number,
  tag = excluded.tag,
  manufacturer = excluded.manufacturer,
  model = excluded.model,
  base_measurement_unit = excluded.base_measurement_unit,
  specifications_json = excluded.specifications_json,
  last_calibration_date = excluded.last_calibration_date,
  next_calibration_date = excluded.next_calibration_date,
  comments = excluded.comments,
  status = excluded.status,
  updated_at = excluded.updated_at,
  sync_state = excluded.sync_state
`,
        )
        .run({
          id: remoteLocalId("asset", id),
          remoteId: id,
          organizationId,
          unitId: getNumber(row, "unitId") ?? activeUnitId ?? 0,
          customerId: remoteLocalId("customer", customerId),
          assetTypeId: remoteLocalId("asset-type", assetTypeId),
          name: getString(row, "name") ?? `Ativo ${id}`,
          serialNumber: getString(row, "serialNumber") ?? "",
          tag: getString(row, "tag") ?? String(id),
          manufacturer: getNullableString(row, "manufacturer"),
          model: getNullableString(row, "model"),
          baseMeasurementUnit: getNullableString(row, "baseMeasurementUnit"),
          specificationsJson: JSON.stringify(row.specifications ?? null),
          lastCalibrationDate: getDateString(row, "lastCalibrationDate"),
          nextCalibrationDate: getDateString(row, "nextCalibrationDate"),
          comments: getNullableString(row, "comments"),
          status: getString(row, "status") ?? "ACTIVE",
          updatedAt: getDateString(row, "updatedAt") ?? pulledAt,
        });
    }

    for (const item of bootstrap.services) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      database
        .prepare(
          `
INSERT INTO services (
  id,
  remote_id,
  organization_id,
  asset_type_id,
  name,
  description,
  method_id,
  status,
  pulled_at,
  sync_state
) VALUES (
  @id,
  @remoteId,
  @organizationId,
  @assetTypeId,
  @name,
  @description,
  @methodId,
  @status,
  @pulledAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  asset_type_id = excluded.asset_type_id,
  name = excluded.name,
  description = excluded.description,
  method_id = excluded.method_id,
  status = excluded.status,
  pulled_at = excluded.pulled_at,
  sync_state = excluded.sync_state
`,
        )
        .run({
          id: remoteLocalId("service", id),
          remoteId: id,
          organizationId,
          assetTypeId: getNumber(row, "assetTypeId")
            ? remoteLocalId("asset-type", getNumber(row, "assetTypeId")!)
            : null,
          name: getString(row, "name") ?? `Servico ${id}`,
          description: getNullableString(row, "description"),
          methodId: getNumber(row, "methodId")
            ? remoteLocalId("method", getNumber(row, "methodId")!)
            : null,
          status: getBoolean(row, "isActive") === false ? "INACTIVE" : "ACTIVE",
          pulledAt,
        });
    }

    for (const item of bootstrap.publishedMethods) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      database
        .prepare(
          `
INSERT INTO published_methods (
  id,
  remote_id,
  organization_id,
  asset_type_id,
  name,
  version,
  method_fingerprint,
  engine_version,
  engine_options_fingerprint,
  normalized_method_json,
  compiled_method_json,
  publication_evidence_json,
  pulled_at
) VALUES (
  @id,
  @remoteId,
  @organizationId,
  @assetTypeId,
  @name,
  @version,
  @methodFingerprint,
  @engineVersion,
  @engineOptionsFingerprint,
  @normalizedMethodJson,
  @compiledMethodJson,
  @publicationEvidenceJson,
  @pulledAt
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  version = excluded.version,
  method_fingerprint = excluded.method_fingerprint,
  engine_version = excluded.engine_version,
  engine_options_fingerprint = excluded.engine_options_fingerprint,
  normalized_method_json = excluded.normalized_method_json,
  compiled_method_json = excluded.compiled_method_json,
  publication_evidence_json = excluded.publication_evidence_json,
  pulled_at = excluded.pulled_at
`,
        )
        .run({
          id: remoteLocalId("method", id),
          remoteId: id,
          organizationId,
          assetTypeId: getNumber(row, "assetTypeId")
            ? remoteLocalId("asset-type", getNumber(row, "assetTypeId")!)
            : null,
          name: getString(row, "name") ?? `Metodo ${id}`,
          version: getNumber(row, "version") ?? 1,
          methodFingerprint: getString(row, "methodFingerprint") ?? String(id),
          engineVersion:
            getNestedString(row.methodEngine, "version") ?? "unknown",
          engineOptionsFingerprint:
            getNestedString(row.methodEngine, "optionsFingerprint") ??
            "unknown",
          normalizedMethodJson: JSON.stringify(row),
          compiledMethodJson: JSON.stringify(row.compiledMethod ?? null),
          publicationEvidenceJson: JSON.stringify(
            row.publicationEvidence ?? null,
          ),
          pulledAt,
        });
    }

    for (const item of bootstrap.standards) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      database
        .prepare(
          `
INSERT INTO reference_standards (
  id,
  remote_id,
  organization_id,
  unit_id,
  name,
  serial_number,
  certificate_number,
  next_calibration_date,
  status,
  snapshot_json,
  pulled_at,
  sync_state
) VALUES (
  @id,
  @remoteId,
  @organizationId,
  @unitId,
  @name,
  @serialNumber,
  @certificateNumber,
  @nextCalibrationDate,
  @status,
  @snapshotJson,
  @pulledAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  serial_number = excluded.serial_number,
  certificate_number = excluded.certificate_number,
  next_calibration_date = excluded.next_calibration_date,
  status = excluded.status,
  snapshot_json = excluded.snapshot_json,
  pulled_at = excluded.pulled_at,
  sync_state = excluded.sync_state
`,
        )
        .run({
          id: remoteLocalId("standard", id),
          remoteId: id,
          organizationId,
          unitId: getNumber(row, "unitId"),
          name: getString(row, "name") ?? `Padrao ${id}`,
          serialNumber: getNullableString(row, "serialNumber"),
          certificateNumber: getNullableString(row, "certificateNumber"),
          nextCalibrationDate: getDateString(row, "nextCalibrationDate"),
          status: getString(row, "status") ?? "ACTIVE",
          snapshotJson: JSON.stringify(row),
          pulledAt,
        });
    }

    for (const item of bootstrap.environmentalLimits) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      database
        .prepare(
          `
INSERT INTO environmental_limits (
  id,
  remote_id,
  organization_id,
  unit_id,
  name,
  limits_json,
  pulled_at,
  sync_state
) VALUES (
  @id,
  @remoteId,
  @organizationId,
  @unitId,
  @name,
  @limitsJson,
  @pulledAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  limits_json = excluded.limits_json,
  pulled_at = excluded.pulled_at,
  sync_state = excluded.sync_state
`,
        )
        .run({
          id: remoteLocalId("environmental-limit", id),
          remoteId: id,
          organizationId,
          unitId: getNumber(row, "unitId") ?? activeUnitId,
          name: `Limites ambientais ${id}`,
          limitsJson: JSON.stringify(row),
          pulledAt,
        });
    }

    for (const item of bootstrap.jobs) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      database
        .prepare(
          `
INSERT INTO calibration_jobs (
  id,
  remote_id,
  job_id,
  certificate_name,
  organization_id,
  unit_id,
  customer_id,
  asset_id,
  service_id,
  technician_id,
  method_snapshot_json,
  asset_snapshot_json,
  standards_snapshot_json,
  environmental_snapshot_json,
  calibration_location_snapshot_json,
  calibration_phase_snapshot_json,
  data_json,
  results_json,
  status,
  due_date,
  version,
  created_at,
  updated_at,
  sync_state
) VALUES (
  @id,
  @remoteId,
  @jobId,
  NULL,
  @organizationId,
  @unitId,
  @customerId,
  @assetId,
  @serviceId,
  @technicianId,
  @methodSnapshotJson,
  @assetSnapshotJson,
  @standardsSnapshotJson,
  @environmentalSnapshotJson,
  @calibrationLocationSnapshotJson,
  @calibrationPhaseSnapshotJson,
  @dataJson,
  @resultsJson,
  @status,
  @dueDate,
  0,
  @createdAt,
  @updatedAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  job_id = excluded.job_id,
  status = excluded.status,
  method_snapshot_json = excluded.method_snapshot_json,
  asset_snapshot_json = excluded.asset_snapshot_json,
  standards_snapshot_json = excluded.standards_snapshot_json,
  environmental_snapshot_json = excluded.environmental_snapshot_json,
  calibration_location_snapshot_json = excluded.calibration_location_snapshot_json,
  calibration_phase_snapshot_json = excluded.calibration_phase_snapshot_json,
  data_json = excluded.data_json,
  results_json = excluded.results_json,
  due_date = excluded.due_date,
  updated_at = excluded.updated_at,
  sync_state = excluded.sync_state
`,
        )
        .run({
          id: remoteLocalId("job", id),
          remoteId: id,
          jobId: getString(row, "jobId") ?? String(id),
          organizationId,
          unitId: getNumber(row, "unitId") ?? activeUnitId ?? 0,
          customerId: remoteLocalId(
            "customer",
            requiredNumber(row, "customerId"),
          ),
          assetId: remoteLocalId("asset", requiredNumber(row, "assetId")),
          serviceId: remoteLocalId("service", requiredNumber(row, "serviceId")),
          technicianId: getNullableString(row, "technicianId"),
          methodSnapshotJson: JSON.stringify(row.methodSnapshot ?? null),
          assetSnapshotJson: JSON.stringify(row.assetSnapshot ?? null),
          standardsSnapshotJson: JSON.stringify(row.standardsSnapshot ?? null),
          environmentalSnapshotJson: JSON.stringify(
            row.environmentalSnapshot ?? null,
          ),
          calibrationLocationSnapshotJson: JSON.stringify(
            row.calibrationLocationSnapshot ?? null,
          ),
          calibrationPhaseSnapshotJson: JSON.stringify(
            row.calibrationPhaseSnapshot ?? null,
          ),
          dataJson: JSON.stringify(row.data ?? null),
          resultsJson: JSON.stringify(row.results ?? null),
          status: getString(row, "status") ?? "DRAFT",
          dueDate: getDateString(row, "dueDate"),
          createdAt: getDateString(row, "createdAt") ?? pulledAt,
          updatedAt: getDateString(row, "updatedAt") ?? pulledAt,
        });
    }

    for (const item of bootstrap.serviceOrders ?? []) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      database
        .prepare(
          `
INSERT INTO service_orders (
  id,
  remote_id,
  service_order_number,
  organization_id,
  unit_id,
  customer_id,
  asset_id,
  client_contact_id,
  client_contact_snapshot_json,
  intake_type,
  source_service_order_id,
  status,
  priority,
  responsible_technician_id,
  claimed_defect,
  intake_condition,
  accessories,
  old_seal_number,
  new_seal_number,
  repaired_seal_number,
  inmetro_repair_seal_number,
  invoice_remittance_number,
  invoice_remittance_key,
  invoice_remittance_issued_at,
  carrier_name,
  carrier_document,
  third_party_name,
  third_party_document,
  third_party_phone,
  delivery_method,
  internal_notes,
  client_visible_notes,
  evaluation_fee_cents,
  warranty_until,
  warranty_terms,
  opened_at,
  updated_at,
  sync_state
) VALUES (
  @id,
  @remoteId,
  @serviceOrderNumber,
  @organizationId,
  @unitId,
  @customerId,
  @assetId,
  @clientContactId,
  @clientContactSnapshotJson,
  @intakeType,
  @sourceServiceOrderId,
  @status,
  @priority,
  @responsibleTechnicianId,
  @claimedDefect,
  @intakeCondition,
  @accessories,
  @oldSealNumber,
  @newSealNumber,
  @repairedSealNumber,
  @inmetroRepairSealNumber,
  @invoiceRemittanceNumber,
  @invoiceRemittanceKey,
  @invoiceRemittanceIssuedAt,
  @carrierName,
  @carrierDocument,
  @thirdPartyName,
  @thirdPartyDocument,
  @thirdPartyPhone,
  @deliveryMethod,
  @internalNotes,
  @clientVisibleNotes,
  @evaluationFeeCents,
  @warrantyUntil,
  @warrantyTerms,
  @openedAt,
  @updatedAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  service_order_number = excluded.service_order_number,
  customer_id = excluded.customer_id,
  asset_id = excluded.asset_id,
  status = excluded.status,
  priority = excluded.priority,
  responsible_technician_id = excluded.responsible_technician_id,
  claimed_defect = excluded.claimed_defect,
  intake_condition = excluded.intake_condition,
  updated_at = excluded.updated_at,
  sync_state = excluded.sync_state
`,
        )
        .run({
          id: remoteLocalId("service-order", id),
          remoteId: id,
          serviceOrderNumber:
            getString(row, "serviceOrderNumber") ?? `OS-${id}`,
          organizationId,
          unitId: getNumber(row, "unitId") ?? activeUnitId ?? 0,
          customerId: remoteLocalId(
            "customer",
            requiredNumber(row, "customerId"),
          ),
          assetId: remoteLocalId("asset", requiredNumber(row, "assetId")),
          clientContactId: getNumber(row, "clientContactId"),
          clientContactSnapshotJson: JSON.stringify(
            row.clientContactSnapshot ?? null,
          ),
          intakeType: getString(row, "intakeType") ?? "counter",
          sourceServiceOrderId: getNumber(row, "sourceServiceOrderId"),
          status: getString(row, "status") ?? "awaiting_tech_evaluation",
          priority: getString(row, "priority") ?? "normal",
          responsibleTechnicianId: getNullableString(
            row,
            "responsibleTechnicianId",
          ),
          claimedDefect: getString(row, "claimedDefect") ?? "",
          intakeCondition: getString(row, "intakeCondition") ?? "",
          accessories: getNullableString(row, "accessories"),
          oldSealNumber: getNullableString(row, "oldSealNumber"),
          newSealNumber: getNullableString(row, "newSealNumber"),
          repairedSealNumber: getNullableString(row, "repairedSealNumber"),
          inmetroRepairSealNumber: getNullableString(
            row,
            "inmetroRepairSealNumber",
          ),
          invoiceRemittanceNumber: getNullableString(
            row,
            "invoiceRemittanceNumber",
          ),
          invoiceRemittanceKey: getNullableString(row, "invoiceRemittanceKey"),
          invoiceRemittanceIssuedAt: getDateString(
            row,
            "invoiceRemittanceIssuedAt",
          ),
          carrierName: getNullableString(row, "carrierName"),
          carrierDocument: getNullableString(row, "carrierDocument"),
          thirdPartyName: getNullableString(row, "thirdPartyName"),
          thirdPartyDocument: getNullableString(row, "thirdPartyDocument"),
          thirdPartyPhone: getNullableString(row, "thirdPartyPhone"),
          deliveryMethod: getString(row, "deliveryMethod") ?? "pickup_at_lab",
          internalNotes: getNullableString(row, "internalNotes"),
          clientVisibleNotes: getNullableString(row, "clientVisibleNotes"),
          evaluationFeeCents: getNumber(row, "evaluationFeeCents") ?? 0,
          warrantyUntil: getDateString(row, "warrantyUntil"),
          warrantyTerms: getNullableString(row, "warrantyTerms"),
          openedAt: getDateString(row, "openedAt") ?? pulledAt,
          updatedAt: getDateString(row, "updatedAt") ?? pulledAt,
        });
    }
  })();
}

export function applySyncPullResponse(
  database: LocalDatabase,
  response: SyncPullResponse,
  pulledAt = new Date().toISOString(),
) {
  if (response.events.length > 0) {
    const base = getLocalSessionSnapshot(database);
    if (!base) {
      throw new Error(
        "Cannot apply sync pull before bootstrap snapshot exists",
      );
    }

    applySyncBootstrap(
      database,
      {
        ...base,
        serverTime: pulledAt,
        syncCursor: response.cursor,
        publishedMethods: eventsFor(response.events, "published_method"),
        assetTypes: eventsFor(response.events, "asset_type"),
        customers: eventsFor(response.events, "customer"),
        assets: eventsFor(response.events, "asset"),
        services: eventsFor(response.events, "service"),
        standards: eventsFor(response.events, "reference_standard"),
        environmentalLimits: eventsFor(response.events, "environmental_limit"),
        jobs: eventsFor(response.events, "calibration_job"),
        serviceOrders: eventsFor(response.events, "service_order"),
      },
      pulledAt,
    );
    return;
  }

  setSyncCursor(database, response.cursor);
}

function remoteLocalId(kind: string, remoteId: number) {
  return `${kind}:${remoteId}`;
}

export function getLocalSessionSnapshot(database: LocalDatabase) {
  const row = database
    .prepare(
      `
SELECT snapshot_json
FROM tenant_snapshot
ORDER BY pulled_at DESC
LIMIT 1
`,
    )
    .get() as { snapshot_json: string } | undefined;

  if (!row) return null;

  const parsed = parseJson(row.snapshot_json);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  return parsed as SyncBootstrapResponse;
}

function eventsFor(
  events: CloudSyncEvent[],
  entityType: CloudSyncEvent["entityType"],
) {
  return events
    .filter(
      (event) =>
        event.entityType === entityType && event.operation === "upsert",
    )
    .map((event) => event.payload);
}

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object") {
    return value as JsonRecord;
  }

  return {};
}

function requiredNumber(row: JsonRecord, key: string) {
  const value = getNumber(row, key);
  if (value === null) {
    throw new Error(`Sync bootstrap item is missing numeric ${key}`);
  }

  return value;
}

function getNumber(row: JsonRecord, key: string) {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getString(row: JsonRecord, key: string) {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNullableString(row: JsonRecord, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getBoolean(row: JsonRecord, key: string) {
  const value = row[key];
  return typeof value === "boolean" ? value : null;
}

function getDateString(row: JsonRecord, key: string) {
  const value = row[key];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

function getNestedString(value: unknown, key: string) {
  if (!value || typeof value !== "object") return null;
  const nested = (value as JsonRecord)[key];
  return typeof nested === "string" ? nested : null;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
