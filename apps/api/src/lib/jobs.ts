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
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";

type JobDbExecutor = Pick<typeof db, "execute" | "select" | "insert" | "update">;

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
  executor?: JobDbExecutor;
  notifyOnAssignment?: boolean;
};

async function persistCalibrationJob(
  params: CreateCalibrationJobParams,
  executor: JobDbExecutor,
) {
  const [assetData] = await executor
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

  if (!serviceData.isActive) {
    throw new Error("Servico esta inativo");
  }

  if (!serviceData.methodId) {
    throw new Error("Servico nao possui metodo vinculado");
  }

  const [methodData] = await executor
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
    const [techMember] = await executor
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

  const [newJob] = await executor
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
    : await db.transaction((tx) => getNextJobSequence(organizationId, year, tx));

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
