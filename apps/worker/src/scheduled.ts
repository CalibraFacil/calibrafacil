/**
 * Scheduled Compliance Alerts - ISO 17025 Compliance
 *
 * Runs daily at 08:00 UTC to check for:
 * 1. Assets due for recalibration within 7 days
 * 2. Reference standards expiring within 30 days
 * 3. Reference standards that have EXPIRED (ISO 17025 Clause 6.4.6)
 * 4. Overdue calibration jobs
 */

import { Client } from "pg";
import {
  notifyAssetDueForRecalibration,
  notifyCompetenceExpired,
  notifyCompetenceExpiring,
  notifyJobOverdue,
  notifyStandardExpired,
  notifyStandardExpiring,
  notifyVisitReminder,
  sendPortalDueDigests,
  type PortalDigestRunResult,
} from "@calibra-facil/notifications";

interface ScheduledEnv {
  DATABASE_URL: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_FROM?: string;
  EMAIL_LOGO_URL?: string;
  WEB_URL?: string;
  APP_URL?: string;
}

// Types for database rows
interface AssetDueRow {
  id: number;
  name: string;
  tag: string;
  customer_id: number;
  customer_name: string;
  organization_id: string;
  next_calibration_date: Date;
  days_until_due: number;
}

interface StandardExpiringRow {
  id: number;
  name: string;
  serial_number: string;
  organization_id: string;
  next_calibration_date: Date;
  days_until_expiry: number;
}

interface StandardExpiredRow {
  id: number;
  name: string;
  serial_number: string;
  organization_id: string;
  next_calibration_date: Date;
  days_expired: number;
}

interface OverdueJobRow {
  id: number;
  job_id: string;
  organization_id: string;
  technician_id: string | null;
  created_by: string;
  due_date: Date;
  days_overdue: number;
}

interface CompetenceExpiringRow {
  id: number;
  user_id: string;
  user_name: string;
  scope_description: string;
  organization_id: string;
  expires_at: Date;
  days_until_expiry: number;
}

interface CompetenceExpiredRow {
  id: number;
  user_id: string;
  user_name: string;
  scope_description: string;
  organization_id: string;
  expires_at: Date;
  days_expired: number;
}

interface VisitDueRow {
  id: number;
  organization_id: string;
  scheduled_at: Date;
  days_until_visit: number;
}

// Helper to run a database operation with a fresh connection
async function withDbClient<T>(
  env: ScheduledEnv,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: env.DATABASE_URL,
  });
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

/**
 * Check for assets due for recalibration within 7 days.
 *
 * Duplicate prevention: Assets are notified once per 7-day window.
 * This is intentional - we alert once when entering the window, not daily spam.
 * The asset should be recalibrated or the alert will fire again next week.
 */
async function checkAssetsDueForRecalibration(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<AssetDueRow[]> {
  const result = await client.query<AssetDueRow>(
    `
    SELECT
      a.id,
      a.name,
      a.tag,
      a.customer_id,
      c.name as customer_name,
      ou.organization_id,
      a.next_calibration_date,
      EXTRACT(DAY FROM a.next_calibration_date - CURRENT_DATE)::int as days_until_due
    FROM asset a
    JOIN customer c ON a.customer_id = c.id
    JOIN organization_unit ou ON a.unit_id = ou.id
    WHERE a.status = 'ACTIVE'
      AND a.next_calibration_date IS NOT NULL
      AND a.next_calibration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'asset'
          AND sn.entity_id = a.id
          AND sn.type = 'ASSET_DUE_FOR_RECALIBRATION'
          AND sn.lead_time_days = 7
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '7 days'
      )
    ORDER BY a.next_calibration_date ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for reference standards expiring within 30 days.
 *
 * Duplicate prevention: Standards are notified once per 7-day window.
 * With 30-day lead time, this means up to ~4 weekly reminders before expiry.
 */
async function checkStandardsExpiring(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<StandardExpiringRow[]> {
  const result = await client.query<StandardExpiringRow>(
    `
    SELECT
      rs.id,
      rs.name,
      rs.serial_number,
      rs.organization_id,
      rs.next_calibration_date,
      EXTRACT(DAY FROM rs.next_calibration_date - CURRENT_DATE)::int as days_until_expiry
    FROM reference_standard rs
    WHERE rs.status = 'ACTIVE'
      AND rs.next_calibration_date IS NOT NULL
      AND rs.next_calibration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'standard'
          AND sn.entity_id = rs.id
          AND sn.type = 'STANDARD_EXPIRING'
          AND sn.lead_time_days = 30
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '7 days'
      )
    ORDER BY rs.next_calibration_date ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for reference standards that have EXPIRED (ISO 17025 Clause 6.4.6).
 *
 * Expired standards block job execution - this notifies admins immediately.
 * Duplicate prevention: Expired standards are notified weekly until renewed.
 */
async function checkStandardsExpired(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<StandardExpiredRow[]> {
  const result = await client.query<StandardExpiredRow>(
    `
    SELECT
      rs.id,
      rs.name,
      rs.serial_number,
      rs.organization_id,
      rs.next_calibration_date,
      EXTRACT(DAY FROM CURRENT_DATE - rs.next_calibration_date)::int as days_expired
    FROM reference_standard rs
    WHERE rs.status = 'ACTIVE'
      AND rs.next_calibration_date IS NOT NULL
      AND rs.next_calibration_date < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'standard'
          AND sn.entity_id = rs.id
          AND sn.type = 'STANDARD_EXPIRED'
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '7 days'
      )
    ORDER BY rs.next_calibration_date ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for overdue calibration jobs.
 *
 * Duplicate prevention: Overdue jobs are notified daily until resolved.
 * This ensures visibility for time-sensitive compliance issues.
 */
async function checkOverdueJobs(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<OverdueJobRow[]> {
  const result = await client.query<OverdueJobRow>(
    `
    SELECT
      cj.id,
      cj.job_id,
      cj.organization_id,
      cj.technician_id,
      cj.created_by,
      cj.due_date,
      EXTRACT(DAY FROM CURRENT_DATE - cj.due_date)::int as days_overdue
    FROM calibration_job cj
    WHERE cj.status IN ('DRAFT', 'IN_PROGRESS', 'REVIEW')
      AND cj.due_date IS NOT NULL
      AND cj.due_date < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'job'
          AND sn.entity_id = cj.id
          AND sn.type = 'JOB_OVERDUE'
          AND sn.lead_time_days = 0
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '1 day'
      )
    ORDER BY cj.due_date ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Record that a scheduled notification was sent
 */
async function recordScheduledNotification(
  client: Client,
  params: {
    organizationId: string;
    type: string;
    entityType: string;
    entityId: number;
    scheduledFor: Date;
    leadTimeDays: number;
  },
): Promise<void> {
  await client.query(
    `
    INSERT INTO scheduled_notification (
      organization_id,
      type,
      entity_type,
      entity_id,
      scheduled_for,
      lead_time_days,
      sent_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (organization_id, type, entity_type, entity_id, lead_time_days)
    DO UPDATE SET sent_at = NOW()
    `,
    [
      params.organizationId,
      params.type,
      params.entityType,
      params.entityId,
      params.scheduledFor,
      params.leadTimeDays,
    ],
  );
}

/**
 * Check for personnel competences expiring within 30 days.
 * ISO 17025 Clause 6.2.3 - Personnel competence tracking.
 *
 * Duplicate prevention: Competences are notified once per 7-day window.
 */
async function checkCompetencesExpiring(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<CompetenceExpiringRow[]> {
  const result = await client.query<CompetenceExpiringRow>(
    `
    SELECT
      pc.id,
      pc.user_id,
      u.name as user_name,
      pc.scope_description,
      pc.organization_id,
      pc.expires_at,
      EXTRACT(DAY FROM pc.expires_at - CURRENT_DATE)::int as days_until_expiry
    FROM personnel_competence pc
    JOIN "user" u ON pc.user_id = u.id
    WHERE pc.status = 'ACTIVE'
      AND pc.deleted_at IS NULL
      AND pc.expires_at IS NOT NULL
      AND pc.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'competence'
          AND sn.entity_id = pc.id
          AND sn.type = 'COMPETENCE_EXPIRING'
          AND sn.lead_time_days = 30
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '7 days'
      )
    ORDER BY pc.expires_at ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for personnel competences that have EXPIRED.
 * Auto-expire: update status to EXPIRED.
 *
 * Duplicate prevention: Expired competences are notified weekly until renewed.
 */
async function checkCompetencesExpired(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<CompetenceExpiredRow[]> {
  const result = await client.query<CompetenceExpiredRow>(
    `
    SELECT
      pc.id,
      pc.user_id,
      u.name as user_name,
      pc.scope_description,
      pc.organization_id,
      pc.expires_at,
      EXTRACT(DAY FROM CURRENT_DATE - pc.expires_at)::int as days_expired
    FROM personnel_competence pc
    JOIN "user" u ON pc.user_id = u.id
    WHERE pc.status = 'ACTIVE'
      AND pc.deleted_at IS NULL
      AND pc.expires_at IS NOT NULL
      AND pc.expires_at < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'competence'
          AND sn.entity_id = pc.id
          AND sn.type = 'COMPETENCE_EXPIRED'
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '7 days'
      )
    ORDER BY pc.expires_at ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for confirmed on-site visits happening within the next 3 days.
 *
 * Duplicate prevention: each visit is reminded once per 3-day window, so a
 * visit confirmed far ahead still gets exactly one heads-up as it approaches.
 */
async function checkVisitsDueSoon(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<VisitDueRow[]> {
  const result = await client.query<VisitDueRow>(
    `
    SELECT
      v.id,
      v.organization_id,
      v.scheduled_at,
      (v.scheduled_at::date - CURRENT_DATE)::int as days_until_visit
    FROM calibration_visit v
    WHERE v.status = 'CONFIRMED'
      AND v.scheduled_at IS NOT NULL
      AND v.scheduled_at::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'visit'
          AND sn.entity_id = v.id
          AND sn.type = 'VISIT_REMINDER'
          AND sn.lead_time_days = 3
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '3 days'
      )
    ORDER BY v.scheduled_at ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

const BATCH_SIZE = 100;

/**
 * Process all scheduled compliance notifications with pagination
 */
export async function processScheduledNotifications(
  env: ScheduledEnv,
): Promise<{
  assetsProcessed: number;
  standardsProcessed: number;
  standardsExpiredProcessed: number;
  jobsProcessed: number;
  competencesExpiringProcessed: number;
  competencesExpiredProcessed: number;
  visitsProcessed: number;
}> {
  let assetsProcessed = 0;
  let standardsProcessed = 0;
  let standardsExpiredProcessed = 0;
  let jobsProcessed = 0;
  let competencesExpiringProcessed = 0;
  let competencesExpiredProcessed = 0;
  let visitsProcessed = 0;

  await withDbClient(env, async (client) => {
    // 1. Process assets due for recalibration (with pagination)
    let assetOffset = 0;
    let assetBatch: AssetDueRow[];

    do {
      assetBatch = await checkAssetsDueForRecalibration(
        client,
        assetOffset,
        BATCH_SIZE,
      );
      if (assetBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${assetBatch.length} assets (offset ${assetOffset})`,
        );
      }

      for (const asset of assetBatch) {
        try {
          await notifyAssetDueForRecalibration(asset.id, asset.organization_id);

          await recordScheduledNotification(client, {
            organizationId: asset.organization_id,
            type: "ASSET_DUE_FOR_RECALIBRATION",
            entityType: "asset",
            entityId: asset.id,
            scheduledFor: asset.next_calibration_date,
            leadTimeDays: 7,
          });

          assetsProcessed++;
        } catch (error) {
          console.error(
            `[Scheduled] Error processing asset ${asset.id}:`,
            error,
          );
        }
      }

      assetOffset += BATCH_SIZE;
    } while (assetBatch.length === BATCH_SIZE);

    // 2. Process expiring reference standards (with pagination)
    let standardOffset = 0;
    let standardBatch: StandardExpiringRow[];

    do {
      standardBatch = await checkStandardsExpiring(
        client,
        standardOffset,
        BATCH_SIZE,
      );
      if (standardBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${standardBatch.length} standards (offset ${standardOffset})`,
        );
      }

      for (const standard of standardBatch) {
        try {
          await notifyStandardExpiring(standard.id, standard.organization_id);

          await recordScheduledNotification(client, {
            organizationId: standard.organization_id,
            type: "STANDARD_EXPIRING",
            entityType: "standard",
            entityId: standard.id,
            scheduledFor: standard.next_calibration_date,
            leadTimeDays: 30,
          });

          standardsProcessed++;
        } catch (error) {
          console.error(
            `[Scheduled] Error processing standard ${standard.id}:`,
            error,
          );
        }
      }

      standardOffset += BATCH_SIZE;
    } while (standardBatch.length === BATCH_SIZE);

    // 3. Process EXPIRED reference standards - ISO 17025 Clause 6.4.6 (with pagination)
    let expiredOffset = 0;
    let expiredBatch: StandardExpiredRow[];

    do {
      expiredBatch = await checkStandardsExpired(
        client,
        expiredOffset,
        BATCH_SIZE,
      );
      if (expiredBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${expiredBatch.length} expired standards (offset ${expiredOffset})`,
        );
      }

      for (const standard of expiredBatch) {
        try {
          await notifyStandardExpired(standard.id, standard.organization_id);

          await recordScheduledNotification(client, {
            organizationId: standard.organization_id,
            type: "STANDARD_EXPIRED",
            entityType: "standard",
            entityId: standard.id,
            scheduledFor: standard.next_calibration_date,
            leadTimeDays: 0,
          });

          standardsExpiredProcessed++;
        } catch (error) {
          console.error(
            `[Scheduled] Error processing expired standard ${standard.id}:`,
            error,
          );
        }
      }

      expiredOffset += BATCH_SIZE;
    } while (expiredBatch.length === BATCH_SIZE);

    // 4. Process overdue jobs (with pagination)
    let jobOffset = 0;
    let jobBatch: OverdueJobRow[];

    do {
      jobBatch = await checkOverdueJobs(client, jobOffset, BATCH_SIZE);
      if (jobBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${jobBatch.length} overdue jobs (offset ${jobOffset})`,
        );
      }

      for (const job of jobBatch) {
        try {
          await notifyJobOverdue(job.id);

          await recordScheduledNotification(client, {
            organizationId: job.organization_id,
            type: "JOB_OVERDUE",
            entityType: "job",
            entityId: job.id,
            scheduledFor: job.due_date,
            leadTimeDays: 0,
          });

          jobsProcessed++;
        } catch (error) {
          console.error(`[Scheduled] Error processing job ${job.id}:`, error);
        }
      }

      jobOffset += BATCH_SIZE;
    } while (jobBatch.length === BATCH_SIZE);

    // 5. Process competences expiring within 30 days - ISO 17025 Clause 6.2.3 (with pagination)
    let compExpiringOffset = 0;
    let compExpiringBatch: CompetenceExpiringRow[];

    do {
      compExpiringBatch = await checkCompetencesExpiring(
        client,
        compExpiringOffset,
        BATCH_SIZE,
      );
      if (compExpiringBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${compExpiringBatch.length} expiring competences (offset ${compExpiringOffset})`,
        );
      }

      for (const comp of compExpiringBatch) {
        try {
          await notifyCompetenceExpiring(comp.id, comp.organization_id);

          await recordScheduledNotification(client, {
            organizationId: comp.organization_id,
            type: "COMPETENCE_EXPIRING",
            entityType: "competence",
            entityId: comp.id,
            scheduledFor: comp.expires_at,
            leadTimeDays: 30,
          });

          competencesExpiringProcessed++;
        } catch (error) {
          console.error(
            `[Scheduled] Error processing expiring competence ${comp.id}:`,
            error,
          );
        }
      }

      compExpiringOffset += BATCH_SIZE;
    } while (compExpiringBatch.length === BATCH_SIZE);

    // 6. Process EXPIRED competences - auto-expire and notify (with pagination)
    let compExpiredOffset = 0;
    let compExpiredBatch: CompetenceExpiredRow[];

    do {
      compExpiredBatch = await checkCompetencesExpired(
        client,
        compExpiredOffset,
        BATCH_SIZE,
      );
      if (compExpiredBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${compExpiredBatch.length} expired competences (offset ${compExpiredOffset})`,
        );
      }

      for (const comp of compExpiredBatch) {
        try {
          // Auto-expire: update status to EXPIRED
          await client.query(
            `UPDATE personnel_competence SET status = 'EXPIRED' WHERE id = $1 AND status = 'ACTIVE'`,
            [comp.id],
          );

          // Log the auto-expiration in audit log
          await client.query(
            `INSERT INTO personnel_competence_audit_log (competence_id, action, changes, performed_by)
             VALUES ($1, 'expire', $2, 'system')`,
            [
              comp.id,
              JSON.stringify({
                status: { old: "ACTIVE", new: "EXPIRED" },
                autoExpired: true,
              }),
            ],
          );

          await notifyCompetenceExpired(comp.id, comp.organization_id);

          await recordScheduledNotification(client, {
            organizationId: comp.organization_id,
            type: "COMPETENCE_EXPIRED",
            entityType: "competence",
            entityId: comp.id,
            scheduledFor: comp.expires_at,
            leadTimeDays: 0,
          });

          competencesExpiredProcessed++;
        } catch (error) {
          console.error(
            `[Scheduled] Error processing expired competence ${comp.id}:`,
            error,
          );
        }
      }

      compExpiredOffset += BATCH_SIZE;
    } while (compExpiredBatch.length === BATCH_SIZE);

    // 7. Remind técnico + customer of upcoming on-site visits (with pagination)
    let visitOffset = 0;
    let visitBatch: VisitDueRow[];

    do {
      visitBatch = await checkVisitsDueSoon(client, visitOffset, BATCH_SIZE);
      if (visitBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${visitBatch.length} upcoming visits (offset ${visitOffset})`,
        );
      }

      for (const visit of visitBatch) {
        try {
          await notifyVisitReminder(visit.id);

          await recordScheduledNotification(client, {
            organizationId: visit.organization_id,
            type: "VISIT_REMINDER",
            entityType: "visit",
            entityId: visit.id,
            scheduledFor: visit.scheduled_at,
            leadTimeDays: 3,
          });

          visitsProcessed++;
        } catch (error) {
          console.error(
            `[Scheduled] Error processing visit ${visit.id}:`,
            error,
          );
        }
      }

      visitOffset += BATCH_SIZE;
    } while (visitBatch.length === BATCH_SIZE);
  });

  return {
    assetsProcessed,
    standardsProcessed,
    standardsExpiredProcessed,
    jobsProcessed,
    competencesExpiringProcessed,
    competencesExpiredProcessed,
    visitsProcessed,
  };
}

/**
 * Client-portal due-calibration digest (PORTAL_DIGEST background job).
 * All selection and sending lives in @calibra-facil/notifications; the worker
 * just provides the runtime (process.env carries DATABASE_URL + Resend keys,
 * exactly like the notify* calls above).
 */
export async function processPortalDigest(): Promise<PortalDigestRunResult> {
  return sendPortalDueDigests();
}
