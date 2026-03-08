import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  calibrationMethod,
  customer,
  jobAuditLog,
  member,
  personnelCompetence,
  service,
  type MethodSnapshot,
} from "@calibra-facil/db/schema";
import { notifyJobAssigned } from "@calibra-facil/notifications";
import { and, count, desc, eq, ilike, inArray, isNull } from "drizzle-orm";

type CreateCalibrationJobParams = {
  organizationId: string;
  createdBy: string;
  assetId: number;
  serviceId: number;
  technicianId?: string | null;
  dueDate?: string | Date | null;
  ipAddress?: string | null;
  sourceRequestId?: number;
  sourceRequestItemId?: number;
};

/**
 * Generates a unique job ID for the organization.
 * Format: CAL-YYYY-XXXX (per organization per year)
 */
export async function generateJobId(
  organizationId: string,
  year: number,
): Promise<string> {
  const prefix = `CAL-${year}-`;

  const sequence = await db.transaction(async (tx) => {
    const [result] = await tx
      .select({ jobId: calibrationJob.jobId })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.organizationId, organizationId),
          ilike(calibrationJob.jobId, `${prefix}%`),
        ),
      )
      .orderBy(desc(calibrationJob.jobId))
      .limit(1)
      .for("update");

    if (!result?.jobId) return 1;
    const match = result.jobId.match(/(\d+)$/);
    return match?.[1] ? parseInt(match[1], 10) + 1 : 1;
  });

  return `${prefix}${sequence.toString().padStart(4, "0")}`;
}

export async function createCalibrationJob(params: CreateCalibrationJobParams) {
  const [assetData] = await db
    .select({
      id: asset.id,
      customerId: asset.customerId,
      assetTypeId: asset.assetTypeId,
      deletedAt: asset.deletedAt,
      labOrganizationId: customer.labOrganizationId,
    })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
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

  const [serviceData] = await db
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

  if (!serviceData.isActive) {
    throw new Error("Servico esta inativo");
  }

  if (!serviceData.methodId) {
    throw new Error("Servico nao possui metodo vinculado");
  }

  const [methodData] = await db
    .select()
    .from(calibrationMethod)
    .where(eq(calibrationMethod.id, serviceData.methodId))
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
    const [techMember] = await db
      .select()
      .from(member)
      .where(
        and(
          eq(member.userId, params.technicianId),
          eq(member.organizationId, params.organizationId),
          inArray(member.role, ["technician", "admin", "owner"]),
        ),
      )
      .limit(1);

    if (!techMember) {
      throw new Error("Tecnico nao encontrado ou sem permissao");
    }

    const [competenceCount] = await db
      .select({ total: count() })
      .from(personnelCompetence)
      .where(
        and(
          eq(personnelCompetence.organizationId, params.organizationId),
          isNull(personnelCompetence.deletedAt),
        ),
      );

    if ((competenceCount?.total ?? 0) > 0 && assetData.assetTypeId) {
      const [activeCompetence] = await db
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
  const jobId = await generateJobId(params.organizationId, year);

  const methodSnapshot: MethodSnapshot = {
    methodId: methodData.id,
    methodName: methodData.name,
    methodVersion: methodData.version,
    dataFields: methodData.dataFields,
    formulas: methodData.formulas,
    validations: methodData.validations,
    uncertaintyParams: methodData.uncertaintyParams,
  };

  let dueDate: Date | null = null;
  if (params.dueDate) {
    dueDate =
      params.dueDate instanceof Date
        ? params.dueDate
        : new Date(params.dueDate);
  } else if (serviceData.tat) {
    dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + serviceData.tat);
  }

  const [newJob] = await db
    .insert(calibrationJob)
    .values({
      jobId,
      organizationId: params.organizationId,
      customerId: assetData.customerId,
      assetId: params.assetId,
      serviceId: params.serviceId,
      technicianId: params.technicianId || null,
      methodSnapshot,
      status: "DRAFT",
      dueDate,
      createdBy: params.createdBy,
    })
    .returning();

  if (!newJob) {
    throw new Error("Falha ao criar job");
  }

  await db.insert(jobAuditLog).values({
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

  if (params.technicianId) {
    try {
      await notifyJobAssigned(newJob.id, params.technicianId, params.createdBy);
    } catch (error) {
      console.error("[Jobs] Failed to send assignment notification:", error);
    }
  }

  return newJob;
}
