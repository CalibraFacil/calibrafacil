// Recipes of the job lifecycle notifications and the signing-certificate-lapsed alert.
// One row per notification type: load the entity, resolve the recipients and
// yield what each one receives. `notify()` sends the yielded rows one by one.
import { user, calibrationJob } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { OPEN_JOB_STATUSES } from "@calibra-facil/schemas";
import { isOneOf } from "@calibra-facil/shared/status-vocabulary";
import { formatCalendarDate } from "@calibra-facil/shared/format";
import { inOrg, findJobLaboratory } from "../lab-scope";
import { getUserPreferences } from "../delivery";
import {
  getJobDetails,
  getUserName,
  getDaysRemaining,
  adminsAndOwners,
} from "./lookups";
import type { NotificationRecipes } from "./types";

export const jobRecipes = {
  /**
   * Notify admins/owners when a job is submitted for review
   */
  async *JOB_SUBMITTED_FOR_REVIEW({ jobId, submittedByUserId }) {
    const job = await getJobDetails(jobId);
    if (!job) return;

    const submitterName = await getUserName(submittedByUserId, "Um tecnico");

    const recipients = await adminsAndOwners(job.organizationId);

    for (const recipientId of recipients) {
      if (recipientId === submittedByUserId) continue;

      yield {
        recipientUserId: recipientId,
        organizationId: job.organizationId,
        type: "JOB_SUBMITTED_FOR_REVIEW",
        priority: "HIGH",
        title: "Calibração aguardando revisão",
        message: `${submitterName} submeteu a OS ${job.jobIdentifier} para revisão.`,
        relatedEntity: {
          entityType: "job",
          entityId: jobId,
          jobId: job.jobIdentifier,
        },
        actionUrl: `/dashboard/jobs/${jobId}`,
        emailContext: {
          type: "job",
          data: {
            jobId: job.jobIdentifier,
            jobInternalId: jobId,
            actorName: submitterName,
          },
        },
      };
    }
  },

  /**
   * Notify technician when their job is approved
   */
  async *JOB_APPROVED({ jobId, approvedByUserId }) {
    const job = await getJobDetails(jobId);
    if (!job) return;

    const approverName = await getUserName(approvedByUserId, "Um gestor");

    // Notify the technician (or job creator if no technician assigned)
    const recipientId = job.technicianId ?? job.createdBy;

    // Don't notify if the approver is the same as the recipient
    if (recipientId === approvedByUserId) return;

    yield {
      recipientUserId: recipientId,
      organizationId: job.organizationId,
      type: "JOB_APPROVED",
      priority: "HIGH",
      title: "Calibração aprovada",
      message: `${approverName} aprovou a OS ${job.jobIdentifier}. O certificado está sendo gerado.`,
      relatedEntity: {
        entityType: "job",
        entityId: jobId,
        jobId: job.jobIdentifier,
      },
      actionUrl: `/dashboard/jobs/${jobId}`,
      emailContext: {
        type: "job",
        data: {
          jobId: job.jobIdentifier,
          jobInternalId: jobId,
          actorName: approverName,
        },
      },
    };
  },

  /**
   * Notify technician when their job is rejected
   */
  async *JOB_REJECTED({ jobId, rejectedByUserId, reason }) {
    const job = await getJobDetails(jobId);
    if (!job) return;

    const rejectorName = await getUserName(rejectedByUserId, "Um gestor");

    // Notify the technician (or job creator if no technician assigned)
    const recipientId = job.technicianId ?? job.createdBy;

    // Don't notify if the rejector is the same as the recipient
    if (recipientId === rejectedByUserId) return;

    yield {
      recipientUserId: recipientId,
      organizationId: job.organizationId,
      type: "JOB_REJECTED",
      priority: "HIGH",
      title: "Calibração rejeitada",
      message: `${rejectorName} rejeitou a OS ${job.jobIdentifier}. Motivo: ${reason}`,
      relatedEntity: {
        entityType: "job",
        entityId: jobId,
        jobId: job.jobIdentifier,
      },
      actionUrl: `/dashboard/jobs/${jobId}`,
      emailContext: {
        type: "job",
        data: {
          jobId: job.jobIdentifier,
          jobInternalId: jobId,
          actorName: rejectorName,
          reason,
        },
      },
    };
  },

  /**
   * Notify technician when a job is assigned to them
   */
  async *JOB_ASSIGNED({ jobId, technicianId, assignedByUserId }) {
    const job = await getJobDetails(jobId);
    if (!job) return;

    // Check if this is a self-assignment
    const isSelfAssignment = technicianId === assignedByUserId;

    if (isSelfAssignment) {
      // Check user's preference for self-action notifications
      const { notifySelfActions } = await getUserPreferences(technicianId);
      if (!notifySelfActions) return;
    }

    const [assigner] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, assignedByUserId))
      .limit(1);

    const assignerName = isSelfAssignment
      ? "Você"
      : (assigner?.name ?? "Um gestor");

    yield {
      recipientUserId: technicianId,
      organizationId: job.organizationId,
      type: "JOB_ASSIGNED",
      priority: "MEDIUM",
      title: "Nova calibração atribuída",
      message: isSelfAssignment
        ? `Você atribuiu a OS ${job.jobIdentifier} para si mesmo.`
        : `${assignerName} atribuiu a OS ${job.jobIdentifier} para você.`,
      relatedEntity: {
        entityType: "job",
        entityId: jobId,
        jobId: job.jobIdentifier,
      },
      actionUrl: `/dashboard/jobs/${jobId}`,
      emailContext: {
        type: "job",
        data: {
          jobId: job.jobIdentifier,
          jobInternalId: jobId,
          actorName: assignerName,
        },
      },
    };
  },

  /**
   * Notify relevant users when a calibration job is overdue
   * Called by a scheduled job that checks calibrationJob.dueDate
   */
  async *JOB_OVERDUE({ jobId }) {
    const laboratoryId = await findJobLaboratory(jobId);
    if (!laboratoryId) return;

    const [jobData] = await inOrg(laboratoryId, (o) =>
      o
        .select({
          jobIdentifier: calibrationJob.jobId,
          organizationId: calibrationJob.organizationId,
          technicianId: calibrationJob.technicianId,
          createdBy: calibrationJob.createdBy,
          dueDate: calibrationJob.dueDate,
          status: calibrationJob.status,
        })
        .from(calibrationJob)
        .where(eq(calibrationJob.id, jobId))
        .limit(1),
    );

    if (!jobData?.dueDate) return;

    // Only notify for jobs that are still in progress
    if (!isOneOf(OPEN_JOB_STATUSES, jobData.status)) return;

    const daysOverdue = Math.abs(getDaysRemaining(jobData.dueDate));
    const dueDate = formatCalendarDate(jobData.dueDate);

    // Notify the technician (if assigned) and admins/owners
    const recipientIds = new Set<string>();

    if (jobData.technicianId) {
      recipientIds.add(jobData.technicianId);
    }
    recipientIds.add(jobData.createdBy);

    // Also notify admins/owners
    const admins = await adminsAndOwners(jobData.organizationId);
    admins.forEach((id) => recipientIds.add(id));

    for (const recipientId of recipientIds) {
      yield {
        recipientUserId: recipientId,
        organizationId: jobData.organizationId,
        type: "JOB_OVERDUE",
        priority: "HIGH",
        title: "Calibração atrasada",
        message: `A OS ${jobData.jobIdentifier} está atrasada há ${daysOverdue} ${daysOverdue === 1 ? "dia" : "dias"} (vencimento: ${dueDate}).`,
        relatedEntity: {
          entityType: "job",
          entityId: jobId,
          jobId: jobData.jobIdentifier,
        },
        actionUrl: `/dashboard/jobs/${jobId}`,
        emailContext: {
          type: "job",
          data: {
            jobId: jobData.jobIdentifier,
            jobInternalId: jobId,
          },
        },
      };
    }
  },

  /**
   * Tell the lab's admins/owners that a certificate was NOT issued because the
   * unit's signing certificate expired, was revoked or is missing:
   * issuance fails closed instead of producing an unsigned PDF, so someone has
   * to upload a new A1 certificate and re-approve. `reason` is the pt-BR
   * explanation the job was rejected with.
   */
  async *SIGNING_CERTIFICATE_LAPSED({ jobId, reason }) {
    const job = await getJobDetails(jobId);
    if (!job) return;

    const recipients = await adminsAndOwners(job.organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId: job.organizationId,
        type: "SIGNING_CERTIFICATE_LAPSED",
        priority: "HIGH",
        title: "Certificado não emitido: assinatura digital indisponível",
        message: `O certificado ${job.jobIdentifier} não foi emitido: ${reason}`,
        relatedEntity: {
          entityType: "job",
          entityId: jobId,
          jobId: job.jobIdentifier,
        },
        actionUrl: "/dashboard/settings/signature",
      };
    }
  },
} satisfies Partial<NotificationRecipes>;
