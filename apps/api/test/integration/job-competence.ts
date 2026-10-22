import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  personnelCompetence,
  service,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";

/**
 * Make the job's service carry an instrument type and give `competentUserId`
 * an ACTIVE competence for it, so the organization "keeps competence records"
 * and the ISO/IEC 17025 §6.2.5 gate of assigning a technician is live: every
 * other technician is then refused. `seedJobForOrg` leaves the service
 * without an instrument type, which switches the gate off.
 */
export async function requireCompetenceForJob(params: {
  jobId: number;
  organizationId: string;
  competentUserId: string;
  createdBy: string;
}): Promise<void> {
  const [job] = await db
    .select({
      serviceId: calibrationJob.serviceId,
      assetId: calibrationJob.assetId,
    })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, params.jobId));
  if (!job) throw new Error(`requireCompetenceForJob: job ${params.jobId}`);

  const [row] = await db
    .select({ assetTypeId: asset.assetTypeId })
    .from(asset)
    .where(eq(asset.id, job.assetId));
  if (!row) throw new Error("requireCompetenceForJob: asset not found");

  await db
    .update(service)
    .set({ assetTypeId: row.assetTypeId })
    .where(eq(service.id, job.serviceId));
  await db.insert(personnelCompetence).values({
    organizationId: params.organizationId,
    userId: params.competentUserId,
    assetTypeId: row.assetTypeId,
    scopeDescription: "Competência de teste",
    status: "ACTIVE",
    requestedBy: params.createdBy,
    createdBy: params.createdBy,
  });
}
