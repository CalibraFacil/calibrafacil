/**
 * What the desktop mirrors, as the API reads it: one source per entity type, shared by
 * the commit-ordered pull (rows looked up by id after the change log named them) and by
 * the paged bootstrap (rows walked by id). docs/architecture/sync-change-seq.md.
 *
 * The scope is the desktop's: the laboratory (the `OrgDb` handle adds it to every
 * query) and the unit scope of the request (`buildUnitScopeCondition`, the same
 * predicate the legacy pull and bootstrap use). There is NO technician predicate: a job
 * reassigned to another technician stays in scope, a job moved to another unit leaves it.
 *
 * Payloads are the columns the legacy pull sends (`routes/sync/pull.ts`, deprecated), plus
 * `deletedAt` on the two soft-deleted entities, so the desktop's upsert code is shared by
 * both protocols.
 */
import {
  type AnyColumn,
  type SQL,
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
} from "drizzle-orm";
import type { PgTable, SelectedFields } from "drizzle-orm/pg-core";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationMethod,
  customer,
  environmentalLimits,
  massCompositionProfile,
  referenceStandard,
  service,
  serviceOrder,
} from "@calibra-facil/db/schema";
import type { SyncChangeEntityType } from "@calibra-facil/db/sync-change-log";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { buildUnitScopeCondition } from "../../lib/units";
import type { MemberData } from "../../middleware/permission";
import { attachReferenceStandardCertificateDocuments } from "./standard-documents";

/** The part of the request the desktop's scope is made of. */
export type SyncScope = Pick<
  MemberData,
  "organizationId" | "selectedUnitScope" | "activeUnitId" | "accessibleUnitIds"
>;

export type SyncEntityRow = {
  id: number;
  /** What goes on the wire; carries `deletedAt` for a soft-deleted row. */
  payload: Record<string, unknown>;
  /** The row is soft-deleted: the desktop is told to delete it. */
  deleted: boolean;
  /** When the row last changed (`updatedAt` / `publishedAt`), for the event id; null when it has neither. */
  changedAt: Date | null;
};

export type SyncEntitySource = {
  readonly entityType: SyncChangeEntityType;
  /**
   * The rows of `ids` the desktop may see right now (its laboratory, its unit scope,
   * published where that applies), live or soft-deleted. A missing id is a row that was
   * deleted or moved out of scope: the caller tombstones it.
   */
  byIds(
    o: OrgDb,
    scope: SyncScope,
    ids: readonly number[],
  ): Promise<SyncEntityRow[]>;
  /** Bootstrap: the live rows with `id > afterId`, ascending, at most `limit`. */
  page(
    o: OrgDb,
    scope: SyncScope,
    afterId: number,
    limit: number,
  ): Promise<SyncEntityRow[]>;
};

type UnitColumn = AnyColumn<{ data: number }>;

type SourceDefinition = {
  entityType: SyncChangeEntityType;
  table: PgTable;
  fields: SelectedFields;
  id: AnyColumn<{ data: number }>;
  /** The unit the row belongs to; null for an entity that is not unit-scoped. */
  unit: UnitColumn | null;
  /** Soft delete column, when the table has one. */
  deletedAt: AnyColumn | null;
  /** Rows the desktop sees at all (e.g. only PUBLISHED methods). */
  visible?: SQL | undefined;
  /** Rows the bootstrap hands out, on top of `visible`: the live ones. */
  live?: SQL | undefined;
  /** Post-processing of a page or lookup (the standards' certificate documents). */
  enrich?: (
    o: OrgDb,
    rows: Array<Record<string, unknown>>,
  ) => Promise<Array<Record<string, unknown>>>;
};

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function rowOf(
  definition: SourceDefinition,
  row: Record<string, unknown>,
): SyncEntityRow | null {
  const id = row.id;
  if (typeof id !== "number") return null;
  const deleted =
    definition.deletedAt !== null &&
    row.deletedAt !== null &&
    row.deletedAt !== undefined;
  return {
    id,
    payload: row,
    deleted,
    changedAt: toDate(row.updatedAt ?? row.publishedAt),
  };
}

function define(definition: SourceDefinition): SyncEntitySource {
  const unitCondition = (scope: SyncScope) =>
    definition.unit
      ? buildUnitScopeCondition(definition.unit, scope)
      : undefined;

  async function read(o: OrgDb, where: SQL | undefined, limit?: number) {
    const ordered = o
      .select(definition.fields)
      .from(definition.table)
      .where(where)
      .orderBy(asc(definition.id));
    const rows =
      limit === undefined ? await ordered : await ordered.limit(limit);
    const enriched = definition.enrich
      ? await definition.enrich(o, rows)
      : rows;
    return enriched.flatMap((row) => rowOf(definition, row) ?? []);
  }

  return {
    entityType: definition.entityType,
    async byIds(o, scope, ids) {
      if (ids.length === 0) return [];
      return read(
        o,
        and(
          inArray(definition.id, [...ids]),
          unitCondition(scope),
          definition.visible,
        ),
      );
    },
    async page(o, scope, afterId, limit) {
      return read(
        o,
        and(
          gt(definition.id, afterId),
          unitCondition(scope),
          definition.visible,
          definition.live,
        ),
        limit,
      );
    },
  };
}

const assetTypeSource = define({
  entityType: "asset_type",
  table: assetType,
  fields: getTableColumns(assetType),
  id: assetType.id,
  unit: null,
  deletedAt: null,
});

const customerSource = define({
  entityType: "customer",
  table: customer,
  fields: {
    id: customer.id,
    name: customer.name,
    taxId: customer.taxId,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    compliance: customer.compliance,
    updatedAt: customer.updatedAt,
  },
  id: customer.id,
  unit: null,
  deletedAt: null,
});

const assetSource = define({
  entityType: "asset",
  table: asset,
  fields: {
    id: asset.id,
    organizationId: asset.labOrganizationId,
    unitId: asset.unitId,
    customerId: asset.customerId,
    assetTypeId: asset.assetTypeId,
    name: asset.name,
    serialNumber: asset.serialNumber,
    tag: asset.tag,
    manufacturer: asset.manufacturer,
    model: asset.model,
    baseMeasurementUnit: asset.baseMeasurementUnit,
    specifications: asset.specifications,
    lastCalibrationDate: asset.lastCalibrationDate,
    nextCalibrationDate: asset.nextCalibrationDate,
    comments: asset.comments,
    metrologyRegime: asset.metrologyRegime,
    regulatedInterval: asset.regulatedInterval,
    nextLegalVerificationDate: asset.nextLegalVerificationDate,
    installedAt: asset.installedAt,
    status: asset.status,
    updatedAt: asset.updatedAt,
    deletedAt: asset.deletedAt,
  },
  id: asset.id,
  unit: asset.unitId,
  deletedAt: asset.deletedAt,
  live: isNull(asset.deletedAt),
});

const serviceSource = define({
  entityType: "service",
  table: service,
  fields: {
    id: service.id,
    organizationId: service.organizationId,
    unitId: service.unitId,
    assetTypeId: service.assetTypeId,
    methodId: service.methodId,
    name: service.name,
    description: service.description,
    isActive: service.isActive,
    updatedAt: service.updatedAt,
  },
  id: service.id,
  unit: service.unitId,
  deletedAt: null,
  live: eq(service.isActive, true),
});

const referenceStandardSource = define({
  entityType: "reference_standard",
  table: referenceStandard,
  fields: {
    id: referenceStandard.id,
    organizationId: referenceStandard.organizationId,
    unitId: referenceStandard.unitId,
    name: referenceStandard.name,
    kind: referenceStandard.kind,
    type: referenceStandard.type,
    serialNumber: referenceStandard.serialNumber,
    manufacturer: referenceStandard.manufacturer,
    model: referenceStandard.model,
    certificateNumber: referenceStandard.certificateNumber,
    calibratedBy: referenceStandard.calibratedBy,
    calibrationDate: referenceStandard.calibrationDate,
    nextCalibrationDate: referenceStandard.nextCalibrationDate,
    referenceValue: referenceStandard.referenceValue,
    uncertainty: referenceStandard.uncertainty,
    uncertaintyUnit: referenceStandard.uncertaintyUnit,
    coverageFactor: referenceStandard.coverageFactor,
    distribution: referenceStandard.distribution,
    drift: referenceStandard.drift,
    certifiedValues: referenceStandard.certifiedValues,
    metrologyData: referenceStandard.metrologyData,
    status: referenceStandard.status,
    createdAt: referenceStandard.createdAt,
    updatedAt: referenceStandard.updatedAt,
    deletedAt: referenceStandard.deletedAt,
  },
  id: referenceStandard.id,
  unit: referenceStandard.unitId,
  deletedAt: referenceStandard.deletedAt,
  live: isNull(referenceStandard.deletedAt),
  enrich: (o, rows) => attachReferenceStandardCertificateDocuments(o, rows),
});

const environmentalLimitSource = define({
  entityType: "environmental_limit",
  table: environmentalLimits,
  fields: getTableColumns(environmentalLimits),
  id: environmentalLimits.id,
  unit: environmentalLimits.unitId,
  deletedAt: null,
});

const calibrationJobSource = define({
  entityType: "calibration_job",
  table: calibrationJob,
  fields: {
    id: calibrationJob.id,
    jobId: calibrationJob.jobId,
    organizationId: calibrationJob.organizationId,
    unitId: calibrationJob.unitId,
    customerId: calibrationJob.customerId,
    assetId: calibrationJob.assetId,
    serviceId: calibrationJob.serviceId,
    technicianId: calibrationJob.technicianId,
    methodSnapshot: calibrationJob.methodSnapshot,
    assetSnapshot: calibrationJob.assetSnapshot,
    standardsSnapshot: calibrationJob.standardsSnapshot,
    environmentalSnapshot: calibrationJob.environmentalSnapshot,
    calibrationLocationSnapshot: calibrationJob.calibrationLocationSnapshot,
    calibrationPhaseSnapshot: calibrationJob.calibrationPhaseSnapshot,
    data: calibrationJob.data,
    results: calibrationJob.results,
    scopeComplianceStatus: calibrationJob.scopeComplianceStatus,
    scopeComplianceFindings: calibrationJob.scopeComplianceFindings,
    scopeOverrideJustification: calibrationJob.scopeOverrideJustification,
    methodDeviations: calibrationJob.methodDeviations,
    status: calibrationJob.status,
    dueDate: calibrationJob.dueDate,
    createdAt: calibrationJob.createdAt,
    updatedAt: calibrationJob.updatedAt,
  },
  id: calibrationJob.id,
  unit: calibrationJob.unitId,
  deletedAt: null,
});

const serviceOrderSource = define({
  entityType: "service_order",
  table: serviceOrder,
  fields: {
    id: serviceOrder.id,
    publicId: serviceOrder.publicId,
    organizationId: serviceOrder.organizationId,
    unitId: serviceOrder.unitId,
    serviceOrderNumber: serviceOrder.serviceOrderNumber,
    customerId: serviceOrder.customerId,
    assetId: serviceOrder.assetId,
    clientContactId: serviceOrder.clientContactId,
    clientContactSnapshot: serviceOrder.clientContactSnapshot,
    intakeType: serviceOrder.intakeType,
    sourceServiceOrderId: serviceOrder.sourceServiceOrderId,
    status: serviceOrder.status,
    priority: serviceOrder.priority,
    responsibleTechnicianId: serviceOrder.responsibleTechnicianId,
    claimedDefect: serviceOrder.claimedDefect,
    intakeCondition: serviceOrder.intakeCondition,
    accessories: serviceOrder.accessories,
    removedSealingMarkNumber: serviceOrder.removedSealingMarkNumber,
    affixedSealingMarkNumber: serviceOrder.affixedSealingMarkNumber,
    inmetroRepairMarkNumber: serviceOrder.inmetroRepairMarkNumber,
    invoiceRemittanceNumber: serviceOrder.invoiceRemittanceNumber,
    invoiceRemittanceKey: serviceOrder.invoiceRemittanceKey,
    invoiceRemittanceIssuedAt: serviceOrder.invoiceRemittanceIssuedAt,
    carrierName: serviceOrder.carrierName,
    carrierDocument: serviceOrder.carrierDocument,
    thirdPartyName: serviceOrder.thirdPartyName,
    thirdPartyDocument: serviceOrder.thirdPartyDocument,
    thirdPartyPhone: serviceOrder.thirdPartyPhone,
    deliveryMethod: serviceOrder.deliveryMethod,
    internalNotes: serviceOrder.internalNotes,
    clientVisibleNotes: serviceOrder.clientVisibleNotes,
    evaluationFeeCents: serviceOrder.evaluationFeeCents,
    warrantyUntil: serviceOrder.warrantyUntil,
    warrantyTerms: serviceOrder.warrantyTerms,
    openedAt: serviceOrder.openedAt,
    updatedAt: serviceOrder.updatedAt,
  },
  id: serviceOrder.id,
  unit: serviceOrder.unitId,
  deletedAt: null,
});

const publishedMethodSource = define({
  entityType: "published_method",
  table: calibrationMethod,
  fields: {
    id: calibrationMethod.id,
    organizationId: calibrationMethod.organizationId,
    assetTypeId: calibrationMethod.assetTypeId,
    name: calibrationMethod.name,
    version: calibrationMethod.version,
    dataFields: calibrationMethod.dataFields,
    variableBindings: calibrationMethod.variableBindings,
    formulas: calibrationMethod.formulas,
    measurementModels: calibrationMethod.measurementModels,
    validations: calibrationMethod.validations,
    uncertaintyParams: calibrationMethod.uncertaintyParams,
    certificateContent: calibrationMethod.certificateContent,
    accreditedScope: calibrationMethod.accreditedScope,
    methodFingerprint: calibrationMethod.methodFingerprint,
    methodEngine: calibrationMethod.methodEngine,
    compiledMethod: calibrationMethod.compiledMethod,
    publicationEvidence: calibrationMethod.publicationEvidence,
    publishedAt: calibrationMethod.publishedAt,
  },
  id: calibrationMethod.id,
  unit: null,
  deletedAt: null,
  visible: eq(calibrationMethod.status, "PUBLISHED"),
});

const massCompositionProfileSource = define({
  entityType: "mass_composition_profile",
  table: massCompositionProfile,
  fields: {
    id: massCompositionProfile.id,
    profileKey: massCompositionProfile.profileKey,
    profileClass: massCompositionProfile.profileClass,
    nominal: massCompositionProfile.nominal,
    nominalG: massCompositionProfile.nominalG,
    value: massCompositionProfile.value,
    uncertainty: massCompositionProfile.uncertainty,
    unit: massCompositionProfile.unit,
    maxError: massCompositionProfile.maxError,
    drift: massCompositionProfile.drift,
    buoyancy: massCompositionProfile.buoyancy,
    coverageFactor: massCompositionProfile.coverageFactor,
    quantityAvailable: massCompositionProfile.quantityAvailable,
  },
  id: massCompositionProfile.id,
  unit: null,
  deletedAt: null,
  // Only the active, non-deleted profiles are mirrored: anything else is a tombstone.
  visible: and(
    eq(massCompositionProfile.status, "ACTIVE"),
    isNull(massCompositionProfile.deletedAt),
  ),
});

/** In the order the bootstrap walks them and the desktop applies them. */
export const SYNC_ENTITY_SOURCES = [
  assetTypeSource,
  customerSource,
  assetSource,
  serviceSource,
  referenceStandardSource,
  environmentalLimitSource,
  calibrationJobSource,
  serviceOrderSource,
  publishedMethodSource,
  massCompositionProfileSource,
] as const satisfies readonly SyncEntitySource[];

const SOURCE_BY_TYPE = new Map<SyncChangeEntityType, SyncEntitySource>(
  SYNC_ENTITY_SOURCES.map((source) => [source.entityType, source]),
);

export function syncEntitySource(
  entityType: SyncChangeEntityType,
): SyncEntitySource {
  const source = SOURCE_BY_TYPE.get(entityType);
  if (!source) throw new Error(`no sync source for ${entityType}`);
  return source;
}

/**
 * A short fingerprint of what a sync scope covers (roadmap 2 E2): the
 * organization, the unit selection and the units it may reach. It rides on the
 * pull cursor, so a cursor handed out under another scope (a unit gained or
 * lost, another active unit) is refused and the desktop bootstraps again
 * instead of never receiving the rows it newly may see.
 */
export function syncScopeFingerprint(scope: SyncScope): string {
  const units = [...scope.accessibleUnitIds].sort((a, b) => a - b).join(",");
  const text = [
    scope.organizationId,
    scope.selectedUnitScope,
    scope.selectedUnitScope === "unit" ? String(scope.activeUnitId ?? "") : "",
    units,
  ].join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
