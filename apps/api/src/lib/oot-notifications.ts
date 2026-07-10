import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  customer,
  nonConformance,
  ootEmailOutbox,
  ootNotification,
  type NonConformanceTriggerSource,
} from "@calibra-facil/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { enqueueBackgroundJob } from "./background-jobs";
import { createNonConformanceRecord } from "./non-conformances";

/**
 * §7.10 out-of-tolerance workflow (#426 Phase 0).
 *
 * Flagging an approved job as out-of-tolerance (as found) atomically opens a
 * typed non-conformance and — when requested — creates the customer
 * notification record plus its transactional email-outbox row, then enqueues
 * the notification-PDF background job. Shared by the cloud route
 * (POST /api/jobs/:id/flag-oot) and the desktop sync ingest so both paths
 * produce identical evidence records.
 *
 * Deliberate invariant (mirrors the as-found verdict itself): none of this
 * gates certificate issuance — OOT opens a quality workflow, it never blocks
 * approval.
 */

/** Stable outbox dedup key: one notification email per oot_notification row. */
export const OOT_NOTIFICATION_EVENT_KEY = "oot_notification";

export type FlagJobOutOfToleranceParams = {
  organizationId: string;
  /** User opening the NC (also recorded as the notification approver). */
  actorUserId: string;
  jobId: number;
  description?: string;
  affectedScope?: string;
  notifyCustomer: boolean;
  triggerSource: NonConformanceTriggerSource;
  ipAddress?: string | null;
};

export type FlagJobOutOfToleranceResult =
  | {
      ok: false;
      status: 404 | 409;
      code: "JOB_NOT_FOUND" | "JOB_NOT_APPROVED" | "OOT_ALREADY_FLAGGED";
      message: string;
    }
  | {
      ok: true;
      nc: typeof nonConformance.$inferSelect;
      notification: typeof ootNotification.$inferSelect | null;
    };

type JobRow = {
  id: number;
  jobId: string;
  status: string;
  customerId: number;
  asFoundMargins: number[] | null;
};

function buildDefaultDescription(job: JobRow): string {
  const margins = job.asFoundMargins ?? [];
  const pointsTotal = margins.length;
  const pointsOut = margins.filter((margin) => margin < 0).length;
  const base = `Condição como encontrada (as found) fora da tolerância na calibração ${job.jobId}.`;
  if (pointsTotal === 0) return base;
  return `${base} ${pointsOut} de ${pointsTotal} ponto(s) com margem de conformidade negativa antes do ajuste.`;
}

/**
 * Creates the oot_notification evidence row + its email-outbox row (same
 * transaction) and enqueues the PDF render. Recipient is snapshotted from the
 * job's customer at flag time. When the customer has no e-mail the outbox row
 * is skipped — the PDF is still generated for manual delivery and the UI
 * surfaces the missing address.
 */
async function createNotificationForNc(input: {
  nc: typeof nonConformance.$inferSelect;
  job: JobRow;
  organizationId: string;
  actorUserId: string;
  affectedScope?: string;
}): Promise<typeof ootNotification.$inferSelect | null> {
  const [customerRow] = await db
    .select({ name: customer.name, email: customer.email })
    .from(customer)
    .where(eq(customer.id, input.job.customerId))
    .limit(1);

  const recipientEmail = customerRow?.email?.trim() || null;

  const notification = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(ootNotification)
      .values({
        organizationId: input.organizationId,
        ncId: input.nc.id,
        jobId: input.job.id,
        certificateNumber: input.job.jobId,
        recipientName: customerRow?.name ?? null,
        recipientEmail,
        affectedScope: input.affectedScope ?? null,
        status: "PENDING",
        approvedBy: input.actorUserId,
      })
      .returning();

    if (!inserted) return null;

    if (recipientEmail) {
      await tx
        .insert(ootEmailOutbox)
        .values({
          organizationId: input.organizationId,
          notificationId: inserted.id,
          eventKey: OOT_NOTIFICATION_EVENT_KEY,
          payload: { notificationId: inserted.id, ncId: input.nc.id },
        })
        .onConflictDoNothing();
    }

    return inserted;
  });

  if (notification) {
    await enqueueBackgroundJob({
      type: "OOT_NOTIFICATION",
      notificationId: notification.id,
      userId: input.actorUserId,
    });
  }

  return notification;
}

export async function flagJobOutOfTolerance(
  params: FlagJobOutOfToleranceParams,
): Promise<FlagJobOutOfToleranceResult> {
  const [job] = await db
    .select({
      id: calibrationJob.id,
      jobId: calibrationJob.jobId,
      status: calibrationJob.status,
      customerId: calibrationJob.customerId,
      asFoundMargins: calibrationJob.asFoundMargins,
    })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.id, params.jobId),
        eq(calibrationJob.organizationId, params.organizationId),
      ),
    )
    .limit(1);

  if (!job) {
    return {
      ok: false,
      status: 404,
      code: "JOB_NOT_FOUND",
      message: "Calibração não encontrada",
    };
  }

  // The as-found verdict only exists after approval; GENERATING_PDF is the
  // post-approval window while the certificate renders.
  if (
    job.status !== "APPROVED" &&
    job.status !== "SUPERSEDED" &&
    job.status !== "GENERATING_PDF"
  ) {
    return {
      ok: false,
      status: 409,
      code: "JOB_NOT_APPROVED",
      message:
        "Apenas calibrações aprovadas podem ser sinalizadas como fora de tolerância",
    };
  }

  // One open OOT NC per job. If a previous flag created the NC but died before
  // the notification record, self-heal by attaching the notification now
  // instead of stranding the workflow.
  const [existing] = await db
    .select()
    .from(nonConformance)
    .where(
      and(
        eq(nonConformance.organizationId, params.organizationId),
        eq(nonConformance.jobId, job.id),
        eq(nonConformance.type, "out_of_tolerance"),
        ne(nonConformance.status, "resolved"),
      ),
    )
    .limit(1);

  if (existing) {
    if (!params.notifyCustomer) {
      return {
        ok: false,
        status: 409,
        code: "OOT_ALREADY_FLAGGED",
        message: `Esta calibração já possui a não conformidade ${existing.ncNumber} aberta por fora de tolerância`,
      };
    }

    const [existingNotification] = await db
      .select()
      .from(ootNotification)
      .where(eq(ootNotification.ncId, existing.id))
      .limit(1);

    if (existingNotification) {
      return {
        ok: false,
        status: 409,
        code: "OOT_ALREADY_FLAGGED",
        message: `Esta calibração já possui a não conformidade ${existing.ncNumber} aberta por fora de tolerância`,
      };
    }

    const notification = await createNotificationForNc({
      nc: existing,
      job,
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      affectedScope: params.affectedScope,
    });
    return { ok: true, nc: existing, notification };
  }

  const description = params.description?.trim()
    ? params.description.trim()
    : buildDefaultDescription(job);
  const fullDescription = params.affectedScope?.trim()
    ? `${description}\n\nEscopo potencialmente afetado: ${params.affectedScope.trim()}`
    : description;

  const newNc = await createNonConformanceRecord({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    type: "out_of_tolerance",
    description: fullDescription,
    detectedAt: new Date(),
    jobId: job.id,
    triggerSource: params.triggerSource,
    ipAddress: params.ipAddress,
    auditChanges: {
      initial: {
        type: "out_of_tolerance",
        triggerSource: params.triggerSource,
        jobId: job.id,
        notifyCustomer: params.notifyCustomer,
      },
    },
  });

  const notification = params.notifyCustomer
    ? await createNotificationForNc({
        nc: newNc,
        job,
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        affectedScope: params.affectedScope,
      })
    : null;

  return { ok: true, nc: newNc, notification };
}

/**
 * Attaches a §7.10 notification (+ outbox row + PDF job) to an existing
 * out-of-tolerance NC that has none yet. Used by the desktop sync ingest when
 * an OOT-typed NC captured offline lands with a job link — the email then
 * dispatches on reconnect without any desktop email path. No-op (returns
 * null) when the NC is not OOT-typed, has no job, or already has one.
 */
export async function ensureOotNotificationForNc(input: {
  nc: typeof nonConformance.$inferSelect;
  organizationId: string;
  actorUserId: string;
  affectedScope?: string;
}): Promise<typeof ootNotification.$inferSelect | null> {
  if (input.nc.type !== "out_of_tolerance" || !input.nc.jobId) return null;

  const [existing] = await db
    .select({ id: ootNotification.id })
    .from(ootNotification)
    .where(eq(ootNotification.ncId, input.nc.id))
    .limit(1);
  if (existing) return null;

  const [job] = await db
    .select({
      id: calibrationJob.id,
      jobId: calibrationJob.jobId,
      status: calibrationJob.status,
      customerId: calibrationJob.customerId,
      asFoundMargins: calibrationJob.asFoundMargins,
    })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.id, input.nc.jobId),
        eq(calibrationJob.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!job) return null;

  return createNotificationForNc({
    nc: input.nc,
    job,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    affectedScope: input.affectedScope,
  });
}
