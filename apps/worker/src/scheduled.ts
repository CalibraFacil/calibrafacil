/**
 * Scheduled Compliance Alerts - ISO 17025 Compliance
 *
 * Runs daily at 08:00 UTC to check for:
 * 1. Assets due for recalibration within 7 days
 * 2. Reference standards expiring within 30 days
 * 3. Overdue calibration jobs
 */

import { Client } from "pg";

interface ScheduledEnv {
  HYPERDRIVE: Hyperdrive;
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

interface OverdueJobRow {
  id: number;
  job_id: string;
  organization_id: string;
  technician_id: string | null;
  created_by: string;
  due_date: Date;
  days_overdue: number;
}

interface AdminRecipient {
  user_id: string;
}

// Helper to run a database operation with a fresh connection
async function withDbClient<T>(
  env: ScheduledEnv,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
  });
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

/**
 * Check for assets due for recalibration within 7 days
 */
async function checkAssetsDueForRecalibration(
  client: Client,
): Promise<AssetDueRow[]> {
  const result = await client.query<AssetDueRow>(
    `
    SELECT
      a.id,
      a.name,
      a.tag,
      a.customer_id,
      c.name as customer_name,
      a.organization_id,
      a.next_calibration_date,
      EXTRACT(DAY FROM a.next_calibration_date - CURRENT_DATE)::int as days_until_due
    FROM asset a
    JOIN customer c ON a.customer_id = c.id
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
          AND sn.sent_at > CURRENT_DATE - INTERVAL '1 day'
      )
    ORDER BY a.next_calibration_date ASC
    LIMIT 100
    `,
  );

  return result.rows;
}

/**
 * Check for reference standards expiring within 30 days
 */
async function checkStandardsExpiring(
  client: Client,
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
    LIMIT 100
    `,
  );

  return result.rows;
}

/**
 * Check for overdue calibration jobs
 */
async function checkOverdueJobs(client: Client): Promise<OverdueJobRow[]> {
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
    LIMIT 100
    `,
  );

  return result.rows;
}

/**
 * Get admin and owner users for an organization
 */
async function getOrgAdmins(
  client: Client,
  organizationId: string,
): Promise<string[]> {
  const result = await client.query<AdminRecipient>(
    `
    SELECT user_id FROM member
    WHERE organization_id = $1
      AND role IN ('admin', 'owner')
    `,
    [organizationId],
  );

  return result.rows.map((r) => r.user_id);
}

/**
 * Create notification in database
 */
async function createNotification(
  client: Client,
  params: {
    recipientUserId: string;
    organizationId: string;
    type: string;
    priority: string;
    title: string;
    message: string;
    relatedEntity: object;
    actionUrl: string;
  },
): Promise<void> {
  await client.query(
    `
    INSERT INTO notification (
      recipient_user_id,
      organization_id,
      type,
      priority,
      title,
      message,
      related_entity,
      action_url,
      channels_sent,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'UNREAD')
    `,
    [
      params.recipientUserId,
      params.organizationId,
      params.type,
      params.priority,
      params.title,
      params.message,
      JSON.stringify(params.relatedEntity),
      params.actionUrl,
      JSON.stringify(["IN_APP"]),
    ],
  );
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
 * Process all scheduled compliance notifications
 */
export async function processScheduledNotifications(
  env: ScheduledEnv,
): Promise<{
  assetsProcessed: number;
  standardsProcessed: number;
  jobsProcessed: number;
}> {
  let assetsProcessed = 0;
  let standardsProcessed = 0;
  let jobsProcessed = 0;

  await withDbClient(env, async (client) => {
    // 1. Process assets due for recalibration
    const assetsDue = await checkAssetsDueForRecalibration(client);
    console.log(`[Scheduled] Found ${assetsDue.length} assets due for recalibration`);

    for (const asset of assetsDue) {
      try {
        const admins = await getOrgAdmins(client, asset.organization_id);

        for (const adminId of admins) {
          await createNotification(client, {
            recipientUserId: adminId,
            organizationId: asset.organization_id,
            type: "ASSET_DUE_FOR_RECALIBRATION",
            priority: "MEDIUM",
            title: "Ativo vencendo calibração",
            message: `O ativo "${asset.name}" (${asset.tag}) do cliente ${asset.customer_name} vence em ${asset.days_until_due} dia(s).`,
            relatedEntity: {
              entityType: "asset",
              entityId: asset.id,
            },
            actionUrl: `/dashboard/assets/${asset.id}`,
          });
        }

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
        console.error(`[Scheduled] Error processing asset ${asset.id}:`, error);
      }
    }

    // 2. Process expiring reference standards
    const standardsExpiring = await checkStandardsExpiring(client);
    console.log(`[Scheduled] Found ${standardsExpiring.length} standards expiring`);

    for (const standard of standardsExpiring) {
      try {
        const admins = await getOrgAdmins(client, standard.organization_id);

        for (const adminId of admins) {
          await createNotification(client, {
            recipientUserId: adminId,
            organizationId: standard.organization_id,
            type: "STANDARD_EXPIRING",
            priority: "HIGH",
            title: "Padrão de referência vencendo",
            message: `O padrão "${standard.name}" (${standard.serial_number}) vence em ${standard.days_until_expiry} dia(s). Providencie a recalibração.`,
            relatedEntity: {
              entityType: "standard",
              entityId: standard.id,
            },
            actionUrl: `/dashboard/standards/${standard.id}`,
          });
        }

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

    // 3. Process overdue jobs
    const overdueJobs = await checkOverdueJobs(client);
    console.log(`[Scheduled] Found ${overdueJobs.length} overdue jobs`);

    for (const job of overdueJobs) {
      try {
        // Notify the technician (or creator if no technician)
        const recipientId = job.technician_id ?? job.created_by;

        await createNotification(client, {
          recipientUserId: recipientId,
          organizationId: job.organization_id,
          type: "JOB_OVERDUE",
          priority: "HIGH",
          title: "Calibração atrasada",
          message: `A OS ${job.job_id} está ${job.days_overdue} dia(s) atrasada.`,
          relatedEntity: {
            entityType: "job",
            entityId: job.id,
            jobId: job.job_id,
          },
          actionUrl: `/dashboard/jobs/${job.id}`,
        });

        // Also notify admins
        const admins = await getOrgAdmins(client, job.organization_id);
        for (const adminId of admins) {
          if (adminId === recipientId) continue; // Don't duplicate

          await createNotification(client, {
            recipientUserId: adminId,
            organizationId: job.organization_id,
            type: "JOB_OVERDUE",
            priority: "HIGH",
            title: "Calibração atrasada",
            message: `A OS ${job.job_id} está ${job.days_overdue} dia(s) atrasada.`,
            relatedEntity: {
              entityType: "job",
              entityId: job.id,
              jobId: job.job_id,
            },
            actionUrl: `/dashboard/jobs/${job.id}`,
          });
        }

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
  });

  return { assetsProcessed, standardsProcessed, jobsProcessed };
}
