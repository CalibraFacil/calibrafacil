import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationMethod,
  customer,
  jobAuditLog,
  member,
  memberUnitAssignment,
  personnelCompetence,
  service,
  type CustomerCompliance,
  type AssetSnapshot,
  type MethodInputField,
  type MethodSnapshot,
} from "@calibra-facil/db/schema";
import { notifyJobAssigned } from "@calibra-facil/notifications";
import { and, count, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { ensureJobCommercialSnapshot } from "./finance";

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
  executor?: JobDbExecutor;
  notifyOnAssignment?: boolean;
};

export const jobCreationClientErrors = new Set([
  "Ativo nao encontrado",
  "Ativo foi removido",
  "Ativo nao pertence a esta organizacao",
  "Ativo nao pertence a esta unidade",
  "Servico nao encontrado",
  "Servico nao pertence a esta unidade",
  "Servico esta inativo",
  "Servico nao possui metodo vinculado",
  "Metodo do servico nao encontrado",
  "Metodo do servico nao esta publicado. Publique o metodo antes de criar jobs.",
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
    throw new Error(
      "Ativo nao possui especificacao obrigatoria para este metodo",
    );
  }
}

function addBusinessDays(startDate: Date, businessDays: number) {
  const dueDate = new Date(startDate);
  let remainingBusinessDays = businessDays;

  while (remainingBusinessDays > 0) {
    dueDate.setDate(dueDate.getDate() + 1);

    const dayOfWeek = dueDate.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      remainingBusinessDays -= 1;
    }
  }

  return dueDate;
}

async function persistCalibrationJob(
  params: CreateCalibrationJobParams,
  executor: JobDbExecutor,
) {
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
    .where(eq(asset.id, params.assetId))
    .limit(1);

  if (!assetData) {
    throw new Error("Ativo nao encontrado");
  }

  if (assetData.deletedAt) {
    throw new Error("Ativo foi removido");
  }

  if (assetData.labOrganizationId !== params.organizationId) {
    throw new Error("Ativo nao pertence a esta organizacao");
  }

  if (assetData.unitId !== params.unitId) {
    throw new Error("Ativo nao pertence a esta unidade");
  }

  const customerCompliance = assetData.customerCompliance as
    | CustomerCompliance
    | null
    | undefined;

  if (customerCompliance?.qualificationStatus === "suspended") {
    throw new Error(
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
    throw new Error("Servico nao encontrado");
  }

  if (serviceData.unitId !== params.unitId) {
    throw new Error("Servico nao pertence a esta unidade");
  }

  if (!serviceData.isActive) {
    throw new Error("Servico esta inativo");
  }

  if (!serviceData.methodId) {
    throw new Error("Servico nao possui metodo vinculado");
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
    throw new Error("Metodo do servico nao encontrado");
  }

  if (methodData.status !== "PUBLISHED") {
    throw new Error(
      "Metodo do servico nao esta publicado. Publique o metodo antes de criar jobs.",
    );
  }

  if (
    serviceData.assetTypeId &&
    serviceData.assetTypeId !== assetData.assetTypeId
  ) {
    throw new Error("Tipo do ativo nao e compativel com o servico selecionado");
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
      throw new Error("Tecnico nao encontrado ou sem permissao");
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
        throw new Error("Tecnico nao encontrado ou sem permissao");
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
        throw new Error(
          "Técnico não possui competência ativa para este tipo de instrumento",
        );
      }

      if (
        activeCompetence.expiresAt &&
        activeCompetence.expiresAt < new Date()
      ) {
        throw new Error(
          "Técnico não possui competência ativa para este tipo de instrumento",
        );
      }
    }
  }

  const year = new Date().getFullYear();
  const jobId = await generateJobId(params.organizationId, year, executor);

  const methodSnapshot: MethodSnapshot = {
    methodId: methodData.id,
    methodName: methodData.name,
    methodVersion: methodData.version,
    dataFields: methodData.dataFields,
    formulas: methodData.formulas,
    validations: methodData.validations,
    uncertaintyParams: methodData.uncertaintyParams,
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
    dueDate = addBusinessDays(new Date(), serviceData.tat);
  }

  const [newJob] = await executor
    .insert(calibrationJob)
    .values({
      jobId,
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: assetData.customerId,
      assetId: params.assetId,
      serviceId: params.serviceId,
      technicianId: params.technicianId || null,
      methodSnapshot,
      assetSnapshot,
      status: "DRAFT",
      dueDate,
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

  await executor.insert(jobAuditLog).values({
    jobId: newJob.id,
    action: "create",
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
      },
    },
    performedBy: params.createdBy,
    ipAddress: params.ipAddress ?? null,
  });

  return newJob;
}

async function getNextJobSequence(
  organizationId: string,
  year: number,
  executor: JobDbExecutor,
) {
  const prefix = `CAL-${year}-`;
  const sequenceSql = sql<number>`coalesce(cast(substring(${calibrationJob.jobId} from '[0-9]+$') as integer), 0)`;

  // Lock per organization/year so a brand-new year with no rows cannot race to 0001.
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${organizationId}), ${year})`,
  );

  const [result] = await executor
    .select({
      sequence: sequenceSql,
    })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.organizationId, organizationId),
        ilike(calibrationJob.jobId, `${prefix}%`),
      ),
    )
    .orderBy(desc(sequenceSql))
    .limit(1)
    .for("update");

  return (result?.sequence ?? 0) + 1;
}

/**
 * Generates a unique job ID for the organization.
 * Format: CAL-YYYY-XXXX (per organization per year)
 */
export async function generateJobId(
  organizationId: string,
  year: number,
  executor?: JobDbExecutor,
): Promise<string> {
  const prefix = `CAL-${year}-`;
  const sequence = executor
    ? await getNextJobSequence(organizationId, year, executor)
    : await db.transaction((tx) =>
        getNextJobSequence(organizationId, year, tx),
      );

  return `${prefix}${sequence.toString().padStart(4, "0")}`;
}

export async function createCalibrationJob(params: CreateCalibrationJobParams) {
  const newJob = params.executor
    ? await persistCalibrationJob(params, params.executor)
    : await db.transaction((tx) => persistCalibrationJob(params, tx));

  if (params.technicianId && params.notifyOnAssignment !== false) {
    try {
      await notifyJobAssigned(newJob.id, params.technicianId, params.createdBy);
    } catch (error) {
      console.error("[Jobs] Failed to send assignment notification:", error);
    }
  }

  return newJob;
}
