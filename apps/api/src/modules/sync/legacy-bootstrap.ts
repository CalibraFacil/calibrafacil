import { syncBootstrapResponseSchema } from "@calibra-facil/contracts";
import type { OrgDb } from "@calibra-facil/db/for-org";
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
import { and, eq, isNull } from "drizzle-orm";
import { buildUnitScopeCondition } from "../../lib/units";
import { orgDb } from "../../lib/org-db";
import type { AuthVariables, MemberData } from "../../middleware/permission";
import { attachReferenceStandardCertificateDocuments } from "./standard-documents";

/**
 * The one unpaginated bootstrap response of sync protocols 1 and 2 (the paged
 * protocol 3 bootstrap lives in ./bootstrap-pages.ts). The route handler only
 * adds the `Deprecation` header; the queries live here, off the route, so the
 * organization scoping stays in modules/.
 */
export function buildLegacyBootstrapResponse(input: {
  user: AuthVariables["session"]["user"];
  member: MemberData;
}) {
  // One transaction that names the laboratory (row-level security).
  return orgDb(input.member.organizationId).transaction((o) =>
    buildLegacyBootstrapResponseIn(o, input),
  );
}

async function buildLegacyBootstrapResponseIn(
  o: OrgDb,
  {
    user,
    member: memberData,
  }: {
    user: AuthVariables["session"]["user"];
    member: MemberData;
  },
) {
  const [
    publishedMethods,
    assetTypes,
    customers,
    assets,
    services,
    standards,
    environmentalLimitRows,
    jobs,
    serviceOrders,
  ] = await Promise.all([
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
        ),
      ),
    o.select().from(assetType),
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
      .where(eq(customer.labOrganizationId, memberData.organizationId)),
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
        // Track-1 dates + comments: the local upsert maps them; omitting
        // them here both hid due dates from the desktop AND nulled the
        // local columns on every pull (the upsert writes absent as null).
        lastCalibrationDate: asset.lastCalibrationDate,
        nextCalibrationDate: asset.nextCalibrationDate,
        comments: asset.comments,
        metrologyRegime: asset.metrologyRegime,
        regulatedInterval: asset.regulatedInterval,
        nextLegalVerificationDate: asset.nextLegalVerificationDate,
        installedAt: asset.installedAt,
        status: asset.status,
        updatedAt: asset.updatedAt,
      })
      .from(asset)
      .innerJoin(customer, eq(asset.customerId, customer.id))
      .where(
        and(
          eq(customer.labOrganizationId, memberData.organizationId),
          buildUnitScopeCondition(asset.unitId, memberData),
          isNull(asset.deletedAt),
        ),
      ),
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
          eq(service.isActive, true),
        ),
      ),
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
      })
      .from(referenceStandard)
      .where(
        and(
          eq(referenceStandard.organizationId, memberData.organizationId),
          buildUnitScopeCondition(referenceStandard.unitId, memberData),
          isNull(referenceStandard.deletedAt),
        ),
      ),
    o
      .select()
      .from(environmentalLimits)
      .where(
        and(
          eq(environmentalLimits.organizationId, memberData.organizationId),
          buildUnitScopeCondition(environmentalLimits.unitId, memberData),
        ),
      ),
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
        // §7.8.2.1(n) — desktop renders certificates offline, so this has
        // to travel or an offline render omits recorded content.
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
        ),
      ),
    o
      .select({
        id: serviceOrder.id,
        // Mirrored into local-db so a synced OS keeps one URL across the
        // cloud and desktop runtimes.
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
      })
      .from(serviceOrder)
      .where(
        and(
          eq(serviceOrder.organizationId, memberData.organizationId),
          buildUnitScopeCondition(serviceOrder.unitId, memberData),
        ),
      ),
  ]);
  const standardsWithDocuments =
    await attachReferenceStandardCertificateDocuments(o, standards);

  const massCompositionProfileRows = await o
    .select({
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
    })
    .from(massCompositionProfile)
    .where(
      and(
        eq(massCompositionProfile.organizationId, memberData.organizationId),
        eq(massCompositionProfile.status, "ACTIVE"),
        isNull(massCompositionProfile.deletedAt),
      ),
    )
    .orderBy(
      massCompositionProfile.profileClass,
      massCompositionProfile.nominalG,
    );

  return syncBootstrapResponseSchema.parse({
    serverTime: new Date().toISOString(),
    user: {
      id: user.id,
      name: user.name ?? null,
      email: user.email ?? null,
    },
    organization: {
      id: memberData.organizationId,
      type: memberData.organizationType,
    },
    activeUnits: memberData.accessibleUnits.map((unit) => ({
      id: unit.id,
      name: unit.name,
      role: unit.role ?? null,
    })),
    permissions: {
      role: memberData.role,
      unitRole: memberData.unitRole,
      activeUnitId: memberData.activeUnitId,
      accessibleUnitIds: memberData.accessibleUnitIds,
      canAccessAllUnits: memberData.canAccessAllUnits,
    },
    featureFlags: {
      offlineApprovals: false,
      offlineCertificatePublication: false,
    },
    syncCursor: new Date().toISOString(),
    publishedMethods,
    assetTypes,
    customers,
    assets,
    services,
    standards: standardsWithDocuments,
    massCompositionProfiles: massCompositionProfileRows,
    environmentalLimits: environmentalLimitRows,
    jobs,
    serviceOrders,
  });
}
