import { db } from "@calibra-facil/db";
import { assetOotEvent } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import {
  recordAssetOotEvent,
  type AssetOotEventInput,
} from "../../src/lib/asset-oot-events";
import { orgDb } from "../../src/lib/org-db";

/**
 * Seed the out-of-tolerance event of an approved job the way an approval does
 * (the event and its `create` audit entry in one organization-bound
 * transaction), without the notification: that is a queue job now. Idempotent
 * per job, like the production write: a second call returns the existing event
 * with `created: false`.
 */
export async function seedAssetOotEvent(
  params: AssetOotEventInput,
): Promise<{ eventId: number; created: boolean }> {
  const written = await orgDb(params.labOrganizationId).transaction((o) =>
    recordAssetOotEvent(o, params),
  );
  if (written) return { eventId: written.eventId, created: true };

  const [existing] = await db
    .select({ id: assetOotEvent.id })
    .from(assetOotEvent)
    .where(eq(assetOotEvent.jobId, params.jobId));
  if (!existing) throw new Error("out-of-tolerance event vanished");
  return { eventId: existing.id, created: false };
}
