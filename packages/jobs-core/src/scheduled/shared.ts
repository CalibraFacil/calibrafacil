import { Client } from "pg";
import { type ScheduledEnv } from "./types.js";

// Helper to run a database operation with a fresh connection
export async function withDbClient<T>(
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
 * Record that a scheduled notification was sent
 */
export async function recordScheduledNotification(
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
