/**
 * §7.10 out-of-tolerance notification email drain (#426 Phase 0).
 *
 * Drains `oot_email_outbox` and sends the customer notification email with the
 * generated §7.10 PDF attached. Same reliability contract as
 * service-order-email-drain.ts: claim-lease, bounded retries, explicit
 * dead-letter, never throws. One deliberate difference: a row whose PDF has
 * not been rendered yet is DEFERRED (lease cleared, attempts NOT incremented)
 * — a slow render must never burn the row's retry budget.
 *
 * Invoked by the `oot-emails` cron handler in vercel-src/cron/dispatch.ts.
 */

import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  nonConformance,
  ootEmailOutbox,
  ootNotification,
  organization,
  referenceStandard,
  standardRecall,
} from "@calibra-facil/db/schema";
import { OotNotificationEmail } from "@calibra-facil/email";
import {
  getLabEmailBrand,
  isEmailSuppressed,
  sendOotCustomerEmail,
} from "@calibra-facil/notifications";
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import { isReleaseExhausting } from "./observability-alerts";
import {
  createR2Client,
  downloadFromR2,
  resolveBucketName,
  type R2Env,
} from "./storage";

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_ATTEMPTS = 3;
const CLAIM_LEASE_SECONDS = 120;

export interface DrainOotEmailsResult {
  processed: number;
  sent: number;
  skipped: number;
  /** PDF not rendered yet — left owed without consuming an attempt. */
  deferred: number;
  released: number;
  errors: number;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * R2 credentials from process.env (the drain runs from a cron handler, outside
 * any Hono context). Null when unconfigured — the email is then sent without
 * the PDF attachment rather than failing the row forever.
 */
function getR2EnvFromProcess(): R2Env | null {
  const accountId = getString(process.env.R2_ACCOUNT_ID);
  const accessKeyId = getString(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = getString(process.env.R2_SECRET_ACCESS_KEY);
  const bucketName = getString(process.env.R2_BUCKET_NAME);
  const mediaBucketName = getString(process.env.R2_MEDIA_BUCKET_NAME);
  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucketName ||
    !mediaBucketName
  ) {
    return null;
  }
  return {
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET_NAME: bucketName,
    R2_MEDIA_BUCKET_NAME: mediaBucketName,
  };
}

async function claimOutboxRow(rowId: number): Promise<boolean> {
  const result = await db.execute(
    sql`UPDATE oot_email_outbox
        SET claimed_at = now()
        WHERE id = ${rowId}
          AND processed_at IS NULL
          AND (claimed_at IS NULL OR claimed_at < now() - (${CLAIM_LEASE_SECONDS}::int * interval '1 second'))
        RETURNING id`,
  );
  const rows: unknown = Reflect.get(result, "rows") ?? result;
  return Array.isArray(rows) && rows.length > 0;
}

async function releaseOutboxRow(
  rowId: number,
  errorMessage: string,
  deadLetter: boolean,
): Promise<void> {
  if (deadLetter) {
    await db.execute(
      sql`UPDATE oot_email_outbox
          SET claimed_at = NULL,
              attempts = attempts + 1,
              last_error = ${errorMessage},
              dead_letter_at = now()
          WHERE id = ${rowId}`,
    );
    return;
  }
  await db.execute(
    sql`UPDATE oot_email_outbox
        SET claimed_at = NULL,
            attempts = attempts + 1,
            last_error = ${errorMessage}
        WHERE id = ${rowId}`,
  );
}

/** Clear the lease without consuming an attempt (PDF not rendered yet). */
async function deferOutboxRow(rowId: number): Promise<void> {
  await db.execute(
    sql`UPDATE oot_email_outbox
        SET claimed_at = NULL,
            last_error = 'PDF nao gerado ainda — aguardando renderizacao'
        WHERE id = ${rowId}`,
  );
}

async function markOutboxRowProcessed(rowId: number): Promise<void> {
  await db.execute(
    sql`UPDATE oot_email_outbox
        SET processed_at = now()
        WHERE id = ${rowId}`,
  );
}

export async function drainOotEmailOutbox(options?: {
  batchSize?: number;
  maxAttempts?: number;
}): Promise<DrainOotEmailsResult> {
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const result: DrainOotEmailsResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    deferred: 0,
    released: 0,
    errors: 0,
  };

  try {
    const pendingRows = await db
      .select({
        id: ootEmailOutbox.id,
        organizationId: ootEmailOutbox.organizationId,
        notificationId: ootEmailOutbox.notificationId,
        attempts: ootEmailOutbox.attempts,
      })
      .from(ootEmailOutbox)
      .where(
        and(
          isNull(ootEmailOutbox.processedAt),
          lt(ootEmailOutbox.attempts, maxAttempts),
          sql`(${ootEmailOutbox.claimedAt} IS NULL OR ${ootEmailOutbox.claimedAt} < now() - (${CLAIM_LEASE_SECONDS}::int * interval '1 second'))`,
        ),
      )
      .orderBy(asc(ootEmailOutbox.createdAt))
      .limit(batchSize);

    for (const row of pendingRows) {
      try {
        const claimed = await claimOutboxRow(row.id);
        if (!claimed) {
          result.skipped++;
          continue;
        }

        result.processed++;

        // Re-load the notification tenant-scoped (org predicate in the WHERE).
        const [notification] = await db
          .select({
            id: ootNotification.id,
            ncId: ootNotification.ncId,
            status: ootNotification.status,
            recipientName: ootNotification.recipientName,
            recipientEmail: ootNotification.recipientEmail,
            certificateNumber: ootNotification.certificateNumber,
            pdfR2Key: ootNotification.pdfR2Key,
            ackToken: ootNotification.ackToken,
            acknowledgedAt: ootNotification.acknowledgedAt,
            recallId: ootNotification.recallId,
            ncNumber: nonConformance.ncNumber,
            labName: organization.name,
            assetName: asset.name,
            standardName: referenceStandard.name,
          })
          .from(ootNotification)
          .innerJoin(
            nonConformance,
            eq(ootNotification.ncId, nonConformance.id),
          )
          .innerJoin(
            organization,
            eq(ootNotification.organizationId, organization.id),
          )
          .innerJoin(
            calibrationJob,
            eq(ootNotification.jobId, calibrationJob.id),
          )
          .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
          // #426 Phase 1: recall context (null for as-found notifications).
          .leftJoin(
            standardRecall,
            eq(ootNotification.recallId, standardRecall.id),
          )
          .leftJoin(
            referenceStandard,
            eq(standardRecall.standardId, referenceStandard.id),
          )
          .where(
            and(
              eq(ootNotification.id, row.notificationId),
              eq(ootNotification.organizationId, row.organizationId),
            ),
          )
          .limit(1);

        // Graceful terminal skips — the email is no longer owed.
        if (!notification) {
          await markOutboxRowProcessed(row.id);
          result.skipped++;
          continue;
        }
        if (!notification.recipientEmail?.includes("@")) {
          await markOutboxRowProcessed(row.id);
          result.skipped++;
          continue;
        }
        if (notification.acknowledgedAt) {
          // Receipt already registered (e.g. manual ack) before the email
          // went out — sending now would only confuse the trail.
          await markOutboxRowProcessed(row.id);
          result.skipped++;
          continue;
        }
        if (await isEmailSuppressed(notification.recipientEmail, "all")) {
          await markOutboxRowProcessed(row.id);
          result.skipped++;
          continue;
        }

        // The PDF is the legal artifact — hold the email until it exists.
        if (!notification.pdfR2Key) {
          await deferOutboxRow(row.id);
          result.deferred++;
          continue;
        }

        // Attachment: best-effort download; a transient R2 failure releases
        // the row for retry (the attachment is part of the deliverable).
        let attachment: { filename: string; content: Uint8Array } | undefined;
        const r2Env = getR2EnvFromProcess();
        if (r2Env) {
          const client = createR2Client(r2Env);
          const bytes = await downloadFromR2(
            client,
            resolveBucketName(r2Env, "documents"),
            notification.pdfR2Key,
          );
          attachment = {
            filename: `notificacao-7-10-${notification.ncNumber}.pdf`,
            content: bytes,
          };
        }

        const brand = await getLabEmailBrand(row.organizationId);
        const apiBaseUrl = process.env.API_URL ?? "http://localhost:3000";
        const ackUrl = `${apiBaseUrl}/api/public/oot-ack/${notification.ackToken}`;

        const sendResult = await sendOotCustomerEmail({
          recipientEmail: notification.recipientEmail,
          brand,
          subject: `Notificação de resultado fora de tolerância — ${notification.ncNumber}`,
          email: OotNotificationEmail({
            recipientName: notification.recipientName ?? "Cliente",
            labName: brand?.name ?? notification.labName,
            ncNumber: notification.ncNumber,
            instrumentDescription: notification.assetName,
            certificateNumber: notification.certificateNumber ?? undefined,
            kind: notification.recallId ? "standard_recall" : "as_found",
            standardName: notification.standardName ?? undefined,
            ackUrl,
            logoSrc: brand?.logoSrc,
            brand,
          }),
          attachment,
        });

        if (sendResult.sent) {
          await markOutboxRowProcessed(row.id);
          // Advance the evidence record; never regress an ACKNOWLEDGED row.
          await db
            .update(ootNotification)
            .set({
              status: "SENT",
              sentAt: new Date(),
            })
            .where(
              and(
                eq(ootNotification.id, notification.id),
                isNull(ootNotification.acknowledgedAt),
              ),
            );
          result.sent++;
        } else if (sendResult.skipped) {
          // Misconfigured transport etc. — leave owed for a later drain, but
          // don't burn an attempt on a config problem.
          await deferOutboxRow(row.id);
          result.deferred++;
        } else {
          await releaseOutboxRow(
            row.id,
            sendResult.error ?? "unknown send error",
            isReleaseExhausting(row.attempts, maxAttempts),
          );
          result.released++;
        }
      } catch (rowError) {
        result.errors++;
        const message =
          rowError instanceof Error ? rowError.message : String(rowError);
        console.error(
          `[OotEmailDrain] Row failed (outbox id=${row.id}):`,
          rowError,
        );
        try {
          await releaseOutboxRow(
            row.id,
            message,
            isReleaseExhausting(row.attempts, maxAttempts),
          );
          result.released++;
        } catch (releaseError) {
          console.error(
            `[OotEmailDrain] Release failed for outbox id=${row.id}:`,
            releaseError,
          );
        }
      }
    }
  } catch (error) {
    result.errors++;
    console.error("[OotEmailDrain] Drain failed:", error);
  }

  return result;
}
