import { db } from "@calibra-facil/db";
import {
  integrationObjectLink,
  integrationSyncRun,
} from "@calibra-facil/db/schema";
import {
  type IntegrationObjectLinkTarget,
  type IntegrationSyncTarget,
} from "@calibra-facil/shared";
import { and, desc, eq, inArray } from "drizzle-orm";

export async function hasActiveSyncRun(params: {
  integrationId: string;
  organizationId: string;
  target: IntegrationSyncTarget;
}) {
  const existing = await db.query.integrationSyncRun.findFirst({
    where: and(
      eq(integrationSyncRun.integrationId, params.integrationId),
      eq(integrationSyncRun.organizationId, params.organizationId),
      eq(integrationSyncRun.target, params.target),
      inArray(integrationSyncRun.status, ["PENDING", "RUNNING"]),
    ),
    orderBy: [desc(integrationSyncRun.createdAt)],
  });

  return existing;
}

export async function getExistingLink(
  integrationId: string,
  target: IntegrationObjectLinkTarget,
  localEntityId: string,
) {
  return db.query.integrationObjectLink.findFirst({
    where: and(
      eq(integrationObjectLink.integrationId, integrationId),
      eq(integrationObjectLink.target, target),
      eq(integrationObjectLink.localEntityId, localEntityId),
    ),
  });
}

export async function upsertLink(params: {
  integrationId: string;
  organizationId: string;
  target: IntegrationObjectLinkTarget;
  localEntityId: string;
  remoteEntityId: string | null;
  remoteDisplayId?: string | null;
  remoteEntityType?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const existing = await getExistingLink(
    params.integrationId,
    params.target,
    params.localEntityId,
  );

  if (existing) {
    await db
      .update(integrationObjectLink)
      .set({
        remoteEntityId: params.remoteEntityId,
        remoteDisplayId: params.remoteDisplayId ?? params.remoteEntityId,
        remoteEntityType: params.remoteEntityType ?? null,
        metadata: params.metadata ?? null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(integrationObjectLink.id, existing.id));
    return;
  }

  await db.insert(integrationObjectLink).values({
    id: crypto.randomUUID(),
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    target: params.target,
    localEntityId: params.localEntityId,
    remoteEntityId: params.remoteEntityId,
    remoteDisplayId: params.remoteDisplayId ?? params.remoteEntityId,
    remoteEntityType: params.remoteEntityType ?? null,
    metadata: params.metadata ?? null,
    lastSyncedAt: new Date(),
  });
}
