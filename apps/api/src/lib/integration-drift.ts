import { db } from "@calibra-facil/db";
import {
  integrationObjectLink,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import type {
  IntegrationObjectLinkTarget,
  IntegrationProvider,
} from "@calibra-facil/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

export type IntegrationDriftStatus = "REMOTE_MISSING";

export interface IntegrationDriftRow {
  linkId: string;
  integrationId: string;
  providerLabel: string;
  target: IntegrationObjectLinkTarget;
  targetLabel: string;
  localEntityId: string;
  remoteEntityId: string | null;
  remoteDisplayId: string | null;
  driftStatus: IntegrationDriftStatus;
  driftCheckedAt: string | null;
  driftReason: string | null;
  lastSyncedAt: string | null;
}

const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  conta_azul: "Conta Azul",
  generic_http: "ERP (genérico)",
};

const TARGET_LABEL: Record<string, string> = {
  customer: "Cliente",
  catalog_item: "Catálogo",
  service: "Serviço",
  sale: "Venda",
  payable: "Conta a pagar",
  receivable_installment: "Parcela",
  fiscal_document: "Documento fiscal",
  remote_document: "Documento remoto",
};

function targetLabel(target: string): string {
  return TARGET_LABEL[target] ?? target;
}

function providerLabel(provider: IntegrationProvider): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

function isDriftMetadata(value: unknown): value is {
  status?: string;
  checkedAt?: string;
  reason?: string;
} {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

interface QueueRow {
  linkId: string;
  integrationId: string;
  provider: IntegrationProvider;
  target: string;
  localEntityId: string;
  remoteEntityId: string | null;
  remoteDisplayId: string | null;
  metadata: unknown;
  lastSyncedAt: Date | null;
}

function mapRow(row: QueueRow): IntegrationDriftRow | null {
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : null;
  const drift = isDriftMetadata(metadata?.drift) ? metadata.drift : null;
  if (drift?.status !== "remote_missing") return null;

  return {
    linkId: row.linkId,
    integrationId: row.integrationId,
    providerLabel: providerLabel(row.provider),
    target: row.target as IntegrationObjectLinkTarget,
    targetLabel: targetLabel(row.target),
    localEntityId: row.localEntityId,
    remoteEntityId: row.remoteEntityId,
    remoteDisplayId: row.remoteDisplayId,
    driftStatus: "REMOTE_MISSING",
    driftCheckedAt:
      typeof drift?.checkedAt === "string" ? drift.checkedAt : null,
    driftReason:
      typeof drift?.reason === "string" ? drift.reason : null,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
  };
}

export async function buildIntegrationDriftQueue(params: {
  organizationId: string;
  target?: IntegrationObjectLinkTarget;
  limit?: number;
}): Promise<IntegrationDriftRow[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 100, 500));

  const rows = await db
    .select({
      linkId: integrationObjectLink.id,
      integrationId: integrationObjectLink.integrationId,
      provider: organizationIntegration.provider,
      target: integrationObjectLink.target,
      localEntityId: integrationObjectLink.localEntityId,
      remoteEntityId: integrationObjectLink.remoteEntityId,
      remoteDisplayId: integrationObjectLink.remoteDisplayId,
      metadata: integrationObjectLink.metadata,
      lastSyncedAt: integrationObjectLink.lastSyncedAt,
    })
    .from(integrationObjectLink)
    .innerJoin(
      organizationIntegration,
      eq(
        organizationIntegration.id,
        integrationObjectLink.integrationId,
      ),
    )
    .where(
      and(
        eq(integrationObjectLink.organizationId, params.organizationId),
        isNull(integrationObjectLink.driftAcknowledgedAt),
        params.target
          ? eq(integrationObjectLink.target, params.target)
          : undefined,
        // Push the drift-status predicate to SQL so we don't ship every
        // non-drift link back to the application layer.
        sql`(${integrationObjectLink.metadata}->'drift'->>'status') = 'remote_missing'`,
      ),
    )
    .orderBy(desc(integrationObjectLink.lastSyncedAt))
    .limit(limit);

  return rows
    .map((row) => mapRow(row as QueueRow))
    .filter((row): row is IntegrationDriftRow => row !== null);
}

export async function acknowledgeIntegrationDrift(params: {
  organizationId: string;
  linkId: string;
  actorUserId: string;
  reason: string;
}): Promise<{ ok: boolean }> {
  const reason = params.reason?.trim?.() ?? "";
  if (!reason) return { ok: false };

  await db
    .update(integrationObjectLink)
    .set({
      driftAcknowledgedAt: new Date(),
      driftAcknowledgedByUserId: params.actorUserId,
      driftAcknowledgedReason: reason,
    })
    .where(
      and(
        eq(integrationObjectLink.id, params.linkId),
        eq(integrationObjectLink.organizationId, params.organizationId),
      ),
    );

  return { ok: true };
}

/**
 * Clear an acknowledgement (when an operator wants to bring the link back
 * into the drift queue). Not exposed as a route in slice 3; reserved for
 * future bulk-repair tooling.
 */
export async function resetIntegrationDriftAcknowledgement(params: {
  organizationId: string;
  linkId: string;
}): Promise<void> {
  await db
    .update(integrationObjectLink)
    .set({
      driftAcknowledgedAt: null,
      driftAcknowledgedByUserId: null,
      driftAcknowledgedReason: null,
    })
    .where(
      and(
        eq(integrationObjectLink.id, params.linkId),
        eq(integrationObjectLink.organizationId, params.organizationId),
      ),
    );
}
