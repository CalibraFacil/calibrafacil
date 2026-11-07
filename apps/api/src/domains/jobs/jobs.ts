import type { db } from "@calibra-facil/db";
import { appendJobEvent } from "@calibra-facil/db/job-events";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationMethod,
  customer,
  member,
  memberUnitAssignment,
  personnelCompetence,
  service,
  serviceOrder,
  type AssetSnapshot,
  type MethodInputField,
  type MethodSnapshot,
} from "@calibra-facil/db/schema";
import { normalizeMethodValidationsInput } from "@calibra-facil/schemas";
import { requireTargetOf } from "@calibra-facil/schemas/job-transitions";
import { addLabBusinessDays } from "@calibra-facil/shared";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { ensureJobCommercialSnapshot } from "../../lib/finance";
import { generateCertificateIdentity } from "./certificates/certificate-numbering";
import { invalid, notFound } from "../../lib/domain-errors";
import { toRecord } from "@calibra-facil/shared/record";

type JobDbExecutor = Pick<
  typeof db,
  "execute" | "select" | "insert" | "update"
>;

type CreateCalibrationJobParams = {
  organizationId: string;
  unitId: number;
  createdBy: string;
  assetId: number;
  serviceId: number;
  technicianId?: string | null;
  dueDate?: string | Date | null;
  ipAddress?: string | null;
  sourceRequestId?: number;
  sourceRequestItemId?: number;
  // DOM-02 (#655): the repair service order this calibration is being opened
  // from (flagged calibrationRequiredAfterRepair). Persisted as the back-link on
  // the job. Re-validated to be in the caller's organization before persisting;
  // a cross-tenant id is dropped to null rather than linked.
  sourceServiceOrderId?: number | null;
  executor: JobDbExecutor;
  // On-site (calibração in loco): pre-freeze the calibration location to the
  // customer's site so the technician doesn't re-enter it during execution.
  onsiteLocation?: { addressText: string; notes?: string | null } | null;
  // The scheduled on-site visit this job belongs to, when converted from an
  // on-site request.
  visitId?: number | null;
};

export const jobCreationClientErrors = new Set([
  "Ativo nao encontrado",
  "Ativo foi removido",
  "Ativo nao pertence a esta unidade",
  "Servico nao encontrado",
  "Servico nao pertence a esta unidade",
  "Servico esta inativo",
  "Servico nao possui metodo vinculado",
  "Metodo do servico nao encontrado",
  "Metodo do servico nao esta publicado. Publique o metodo antes de criar jobs.",
  "Método publicado sem artefato compilado consistente não pode gerar job regulado.",
  "Tipo do ativo nao e compativel com o servico selecionado",
  "Tecnico nao encontrado ou sem permissao",
  "Técnico não possui competência ativa para este tipo de instrumento",
  "Cliente suspenso. Reative a qualificação antes de criar novas ordens de serviço.",
  "Ativo nao possui especificacao obrigatoria para este metodo",
]);

function hasSpecificationValue(
  specifications: Record<string, unknown> | null | undefined,
  key: string | undefined,
) {
  if (!specifications || !key) {
    return false;
  }

  const value = specifications[key];
  return value !== null && value !== undefined && value !== "";
}

function validateRequiredAssetSpecs(
  dataFields: MethodInputField[] | null | undefined,
  specifications: Record<string, unknown> | null | undefined,
) {
  const missing = (dataFields ?? []).filter(
    (field) =>
      field.source === "asset_spec" &&
      field.required &&
      !hasSpecificationValue(specifications, field.assetSpecKey),
  );

  if (missing.length > 0) {
    throw invalid(
      "asset_specification_missing",
      "Ativo nao possui especificacao obrigatoria para este metodo",
    );
  }
}

function validatePublishedMethodCompiledArtifact(methodData: {
  compiledMethod: unknown;
  methodFingerprint: string | null;
  methodEngine: unknown;
  publicationEvidence: unknown;
}) {
  const compiledMethod =
    methodData.compiledMethod &&
    typeof methodData.compiledMethod === "object" &&
    !Array.isArray(methodData.compiledMethod)
      ? toRecord(methodData.compiledMethod)
      : null;
  const methodEngine =
    methodData.methodEngine &&
    typeof methodData.methodEngine === "object" &&
    !Array.isArray(methodData.methodEngine)
      ? toRecord(methodData.methodEngine)
      : null;
  const compiledEngine =
    compiledMethod?.engine &&
    typeof compiledMethod.engine === "object" &&
    !Array.isArray(compiledMethod.engine)
      ? toRecord(compiledMethod.engine)
      : null;

  if (
    !compiledMethod ||
    !methodData.methodFingerprint ||
    !methodEngine ||
    !compiledEngine ||
    !methodData.publicationEvidence ||
    compiledMethod.methodFingerprint !== methodData.methodFingerprint ||
    typeof compiledMethod.normalizedMethodJson !== "string" ||
    typeof methodEngine.version !== "string" ||
    typeof methodEngine.optionsFingerprint !== "string" ||
    compiledEngine.version !== methodEngine.version ||
    compiledEngine.optionsFingerprint !== methodEngine.optionsFingerprint
  ) {
    throw invalid(
      "invalid_request",
      "Método publicado sem artefato compilado consistente não pode gerar job regulado.",
    );
  }
}

/**
 * Creates the calibration job on `params.executor`, the raw transaction of the
 * caller's `withOrg` (`ctx.tx`): the advisory lock and the certificate
 * numbering run raw SQL the org-bound handle cannot express.
 */
export async function createCalibrationJob(params: CreateCalibrationJobParams) {
  const { executor } = params;
  const [assetData] = await executor
    .select({
      id: asset.id,
      unitId: asset.unitId,
      customerId: asset.customerId,
      assetTypeId: asset.assetTypeId,
      name: asset.name,
      tag: asset.tag,
      serialNumber: asset.serialNumber,
      manufacturer: asset.manufacturer,
      model: asset.model,
      baseMeasurementUnit: asset.baseMeasurementUnit,
      specifications: asset.specifications,
      assetTypeName: assetType.name,
      assetTypeSlug: assetType.slug,
      deletedAt: asset.deletedAt,
      labOrganizationId: customer.labOrganizationId,
      customerCompliance: customer.compliance,
    })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
    .where(
      and(
        eq(asset.id, params.assetId),
        eq(customer.labOrganizationId, params.organizationId),
      ),
    )
    .limit(1);

  if (!assetData) {
    throw notFound("asset_not_found", "Ativo nao encontrado");
  }

  if (assetData.deletedAt) {
    throw invalid("invalid_request", "Ativo foi removido");
  }

  // Another tenant's asset answers exactly like a missing one: the sequential
  // asset id must not be an existence oracle across organizations.
  if (assetData.labOrganizationId !== params.organizationId) {
    throw notFound("asset_not_found", "Ativo nao encontrado");
  }

  if (assetData.unitId !== params.unitId) {
    throw invalid("unit_asset_mismatch", "Ativo nao pertence a esta unidade");
  }

  const customerCompliance = toRecord(assetData.customerCompliance);

  if (customerCompliance.qualificationStatus === "suspended") {
    throw invalid(
      "invalid_request",
      "Cliente suspenso. Reative a qualificação antes de criar novas ordens de serviço.",
    );
  }

  const [serviceData] = await executor
    .select()
    .from(service)
    .where(
      and(
        eq(service.id, params.serviceId),
        eq(service.organizationId, params.organizationId),
      ),
    )
    .limit(1);

  if (!serviceData) {
    throw notFound("service_not_found", "Servico nao encontrado");
  }

  if (serviceData.unitId !== params.unitId) {
    throw invalid("invalid_request", "Servico nao pertence a esta unidade");
  }

  if (!serviceData.isActive) {
    throw invalid("invalid_request", "Servico esta inativo");
  }

  if (!serviceData.methodId) {
    throw invalid("invalid_request", "Servico nao possui metodo vinculado");
  }

  const [methodData] = await executor
    .select()
    .from(calibrationMethod)
    .where(
      and(
        eq(calibrationMethod.id, serviceData.methodId),
        eq(calibrationMethod.organizationId, serviceData.organizationId),
      ),
    )
    .limit(1);

  if (!methodData) {
    throw invalid("invalid_request", "Metodo do servico nao encontrado");
  }

  if (methodData.status !== "PUBLISHED") {
    throw invalid(
      "invalid_request",
      "Metodo do servico nao esta publicado. Publique o metodo antes de criar jobs.",
    );
  }
  validatePublishedMethodCompiledArtifact(methodData);

  if (
    serviceData.assetTypeId &&
    serviceData.assetTypeId !== assetData.assetTypeId
  ) {
    throw invalid(
      "invalid_request",
      "Tipo do ativo nao e compativel com o servico selecionado",
    );
  }

  if (params.technicianId) {
    const [techMember] = await executor
      .select()
      .from(member)
      .where(
        and(
          eq(member.userId, params.technicianId),
          eq(member.organizationId, params.organizationId),
        ),
      )
      .limit(1);

    if (!techMember) {
      throw invalid(
        "technician_not_found",
        "Tecnico nao encontrado ou sem permissao",
      );
    }

    if (!["admin", "owner"].includes(techMember.role)) {
      const [techAssignment] = await executor
        .select({ id: memberUnitAssignment.id })
        .from(memberUnitAssignment)
        .where(
          and(
            eq(memberUnitAssignment.memberId, techMember.id),
            eq(memberUnitAssignment.organizationId, params.organizationId),
            eq(memberUnitAssignment.unitId, params.unitId),
            inArray(memberUnitAssignment.role, ["technician", "unit_admin"]),
          ),
        )
        .limit(1);

      if (!techAssignment) {
        throw invalid(
          "technician_not_found",
          "Tecnico nao encontrado ou sem permissao",
        );
      }
    }

    const [competenceCount] = await executor
      .select({ total: count() })
      .from(personnelCompetence)
      .where(
        and(
          eq(personnelCompetence.organizationId, params.organizationId),
          isNull(personnelCompetence.deletedAt),
        ),
      );

    if ((competenceCount?.total ?? 0) > 0 && assetData.assetTypeId) {
      const [activeCompetence] = await executor
        .select({
          id: personnelCompetence.id,
          expiresAt: personnelCompetence.expiresAt,
        })
        .from(personnelCompetence)
        .where(
          and(
            eq(personnelCompetence.userId, params.technicianId),
            eq(personnelCompetence.organizationId, params.organizationId),
            eq(personnelCompetence.assetTypeId, assetData.assetTypeId),
            eq(personnelCompetence.status, "ACTIVE"),
            isNull(personnelCompetence.deletedAt),
          ),
        )
        .limit(1);

      if (!activeCompetence?.id) {
        throw invalid(
          "technician_competence_missing",
          "Técnico não possui competência ativa para este tipo de instrumento",
        );
      }

      if (
        activeCompetence.expiresAt &&
        activeCompetence.expiresAt < new Date()
      ) {
        throw invalid(
          "technician_competence_missing",
          "Técnico não possui competência ativa para este tipo de instrumento",
        );
      }
    }
  }

  const certificateIdentity = await generateCertificateIdentity(
    {
      organizationId: params.organizationId,
      generatedAt: new Date(),
      performedBy: params.createdBy,
    },
    executor,
  );
  const jobId = certificateIdentity.certificateNumber;

  const methodSnapshot: MethodSnapshot = {
    methodId: methodData.id,
    methodName: methodData.name,
    methodVersion: methodData.version,
    compiledMethod: methodData.compiledMethod ?? null,
    methodFingerprint: methodData.methodFingerprint ?? null,
    engineVersion:
      methodData.methodEngine &&
      typeof methodData.methodEngine === "object" &&
      "version" in methodData.methodEngine &&
      typeof methodData.methodEngine.version === "string"
        ? methodData.methodEngine.version
        : null,
    engineOptionsFingerprint:
      methodData.methodEngine &&
      typeof methodData.methodEngine === "object" &&
      "optionsFingerprint" in methodData.methodEngine &&
      typeof methodData.methodEngine.optionsFingerprint === "string"
        ? methodData.methodEngine.optionsFingerprint
        : null,
    normalizedMethodJson:
      methodData.compiledMethod &&
      typeof methodData.compiledMethod === "object" &&
      "normalizedMethodJson" in methodData.compiledMethod &&
      typeof methodData.compiledMethod.normalizedMethodJson === "string"
        ? methodData.compiledMethod.normalizedMethodJson
        : null,
    publicationEvidence: methodData.publicationEvidence ?? null,
    dataFields: methodData.dataFields,
    variableBindings: methodData.variableBindings ?? [],
    formulas: methodData.formulas,
    measurementModels: methodData.measurementModels ?? [],
    validations: normalizeMethodValidationsInput(methodData.validations),
    uncertaintyParams: methodData.uncertaintyParams,
    certificateContent: methodData.certificateContent ?? null,
    accreditedScope: methodData.accreditedScope ?? false,
  };

  validateRequiredAssetSpecs(
    methodSnapshot.dataFields,
    assetData.specifications,
  );

  const assetSnapshot: AssetSnapshot = {
    assetId: assetData.id,
    assetTypeId: assetData.assetTypeId,
    assetTypeName: assetData.assetTypeName,
    assetTypeSlug: assetData.assetTypeSlug,
    baseMeasurementUnit: assetData.baseMeasurementUnit,
    name: assetData.name,
    tag: assetData.tag,
    serialNumber: assetData.serialNumber,
    manufacturer: assetData.manufacturer,
    model: assetData.model,
    specifications: assetData.specifications,
    capturedAt: new Date().toISOString(),
  };

  let dueDate: Date | null = null;
  if (params.dueDate) {
    dueDate =
      params.dueDate instanceof Date
        ? params.dueDate
        : new Date(params.dueDate);
  } else if (serviceData.tat !== null && serviceData.tat !== undefined) {
    dueDate = addLabBusinessDays(new Date(), serviceData.tat);
  }

  // DOM-02: record the source repair OS, but only if it belongs to the caller's
  // organization. A cross-tenant id is silently dropped to null so the link can
  // never point across the tenant boundary.
  let sourceServiceOrderId: number | null = null;
  if (params.sourceServiceOrderId) {
    const [sourceOrder] = await executor
      .select({ id: serviceOrder.id })
      .from(serviceOrder)
      .where(
        and(
          eq(serviceOrder.id, params.sourceServiceOrderId),
          eq(serviceOrder.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    sourceServiceOrderId = sourceOrder?.id ?? null;
  }

  const [newJob] = await executor
    .insert(calibrationJob)
    .values({
      jobId,
      certificateName: certificateIdentity.certificateName,
      certificateNumberingSnapshot: certificateIdentity.snapshot,
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: assetData.customerId,
      assetId: params.assetId,
      serviceId: params.serviceId,
      technicianId: params.technicianId || null,
      methodSnapshot,
      assetSnapshot,
      status: requireTargetOf(null, "create"),
      dueDate,
      visitId: params.visitId ?? null,
      sourceServiceOrderId,
      calibrationLocationSnapshot: params.onsiteLocation
        ? {
            type: "customer_site",
            addressText: params.onsiteLocation.addressText,
            notes: params.onsiteLocation.notes ?? null,
            recordedAt: new Date().toISOString(),
            recordedBy: params.createdBy,
          }
        : null,
      createdBy: params.createdBy,
    })
    .returning();

  if (!newJob) {
    throw new Error("Falha ao criar job");
  }

  await ensureJobCommercialSnapshot(
    {
      actorUserId: params.createdBy,
      jobId: newJob.id,
      organizationId: params.organizationId,
      customerId: assetData.customerId,
      unitId: params.unitId,
      serviceId: params.serviceId,
    },
    executor,
  );

  await appendJobEvent(executor, {
    action: "create",
    organizationId: params.organizationId,
    jobId: newJob.id,
    actor: { kind: "user", userId: params.createdBy },
    ipAddress: params.ipAddress ?? null,
    changes: {
      initial: {
        assetId: params.assetId,
        serviceId: params.serviceId,
        technicianId: params.technicianId,
        dueDate: dueDate?.toISOString(),
        methodSnapshot: {
          methodId: methodSnapshot.methodId,
          methodName: methodSnapshot.methodName,
          methodVersion: methodSnapshot.methodVersion,
        },
        sourceRequestId: params.sourceRequestId,
        sourceRequestItemId: params.sourceRequestItemId,
        sourceServiceOrderId,
      },
    },
  });

  return newJob;
}
