import { syncBootstrapResponseSchema } from "@calibra-facil/contracts";
import type {
  CloudSyncEvent,
  SyncBootstrapPageResponse,
  SyncBootstrapResponse,
  SyncPullResponse,
} from "@calibra-facil/contracts";
import type { LocalDatabase } from "./database";
import { setSyncCursor } from "./outbox";
import { resolveServiceOrdersForAggregates } from "./service-orders";
import { recordSkippedRow } from "./skipped-rows";

type JsonRecord = Record<string, unknown>;

/** A pulled row that was left untouched because local changes are queued. */
export type SkippedPulledRow = {
  entityType: "customer" | "asset" | "calibration_job" | "service_order";
  localId: string;
};

const EMPTY_ENTITY_ARRAYS = {
  publishedMethods: [],
  assetTypes: [],
  customers: [],
  assets: [],
  services: [],
  standards: [],
  massCompositionProfiles: [],
  environmentalLimits: [],
  jobs: [],
  serviceOrders: [],
};

export type ApplySyncSummary = {
  skipped: SkippedPulledRow[];
};

/**
 * Apply a cloud snapshot/delta to the local cache.
 *
 * A pulled row never overwrites a row that still has queued local changes (an
 * outbox event that is pending, failed or in conflict). The upserts used to be
 * blind and forced `sync_state = 'synced'`, so any pull that arrived while an
 * edit was waiting silently replaced the edit; since the push cursor bug made
 * every pull restart from the epoch, that happened on every sync.
 *
 * The row is skipped, not merged, and no local conflict is recorded here: the
 * conflict model is server-detected. The skipped row keeps its
 * `remote_base_updated_at` anchor, so the queued edit is pushed with the base
 * it was really made against and the cloud answers `concurrent_update`
 * (STALE_BASE_VERSION, with the current cloud fields) if the row moved on. That
 * lands in `sync_conflicts` through the normal push path, where the conflicts
 * UI already shows local vs cloud values. Overwriting the anchor instead would
 * have hidden the divergence from the server. Once the queued change is
 * accepted the row is clean again and the next pull applies normally.
 */
export type ApplySyncOptions = {
  /**
   * Write the pull cursor the response carries (`syncCursor`). A page of the paged
   * bootstrap does not: the cursor is only valid once the LAST page is applied, so the
   * caller writes it then. Default true.
   */
  writeCursors?: boolean;
  /**
   * Protocol 3: `<entityType>:<remote id>` -> the pull cursor that returns that row's
   * change again, recorded on a row that is skipped because of queued local changes.
   */
  resumeCursors?: ReadonlyMap<string, string>;
  /** The snapshot keeps the session header only, not the (possibly huge) entity arrays. */
  headerOnlySnapshot?: boolean;
};

export function applySyncBootstrap(
  database: LocalDatabase,
  bootstrap: SyncBootstrapResponse,
  pulledAt = new Date().toISOString(),
  options: ApplySyncOptions = {},
): ApplySyncSummary {
  const organizationId = bootstrap.organization.id;
  const activeUnitId = bootstrap.permissions.activeUnitId;
  const skipped: SkippedPulledRow[] = [];
  const writeCursors = options.writeCursors ?? true;

  database.transaction(() => {
    const pending = loadPendingLocalChanges(database);
    pending.resumeCursors = options.resumeCursors ?? new Map();

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
        snapshotJson: JSON.stringify(
          options.headerOnlySnapshot
            ? { ...bootstrap, ...EMPTY_ENTITY_ARRAYS }
            : bootstrap,
        ),
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

    if (writeCursors) {
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
    }

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
  slug,
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
  @slug,
  @description,
  NULL,
  @schemaJson,
  @pulledAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  slug = excluded.slug,
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
          slug: getNullableString(row, "slug"),
          description: getNullableString(row, "description"),
          schemaJson: JSON.stringify(row.definition ?? null),
          pulledAt,
        });
    }

    for (const item of bootstrap.customers) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      if (
        skipPendingRow(
          database,
          pending,
          skipped,
          row,
          "customer",
          "customer",
          id,
        )
      )
        continue;
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
  remote_base_updated_at,
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
  @remoteBaseUpdatedAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  deleted_at = NULL,
  name = excluded.name,
  tax_id = excluded.tax_id,
  email = excluded.email,
  phone = excluded.phone,
  address_json = excluded.address_json,
  compliance_json = excluded.compliance_json,
  updated_at = excluded.updated_at,
  remote_base_updated_at = excluded.remote_base_updated_at,
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
          remoteBaseUpdatedAt: getDateString(row, "updatedAt"),
        });
    }

    for (const item of bootstrap.assets) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      if (skipPendingRow(database, pending, skipped, row, "asset", "asset", id))
        continue;
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
  metrology_regime,
  regulated_interval,
  next_legal_verification_date,
  installed_at,
  status,
  updated_at,
  remote_base_updated_at,
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
  @metrologyRegime,
  @regulatedIntervalJson,
  @nextLegalVerificationDate,
  @installedAt,
  @status,
  @updatedAt,
  @remoteBaseUpdatedAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  deleted_at = NULL,
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
  metrology_regime = excluded.metrology_regime,
  regulated_interval = excluded.regulated_interval,
  next_legal_verification_date = excluded.next_legal_verification_date,
  installed_at = excluded.installed_at,
  status = excluded.status,
  updated_at = excluded.updated_at,
  remote_base_updated_at = excluded.remote_base_updated_at,
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
          metrologyRegime: getString(row, "metrologyRegime") ?? "INDUSTRIAL",
          regulatedIntervalJson: JSON.stringify(row.regulatedInterval ?? null),
          nextLegalVerificationDate: getDateString(
            row,
            "nextLegalVerificationDate",
          ),
          installedAt: getDateString(row, "installedAt"),
          status: getString(row, "status") ?? "ACTIVE",
          updatedAt: getDateString(row, "updatedAt") ?? pulledAt,
          remoteBaseUpdatedAt: getDateString(row, "updatedAt"),
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

    for (const item of bootstrap.massCompositionProfiles ?? []) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      database
        .prepare(
          `
INSERT INTO mass_composition_profiles (
  id,
  remote_id,
  organization_id,
  profile_key,
  profile_class,
  nominal_g,
  snapshot_json,
  pulled_at,
  sync_state
) VALUES (
  @id,
  @remoteId,
  @organizationId,
  @profileKey,
  @profileClass,
  @nominalG,
  @snapshotJson,
  @pulledAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  profile_key = excluded.profile_key,
  profile_class = excluded.profile_class,
  nominal_g = excluded.nominal_g,
  snapshot_json = excluded.snapshot_json,
  pulled_at = excluded.pulled_at,
  sync_state = excluded.sync_state
`,
        )
        .run({
          id: remoteLocalId("mass_composition_profile", id),
          remoteId: id,
          organizationId,
          profileKey: getString(row, "profileKey") ?? "",
          profileClass: getString(row, "profileClass") ?? "",
          nominalG: getNumber(row, "nominalG") ?? 0,
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
      if (
        skipPendingRow(
          database,
          pending,
          skipped,
          row,
          "calibration_job",
          "job",
          id,
        )
      ) {
        continue;
      }
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
  scope_compliance_status,
  scope_compliance_findings_json,
  scope_override_justification,
  method_deviations,
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
  @certificateName,
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
  @scopeComplianceStatus,
  @scopeComplianceFindingsJson,
  @scopeOverrideJustification,
  @methodDeviations,
  @status,
  @dueDate,
  0,
  @createdAt,
  @updatedAt,
  'synced'
)
ON CONFLICT(id) DO UPDATE SET
  deleted_at = NULL,
  job_id = excluded.job_id,
  certificate_name = excluded.certificate_name,
  status = excluded.status,
  method_snapshot_json = excluded.method_snapshot_json,
  asset_snapshot_json = excluded.asset_snapshot_json,
  standards_snapshot_json = excluded.standards_snapshot_json,
  environmental_snapshot_json = excluded.environmental_snapshot_json,
  calibration_location_snapshot_json = excluded.calibration_location_snapshot_json,
  calibration_phase_snapshot_json = excluded.calibration_phase_snapshot_json,
  data_json = excluded.data_json,
  results_json = excluded.results_json,
  scope_compliance_status = excluded.scope_compliance_status,
  scope_compliance_findings_json = excluded.scope_compliance_findings_json,
  scope_override_justification = excluded.scope_override_justification,
  method_deviations = excluded.method_deviations,
  due_date = excluded.due_date,
  updated_at = excluded.updated_at,
  sync_state = excluded.sync_state
`,
        )
        .run({
          id: remoteLocalId("job", id),
          remoteId: id,
          jobId: getString(row, "jobId") ?? String(id),
          certificateName: getNullableString(row, "certificateName"),
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
          scopeComplianceStatus: getNullableString(
            row,
            "scopeComplianceStatus",
          ),
          scopeComplianceFindingsJson: JSON.stringify(
            row.scopeComplianceFindings ?? null,
          ),
          scopeOverrideJustification: getNullableString(
            row,
            "scopeOverrideJustification",
          ),
          // §7.8.2.1(n) — mirrored so an offline execution keeps it.
          methodDeviations: getNullableString(row, "methodDeviations"),
          status: getString(row, "status") ?? "DRAFT",
          dueDate: getDateString(row, "dueDate"),
          createdAt: getDateString(row, "createdAt") ?? pulledAt,
          updatedAt: getDateString(row, "updatedAt") ?? pulledAt,
        });
    }

    for (const item of bootstrap.serviceOrders ?? []) {
      const row = asRecord(item);
      const id = requiredNumber(row, "id");
      if (
        skipPendingRow(
          database,
          pending,
          skipped,
          row,
          "service_order",
          "service-order",
          id,
        )
      ) {
        continue;
      }
      database
        .prepare(
          `
INSERT INTO service_orders (
  id,
  remote_id,
  public_id,
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
  removed_sealing_mark_number,
  affixed_sealing_mark_number,
  inmetro_repair_mark_number,
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
  @publicId,
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
  @removedSealingMarkNumber,
  @affixedSealingMarkNumber,
  @inmetroRepairMarkNumber,
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
  public_id = excluded.public_id,
  service_order_number = excluded.service_order_number,
  customer_id = excluded.customer_id,
  asset_id = excluded.asset_id,
  status = excluded.status,
  priority = excluded.priority,
  responsible_technician_id = excluded.responsible_technician_id,
  claimed_defect = excluded.claimed_defect,
  intake_condition = excluded.intake_condition,
  updated_at = excluded.updated_at,
  -- A quote/execution/delivery child of this order is still queued: the header
  -- is refreshed, but the order stays dirty until that child is accepted.
  sync_state = CASE WHEN @keepSyncState = 1
    THEN service_orders.sync_state ELSE excluded.sync_state END
`,
        )
        .run({
          keepSyncState: pending.serviceOrdersWithQueuedChildren.has(
            remoteLocalId("service-order", id),
          )
            ? 1
            : 0,
          id: remoteLocalId("service-order", id),
          remoteId: id,
          // Opaque cloud id the dashboard routes with, so a synced OS has the
          // same URL in both runtimes.
          publicId: getString(row, "publicId") ?? null,
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
          removedSealingMarkNumber: getNullableString(
            row,
            "removedSealingMarkNumber",
          ),
          affixedSealingMarkNumber: getNullableString(
            row,
            "affixedSealingMarkNumber",
          ),
          inmetroRepairMarkNumber: getNullableString(
            row,
            "inmetroRepairMarkNumber",
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

  return { skipped };
}

export function applySyncPullResponse(
  database: LocalDatabase,
  response: SyncPullResponse,
  pulledAt = new Date().toISOString(),
): ApplySyncSummary {
  if (response.events.length === 0) {
    setSyncCursor(database, response.cursor);
    return { skipped: [] };
  }

  const base = getLocalSessionSnapshot(database);
  if (!base) {
    throw new Error("Cannot apply sync pull before bootstrap snapshot exists");
  }

  // Protocol 3 events say which log position returned them: a row skipped below
  // because of queued local changes remembers it (skipped-rows.ts).
  const resumeCursors = new Map(
    response.events.flatMap((event) =>
      event.resumeCursor === undefined
        ? []
        : [[`${event.entityType}:${event.entityId}`, event.resumeCursor]],
    ),
  );

  return database.transaction(() => {
    const summary = applySyncBootstrap(
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
        massCompositionProfiles: eventsFor(
          response.events,
          "mass_composition_profile",
        ),
        environmentalLimits: eventsFor(response.events, "environmental_limit"),
        jobs: eventsFor(response.events, "calibration_job"),
        serviceOrders: eventsFor(response.events, "service_order"),
      },
      pulledAt,
      { resumeCursors },
    );

    summary.skipped.push(
      ...applyCloudDeletions(database, response.events, resumeCursors),
    );
    return summary;
  })();
}

/**
 * Remove the local mirror of every row the cloud deleted, soft-deleted or moved out of
 * this desktop's scope (a delete event: the cloud pull of protocol 3 sends one for each,
 * the legacy pull only for soft-deleted assets and standards).
 *
 * How a row goes depends on what the local tables keep: assets, customers and jobs have
 * `deleted_at` (every local query already filters it, and local history keeps pointing
 * at them); reference standards carry the `deleted` state; the read-only mirrors with
 * neither (asset types, services, methods, limits, mass profiles, service orders) are
 * deleted.
 *
 * A customer, asset, job or service order with queued local changes is left alone and
 * reported as skipped, for the same reason an upsert is: the queued edit must reach the
 * cloud (which answers it with the conflict) instead of vanishing silently. It is
 * remembered (skipped-rows.ts) and its delete is applied once the changes settle.
 */
function applyCloudDeletions(
  database: LocalDatabase,
  events: CloudSyncEvent[],
  resumeCursors: ReadonlyMap<string, string> = new Map(),
): SkippedPulledRow[] {
  const deletions = events.filter((event) => event.operation === "delete");
  if (deletions.length === 0) return [];

  const pending = loadPendingLocalChanges(database);
  pending.resumeCursors = resumeCursors;
  const skipped: SkippedPulledRow[] = [];

  for (const event of deletions) {
    const remoteId = Number(event.entityId);
    if (!Number.isInteger(remoteId)) continue;
    removeLocalMirror(database, pending, skipped, {
      entityType: event.entityType,
      remoteId,
      // A soft-deleted row says when; a tombstone for a row that is gone or out of scope
      // has no payload date, so the event's own time stands in.
      deletedAt:
        getDateString(asRecord(event.payload), "deletedAt") ?? event.occurredAt,
      // The deletion's own version: what a re-fetch has to bring back.
      version:
        getDateString(asRecord(event.payload), "updatedAt") ?? event.occurredAt,
    });
  }

  return skipped;
}

type MirrorRemoval = {
  entityType: CloudSyncEvent["entityType"];
  remoteId: number;
  deletedAt: string;
  version: string;
};

const SOFT_DELETED_AGGREGATES = {
  customer: { table: "customers", prefix: "customer" },
  asset: { table: "assets", prefix: "asset" },
  calibration_job: { table: "calibration_jobs", prefix: "job" },
} as const;

const HARD_DELETED_MIRRORS = {
  asset_type: { table: "asset_types", prefix: "asset-type" },
  service: { table: "services", prefix: "service" },
  published_method: { table: "published_methods", prefix: "method" },
  environmental_limit: {
    table: "environmental_limits",
    prefix: "environmental-limit",
  },
  mass_composition_profile: {
    table: "mass_composition_profiles",
    prefix: "mass_composition_profile",
  },
} as const;

function removeLocalMirror(
  database: LocalDatabase,
  pending: PendingLocalChanges,
  skipped: SkippedPulledRow[],
  removal: MirrorRemoval,
) {
  const { entityType, remoteId, deletedAt } = removal;

  if (
    entityType === "customer" ||
    entityType === "asset" ||
    entityType === "calibration_job"
  ) {
    const { table, prefix } = SOFT_DELETED_AGGREGATES[entityType];
    if (
      skipPendingRow(
        database,
        pending,
        skipped,
        { updatedAt: removal.version },
        entityType,
        prefix,
        remoteId,
      )
    ) {
      return;
    }
    database
      .prepare(
        `
UPDATE ${table}
SET deleted_at = @deletedAt,
  sync_state = 'synced'
WHERE id = @id AND deleted_at IS NULL
`,
      )
      .run({ id: remoteLocalId(prefix, remoteId), deletedAt });
    return;
  }

  if (entityType === "service_order") {
    const localId = remoteLocalId("service-order", remoteId);
    if (
      skipPendingRow(
        database,
        pending,
        skipped,
        { updatedAt: removal.version },
        "service_order",
        "service-order",
        remoteId,
      ) ||
      pending.serviceOrdersWithQueuedChildren.has(localId)
    ) {
      return;
    }
    database.prepare("DELETE FROM service_orders WHERE id = ?").run(localId);
    return;
  }

  if (entityType === "reference_standard") {
    // reference_standards has no deleted_at: 'deleted' is the state every
    // local standards query already filters out.
    database
      .prepare(
        `
UPDATE reference_standards
SET sync_state = 'deleted',
  pulled_at = @deletedAt
WHERE id = @id
`,
      )
      .run({ id: remoteLocalId("standard", remoteId), deletedAt });
    return;
  }

  const { table, prefix } = HARD_DELETED_MIRRORS[entityType];
  database
    .prepare(`DELETE FROM ${table} WHERE id = ?`)
    .run(remoteLocalId(prefix, remoteId));
}

type PendingLocalChanges = {
  /** Protocol 3: the cursor that returns a row's change again (see ApplySyncOptions). */
  resumeCursors: ReadonlyMap<string, string>;
  /** `<kind>:<local id>` of every aggregate with an unsettled outbox event. */
  aggregates: Set<string>;
  /** Service orders whose own row is clean but a child event is still queued. */
  serviceOrdersWithQueuedChildren: Set<string>;
};

const PULLED_AGGREGATE_TABLES = {
  customer: { table: "customers", prefix: "customer" },
  asset: { table: "assets", prefix: "asset" },
  calibration_job: { table: "calibration_jobs", prefix: "job" },
  service_order: { table: "service_orders", prefix: "service-order" },
} as const;

/**
 * What still has to be pushed. "Unsettled" is every outbox status but
 * `synced`: pending and failed events will be retried, and a conflict event is
 * waiting for the user, so all of them mean the local row differs from the
 * cloud on purpose.
 *
 * A locally created row that was accepted keeps its own local id and gains a
 * `remote_id`, while the pull addresses rows as `<prefix>:<remote id>`; the
 * remote-addressed id is added too so the queued edit is recognised either way.
 */
function loadPendingLocalChanges(database: LocalDatabase): PendingLocalChanges {
  const events = database
    .prepare<[], { kind: string; id: string }>(
      `
SELECT DISTINCT e.aggregate_kind AS kind, e.aggregate_id AS id
FROM outbox o
JOIN domain_events e ON e.event_id = o.event_id
WHERE o.status NOT IN ('synced', 'discarded')
`,
    )
    .all();

  const aggregates = new Set(
    events.map((event) => `${event.kind}:${event.id}`),
  );

  for (const [kind, { table, prefix }] of Object.entries(
    PULLED_AGGREGATE_TABLES,
  )) {
    const ids = events.filter((event) => event.kind === kind);
    for (const chunk of chunked(ids, 500)) {
      const rows = database
        .prepare<
          string[],
          { remote_id: number | null }
        >(`SELECT remote_id FROM ${table} WHERE remote_id IS NOT NULL AND id IN (${chunk.map(() => "?").join(", ")})`)
        .all(...chunk.map((event) => event.id));
      for (const row of rows) {
        if (row.remote_id !== null) {
          aggregates.add(`${kind}:${remoteLocalId(prefix, row.remote_id)}`);
        }
      }
    }
  }

  const serviceOrdersWithQueuedChildren = new Set<string>();
  for (const orderId of resolveServiceOrdersForAggregates(database, events)) {
    if (aggregates.has(`service_order:${orderId}`)) continue;

    serviceOrdersWithQueuedChildren.add(orderId);
    const remoteId = database
      .prepare<
        [string],
        { remote_id: number | null }
      >("SELECT remote_id FROM service_orders WHERE id = ?")
      .get(orderId)?.remote_id;
    if (remoteId !== null && remoteId !== undefined) {
      serviceOrdersWithQueuedChildren.add(
        remoteLocalId("service-order", remoteId),
      );
    }
  }

  return {
    aggregates,
    serviceOrdersWithQueuedChildren,
    resumeCursors: new Map(),
  };
}

function skipPendingRow(
  database: LocalDatabase,
  pending: PendingLocalChanges,
  skipped: SkippedPulledRow[],
  row: JsonRecord,
  entityType: SkippedPulledRow["entityType"],
  prefix: string,
  remoteId: number,
) {
  const localId = remoteLocalId(prefix, remoteId);
  if (!pending.aggregates.has(`${entityType}:${localId}`)) return false;

  skipped.push({ entityType, localId });
  // The cursor moves past this row: remember it so it is fetched again once
  // its queued changes settle (see skipped-rows.ts).
  recordSkippedRow(database, {
    entityType,
    localId,
    remoteId,
    cloudUpdatedAt: getDateString(row, "updatedAt"),
    resumeCursor:
      pending.resumeCursors.get(`${entityType}:${remoteId}`) ?? null,
  });
  return true;
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function remoteLocalId(kind: string, remoteId: number) {
  return `${kind}:${remoteId}`;
}

export function getLocalSessionSnapshot(database: LocalDatabase) {
  const row = database
    .prepare<[], { snapshot_json: string }>(
      `
SELECT snapshot_json
FROM tenant_snapshot
ORDER BY pulled_at DESC
LIMIT 1
`,
    )
    .get();

  if (!row) return null;

  const parsed = parseJson(row.snapshot_json);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const snapshot = syncBootstrapResponseSchema.safeParse(parsed);
  return snapshot.success ? snapshot.data : null;
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
    return Object.fromEntries(Object.entries(value));
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
  const nested = Object.fromEntries(Object.entries(value))[key];
  return typeof nested === "string" ? nested : null;
}

function parseJson(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The paged bootstrap (protocol 3, docs/architecture/sync-change-seq.md)
// ---------------------------------------------------------------------------

/** `sync_cursors` scope holding the token of the next page of a bootstrap in progress. */
const BOOTSTRAP_PAGE_SCOPE = "bootstrap-page";

/**
 * The token to resume the bootstrap in progress from (the page after the last one that
 * was applied), or null when no bootstrap is in progress.
 */
export function getBootstrapPageToken(database: LocalDatabase): string | null {
  return (
    database
      .prepare<
        [string],
        { cursor: string | null }
      >("SELECT cursor FROM sync_cursors WHERE scope = ?")
      .get(BOOTSTRAP_PAGE_SCOPE)?.cursor ?? null
  );
}

/**
 * A bootstrap that started and did not reach its last page: the local mirror is partial
 * and there is no pull cursor yet, so the next sync resumes the bootstrap instead of pulling.
 */
export function hasIncompleteBootstrap(database: LocalDatabase): boolean {
  return getBootstrapPageToken(database) !== null;
}

/** Forget the bootstrap in progress (a token the cloud no longer accepts): the next one starts over. */
export function discardBootstrapProgress(database: LocalDatabase) {
  database.transaction(() => {
    database
      .prepare("DELETE FROM sync_cursors WHERE scope = ?")
      .run(BOOTSTRAP_PAGE_SCOPE);
    database.prepare("DELETE FROM sync_bootstrap_seen").run();
  })();
}

const BOOTSTRAP_PAGE_ARRAYS = [
  ["asset_type", "assetTypes"],
  ["customer", "customers"],
  ["asset", "assets"],
  ["service", "services"],
  ["reference_standard", "standards"],
  ["environmental_limit", "environmentalLimits"],
  ["calibration_job", "jobs"],
  ["service_order", "serviceOrders"],
  ["published_method", "publishedMethods"],
  ["mass_composition_profile", "massCompositionProfiles"],
] as const satisfies ReadonlyArray<
  readonly [CloudSyncEvent["entityType"], keyof SyncBootstrapPageResponse]
>;

/**
 * The local mirror tables a completed bootstrap reconciles: which rows are mirrors of a
 * cloud row (their id is the remote-addressed `<prefix>:<remote id>`, not a locally
 * created id that was accepted later) and which of those are still live.
 */
const BOOTSTRAP_MIRRORS = {
  asset_type: { table: "asset_types", prefix: "asset-type", live: "1 = 1" },
  customer: {
    table: "customers",
    prefix: "customer",
    live: "deleted_at IS NULL",
  },
  asset: { table: "assets", prefix: "asset", live: "deleted_at IS NULL" },
  service: { table: "services", prefix: "service", live: "1 = 1" },
  reference_standard: {
    table: "reference_standards",
    prefix: "standard",
    live: "sync_state <> 'deleted'",
  },
  environmental_limit: {
    table: "environmental_limits",
    prefix: "environmental-limit",
    live: "1 = 1",
  },
  calibration_job: {
    table: "calibration_jobs",
    prefix: "job",
    live: "deleted_at IS NULL",
  },
  service_order: {
    table: "service_orders",
    prefix: "service-order",
    live: "1 = 1",
  },
  published_method: {
    table: "published_methods",
    prefix: "method",
    live: "1 = 1",
  },
  mass_composition_profile: {
    table: "mass_composition_profiles",
    prefix: "mass_composition_profile",
    live: "1 = 1",
  },
} as const satisfies Record<
  CloudSyncEvent["entityType"],
  { table: string; prefix: string; live: string }
>;

/**
 * Apply ONE page of the paged bootstrap, atomically with the bookkeeping that lets an
 * interrupted bootstrap resume at the next page: the rows, the ids delivered so far, and
 * the token of the page after this one all commit together or not at all.
 *
 * - The first page (`first`) starts a bootstrap: no pull cursor is valid until it
 *   finishes, so the cursor is cleared and the delivered ids are forgotten.
 * - Every page upserts like the unpaged bootstrap does (a row with queued local changes is
 *   skipped) and records the ids it carried.
 * - The last page (`nextToken` null) completes it: the pull cursor becomes `syncCursor`,
 *   and a mirror row the cloud did NOT deliver in any page is gone from the cloud (deleted
 *   or moved out of scope while this desktop could not hear it): it is removed the way a
 *   delete event removes it (a row with queued changes is skipped, not lost).
 */
export function applySyncBootstrapPage(
  database: LocalDatabase,
  page: SyncBootstrapPageResponse,
  options: { first: boolean },
  pulledAt = new Date().toISOString(),
): ApplySyncSummary {
  return database.transaction(() => {
    if (options.first) {
      database.prepare("DELETE FROM sync_bootstrap_seen").run();
      setSyncCursor(database, null);
    }

    const summary = applySyncBootstrap(database, page, pulledAt, {
      writeCursors: false,
      headerOnlySnapshot: true,
    });

    const remember = database.prepare(
      "INSERT OR IGNORE INTO sync_bootstrap_seen (entity_type, remote_id) VALUES (?, ?)",
    );
    for (const [entityType, key] of BOOTSTRAP_PAGE_ARRAYS) {
      for (const item of page[key] ?? []) {
        const id = getNumber(asRecord(item), "id");
        if (id !== null) remember.run(entityType, id);
      }
    }

    if (page.page.nextToken !== null) {
      setSyncCursor(database, page.page.nextToken, BOOTSTRAP_PAGE_SCOPE);
      return summary;
    }

    summary.skipped.push(
      ...removeRowsTheBootstrapDidNotDeliver(database, pulledAt),
    );
    setSyncCursor(database, page.syncCursor, "bootstrap");
    setSyncCursor(database, page.syncCursor);
    database
      .prepare("DELETE FROM sync_cursors WHERE scope = ?")
      .run(BOOTSTRAP_PAGE_SCOPE);
    database.prepare("DELETE FROM sync_bootstrap_seen").run();
    return summary;
  })();
}

function removeRowsTheBootstrapDidNotDeliver(
  database: LocalDatabase,
  pulledAt: string,
): SkippedPulledRow[] {
  const pending = loadPendingLocalChanges(database);
  const skipped: SkippedPulledRow[] = [];

  for (const [entityType] of BOOTSTRAP_PAGE_ARRAYS) {
    const { table, prefix, live } = BOOTSTRAP_MIRRORS[entityType];
    const undelivered = database
      .prepare<
        [string],
        { remote_id: number }
      >(`SELECT remote_id FROM ${table} WHERE remote_id IS NOT NULL AND id = '${prefix}:' || remote_id AND ${live} AND remote_id NOT IN (SELECT remote_id FROM sync_bootstrap_seen WHERE entity_type = ?)`)
      .all(entityType);
    for (const row of undelivered) {
      removeLocalMirror(database, pending, skipped, {
        entityType,
        remoteId: row.remote_id,
        deletedAt: pulledAt,
        version: pulledAt,
      });
    }
  }

  return skipped;
}
