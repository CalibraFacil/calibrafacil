import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationMethod,
  customer,
  environmentalLimits,
  referenceStandard,
  service,
  serviceOrder,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { type MemberData } from "../../middleware/permission";
import { buildUnitScopeCondition } from "../../lib/units";
import { orgDb } from "../../lib/org-db";
import { attachReferenceStandardCertificateDocuments } from "./standard-documents";
import { toSyncTimestamp } from "./helpers";
import {
  afterSyncPullPosition,
  formatSyncPullPosition,
  planSyncPullPage,
  syncPullRank,
  syncPullTimestamp,
  type SyncPullEntityType,
  type SyncPullPosition,
  type SyncPullWindow,
} from "./pull-cursor";

/**
 * DEPRECATED (protocols 1 and 2): the `updatedAt` cursor pull. One transaction
 * that names the laboratory (row-level security); the reads share it as they
 * shared the pool before (READ COMMITTED, one statement each).
 */
export function loadCloudSyncEventsSince(
  memberData: MemberData,
  since: SyncPullPosition,
  limit: number,
) {
  return orgDb(memberData.organizationId).transaction((o) =>
    loadCloudSyncEventsSinceIn(o, memberData, since, limit),
  );
}

async function loadCloudSyncEventsSinceIn(
  o: OrgDb,
  memberData: MemberData,
  since: SyncPullPosition,
  limit: number,
) {
  const [
    changedAssetTypes,
    changedCustomers,
    changedAssets,
    changedServices,
    changedStandards,
    changedEnvironmentalLimits,
    changedJobs,
    changedServiceOrders,
    changedMethods,
  ] = await Promise.all([
    o
      .select()
      .from(assetType)
      .where(
        afterSyncPullPosition(
          "asset_type",
          { timestamp: assetType.updatedAt, id: assetType.id },
          since,
        ),
      )
      .orderBy(syncPullTimestamp(assetType.updatedAt), assetType.id)
      .limit(limit + 1),
    o
      .select({
        id: customer.id,
        name: customer.name,
        taxId: customer.taxId,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        compliance: customer.compliance,
        updatedAt: customer.updatedAt,
      })
      .from(customer)
      .where(
        and(
          eq(customer.labOrganizationId, memberData.organizationId),
          afterSyncPullPosition(
            "customer",
            { timestamp: customer.updatedAt, id: customer.id },
            since,
          ),
        ),
      )
      .orderBy(syncPullTimestamp(customer.updatedAt), customer.id)
      .limit(limit + 1),
    o
      .select({
        id: asset.id,
        organizationId: customer.labOrganizationId,
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
        // Track-1 dates + comments — same projection as the bootstrap select.
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
      })
      .from(asset)
      .innerJoin(customer, eq(asset.customerId, customer.id))
      .where(
        and(
          eq(customer.labOrganizationId, memberData.organizationId),
          buildUnitScopeCondition(asset.unitId, memberData),
          // Soft-deleted rows stay in the pull (as delete events): filtering
          // them out meant a cloud deletion never reached the desktop.
          afterSyncPullPosition(
            "asset",
            { timestamp: asset.updatedAt, id: asset.id },
            since,
          ),
        ),
      )
      .orderBy(syncPullTimestamp(asset.updatedAt), asset.id)
      .limit(limit + 1),
    o
      .select({
        id: service.id,
        organizationId: service.organizationId,
        unitId: service.unitId,
        assetTypeId: service.assetTypeId,
        methodId: service.methodId,
        name: service.name,
        description: service.description,
        isActive: service.isActive,
        updatedAt: service.updatedAt,
      })
      .from(service)
      .where(
        and(
          eq(service.organizationId, memberData.organizationId),
          buildUnitScopeCondition(service.unitId, memberData),
          afterSyncPullPosition(
            "service",
            { timestamp: service.updatedAt, id: service.id },
            since,
          ),
        ),
      )
      .orderBy(syncPullTimestamp(service.updatedAt), service.id)
      .limit(limit + 1),
    o
      .select({
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
      })
      .from(referenceStandard)
      .where(
        and(
          eq(referenceStandard.organizationId, memberData.organizationId),
          buildUnitScopeCondition(referenceStandard.unitId, memberData),
          afterSyncPullPosition(
            "reference_standard",
            {
              timestamp: referenceStandard.updatedAt,
              id: referenceStandard.id,
            },
            since,
          ),
        ),
      )
      .orderBy(
        syncPullTimestamp(referenceStandard.updatedAt),
        referenceStandard.id,
      )
      .limit(limit + 1),
    o
      .select()
      .from(environmentalLimits)
      .where(
        and(
          eq(environmentalLimits.organizationId, memberData.organizationId),
          buildUnitScopeCondition(environmentalLimits.unitId, memberData),
          afterSyncPullPosition(
            "environmental_limit",
            {
              timestamp: environmentalLimits.updatedAt,
              id: environmentalLimits.id,
            },
            since,
          ),
        ),
      )
      .orderBy(
        syncPullTimestamp(environmentalLimits.updatedAt),
        environmentalLimits.id,
      )
      .limit(limit + 1),
    o
      .select({
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
      })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.organizationId, memberData.organizationId),
          buildUnitScopeCondition(calibrationJob.unitId, memberData),
          afterSyncPullPosition(
            "calibration_job",
            { timestamp: calibrationJob.updatedAt, id: calibrationJob.id },
            since,
          ),
        ),
      )
      .orderBy(syncPullTimestamp(calibrationJob.updatedAt), calibrationJob.id)
      .limit(limit + 1),
    o
      .select({
        id: serviceOrder.id,
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
      })
      .from(serviceOrder)
      .where(
        and(
          eq(serviceOrder.organizationId, memberData.organizationId),
          buildUnitScopeCondition(serviceOrder.unitId, memberData),
          afterSyncPullPosition(
            "service_order",
            { timestamp: serviceOrder.updatedAt, id: serviceOrder.id },
            since,
          ),
        ),
      )
      .orderBy(syncPullTimestamp(serviceOrder.updatedAt), serviceOrder.id)
      .limit(limit + 1),
    o
      .select({
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
      })
      .from(calibrationMethod)
      .where(
        and(
          eq(calibrationMethod.organizationId, memberData.organizationId),
          eq(calibrationMethod.status, "PUBLISHED"),
          afterSyncPullPosition(
            "published_method",
            {
              timestamp: calibrationMethod.publishedAt,
              id: calibrationMethod.id,
            },
            since,
          ),
        ),
      )
      .orderBy(
        syncPullTimestamp(calibrationMethod.publishedAt),
        calibrationMethod.id,
      )
      .limit(limit + 1),
  ]);
  // Page planning (see modules/sync/pull-cursor.ts): when any table filled its
  // window the page is cut at the smallest boundary row so that no row older
  // than the cursor we hand out is left unsent.
  const windows = [
    pullWindow("asset_type", changedAssetTypes, "updatedAt"),
    pullWindow("customer", changedCustomers, "updatedAt"),
    pullWindow("asset", changedAssets, "updatedAt"),
    pullWindow("service", changedServices, "updatedAt"),
    pullWindow("reference_standard", changedStandards, "updatedAt"),
    pullWindow("environmental_limit", changedEnvironmentalLimits, "updatedAt"),
    pullWindow("calibration_job", changedJobs, "updatedAt"),
    pullWindow("service_order", changedServiceOrders, "updatedAt"),
    pullWindow("published_method", changedMethods, "publishedAt"),
  ];
  const plan = planSyncPullPage(windows, limit);
  const taken = <T>(entityType: SyncPullEntityType, rows: T[]) =>
    rows.slice(0, plan.take.get(entityType) ?? 0);

  const changedStandardsWithDocuments =
    await attachReferenceStandardCertificateDocuments(
      o,
      taken("reference_standard", changedStandards),
    );

  const events = [
    ...toCloudEvents(
      "asset_type",
      taken("asset_type", changedAssetTypes),
      "updatedAt",
    ),
    ...toCloudEvents(
      "customer",
      taken("customer", changedCustomers),
      "updatedAt",
    ),
    ...toCloudEvents("asset", taken("asset", changedAssets), "updatedAt"),
    ...toCloudEvents("service", taken("service", changedServices), "updatedAt"),
    ...toCloudEvents(
      "reference_standard",
      changedStandardsWithDocuments,
      "updatedAt",
    ),
    ...toCloudEvents(
      "environmental_limit",
      taken("environmental_limit", changedEnvironmentalLimits),
      "updatedAt",
    ),
    ...toCloudEvents(
      "calibration_job",
      taken("calibration_job", changedJobs),
      "updatedAt",
    ),
    ...toCloudEvents(
      "service_order",
      taken("service_order", changedServiceOrders),
      "updatedAt",
    ),
    ...toCloudEvents(
      "published_method",
      taken("published_method", changedMethods),
      "publishedAt",
    ),
  ].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      syncPullRank(left.entityType) - syncPullRank(right.entityType) ||
      Number(left.entityId) - Number(right.entityId),
  );

  return {
    events,
    // Where the next pull resumes. With no events (nothing past `since`) the
    // incoming position is kept as is.
    cursor: formatSyncPullPosition(plan.last ?? since),
    hasMore: plan.hasMore,
  };
}

function pullWindow(
  entityType: SyncPullEntityType,
  rows: Array<Record<string, unknown>>,
  timestampKey: string,
): SyncPullWindow {
  return {
    entityType,
    rows: rows.map((row) => ({
      timestampMs: Date.parse(toSyncTimestamp(row[timestampKey])),
      id: Number(row.id),
    })),
  };
}

function toCloudEvents(
  entityType:
    | "asset_type"
    | "customer"
    | "asset"
    | "service"
    | "published_method"
    | "reference_standard"
    | "environmental_limit"
    | "calibration_job"
    | "service_order",
  rows: Array<Record<string, unknown>>,
  timestampKey: string,
) {
  return rows.map((row) => {
    const occurredAt = toSyncTimestamp(row[timestampKey]);
    return {
      cloudEventId: `cloud:${entityType}:${String(row.id)}:${occurredAt}`,
      entityType,
      entityId:
        typeof row.id === "number" || typeof row.id === "string"
          ? row.id
          : String(row.id),
      // A soft-deleted row (assets, standards) travels as a delete so the
      // desktop can soft-delete its copy; its payload still carries deletedAt.
      operation: row.deletedAt ? ("delete" as const) : ("upsert" as const),
      occurredAt,
      payload: row,
    };
  });
}
