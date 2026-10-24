import { type OrgSession } from "../pdf-render.js";

/**
 * Record that a scheduled notification was sent
 */
export async function recordScheduledNotification(
  lab: OrgSession,
  params: {
    organizationId: string;
    type: string;
    entityType: string;
    entityId: number;
    scheduledFor: Date;
    leadTimeDays: number;
  },
): Promise<void> {
  await lab.query(
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
    DO UPDATE SET sent_at = NOW(), scheduled_for = EXCLUDED.scheduled_for
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

export const BATCH_SIZE = 100;
