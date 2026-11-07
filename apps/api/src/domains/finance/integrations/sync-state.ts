import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  integrationObjectLink,
  integrationSyncRun,
} from "@calibra-facil/db/schema";
import {
  type IntegrationObjectLinkTarget,
  type IntegrationSyncTarget,
} from "@calibra-facil/shared";
import { and, desc, eq, inArray } from "drizzle-orm";

// Every function here runs in the caller's org-bound transaction (`executor`)
// or in one of its own that names the laboratory (row-level security).

export async function hasActiveSyncRun(
  params: {
    integrationId: string;
    organizationId: string;
    target: IntegrationSyncTarget;
  },
  executor: OrgDb,
) {
  const [existing] = await executor
    .select()
    .from(integrationSyncRun)
    .where(
      and(
        eq(integrationSyncRun.integrationId, params.integrationId),
        eq(integrationSyncRun.organizationId, params.organizationId),
        eq(integrationSyncRun.target, params.target),
        inArray(integrationSyncRun.status, ["PENDING", "RUNNING"]),
      ),
    )
    .orderBy(desc(integrationSyncRun.createdAt))
    .limit(1);

  return existing;
}

export async function getExistingLink(
  organizationId: string,
  integrationId: string,
  target: IntegrationObjectLinkTarget,
  localEntityId: string,
  executor: OrgDb,
) {
  const [link] = await executor
    .select()
    .from(integrationObjectLink)
    .where(
      and(
        eq(integrationObjectLink.integrationId, integrationId),
        eq(integrationObjectLink.target, target),
        eq(integrationObjectLink.localEntityId, localEntityId),
      ),
    )
    .limit(1);
  return link;
}

export async function upsertLink(
  params: {
    integrationId: string;
    organizationId: string;
    target: IntegrationObjectLinkTarget;
    localEntityId: string;
    remoteEntityId: string | null;
    remoteDisplayId?: string | null;
    remoteEntityType?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  executor: OrgDb,
) {
  const existing = await getExistingLink(
    params.organizationId,
    params.integrationId,
    params.target,
    params.localEntityId,
    executor,
  );
  if (existing) {
    await executor
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
  await executor.insert(integrationObjectLink).values({
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
