/**
 * Retention of regulated records (decision Q16, docs/architecture/records-retention.md).
 *
 * A LAB organization that holds evidence is never hard-deleted: it is
 * soft-deleted (`organization.deleted_at`) and, in the same statement,
 * SUSPENDED, so the tenant-lifecycle gate in `requireOrganization` locks every
 * member out. Postgres refuses `DELETE FROM organization` for a LAB
 * organization (trigger `organization_lab_delete_guard`, migration 0117); the
 * only two callers allowed to lift that guard, for the length of one
 * transaction, are the records purge job (records-purge.ts) and the cleanup of
 * an organization that was created a moment ago and holds no record at all.
 * Both run on the owner connection (`systemDb`): Postgres honours the setting
 * for the table owner only (migration 0130), never for `calibra_app`.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { systemDb } from "@calibra-facil/db";
import {
  organization,
  organizationApiKey,
  organizationApiKeyAuditLog,
  organizationEventLog,
} from "@calibra-facil/db/schema";
import {
  PLATFORM_EVIDENCE_TABLES,
  listEvidenceTables,
  organizationScopeSql,
} from "@calibra-facil/db/records-retention";
import { getExecuteRows } from "./db";
import { orgDb } from "./org-db";

export const SOFT_DELETE_SUSPENSION_REASON =
  "Organização excluída: registros regulados retidos";

type Executor = Pick<typeof systemDb, "execute">;

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

/**
 * Evidence tables that hold at least one row of the LAB organization. One
 * round-trip: an EXISTS per evidence table, scoped by the organization
 * (directly, through its parent rows, or through the entity an audit log
 * documents).
 */
export async function evidenceTablesHoldingRecords(
  organizationId: string,
  // Default: the system path. The probe is one EXISTS per evidence table, each
  // already bound to the organization by `organizationScopeSql`; a caller that
  // holds its own transaction (removeLabOrganization) passes it.
  executor: Executor = systemDb,
): Promise<string[]> {
  const probes = listEvidenceTables()
    .filter((table) => !PLATFORM_EVIDENCE_TABLES.includes(table))
    .flatMap((table) => {
      const scope = organizationScopeSql(table, organizationId);
      if (!scope || !IDENTIFIER.test(table)) return [];
      return [
        sql`SELECT ${sql.raw(`'${table}'`)}::text AS table_name WHERE EXISTS (SELECT 1 FROM ${sql.identifier(table)} WHERE ${scope})`,
      ];
    });
  if (probes.length === 0) return [];
  const rows = getExecuteRows<{ table_name: string }>(
    await executor.execute(sql.join(probes, sql` UNION ALL `)),
  );
  // oxlint-disable-next-line unicorn/no-array-sort -- fresh array; the api build targets ES2022 (no toSorted)
  return rows.map((row) => row.table_name).sort();
}

export type SoftDeleteOutcome =
  | { status: "soft_deleted"; deletedAt: Date }
  | { status: "already_deleted" }
  | { status: "not_found" }
  | { status: "not_lab" };

/**
 * Soft-deletes a LAB organization: stamps `deleted_at/_by/_reason`, suspends it
 * (the CHECK `organization_soft_delete_suspended` requires it) and records an
 * organization event, all in one transaction. Idempotent.
 */
export async function softDeleteLabOrganization(input: {
  organizationId: string;
  deletedBy: string | null;
  reason: string;
  /** The member who asked for it, when a person did (kept on the event log). */
  actorMemberId?: string | null;
}): Promise<SoftDeleteOutcome> {
  // ONE transaction that names the laboratory: the stamp, the key revocations
  // and their audit rows commit together (row-level security binds the tenant
  // tables, `organization` is global).
  return orgDb(input.organizationId).transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(organization)
      .set({
        deletedAt: now,
        deletedBy: input.deletedBy,
        deletionReason: input.reason,
        status: "SUSPENDED",
        suspendedAt: sql`coalesce(${organization.suspendedAt}, ${now.toISOString()}::timestamp)`,
        suspensionReason: SOFT_DELETE_SUSPENSION_REASON,
      })
      .where(
        and(
          eq(organization.id, input.organizationId),
          or(eq(organization.type, "LAB"), isNull(organization.type)),
          isNull(organization.deletedAt),
        ),
      )
      .returning();

    if (updated) {
      // The laboratory's public-API keys die with it: the keys authenticate
      // straight to the organization id, with no session in between.
      const revokedKeys = await tx
        .update(organizationApiKey)
        .set({ revokedAt: now, revokedBy: input.deletedBy })
        .where(
          and(
            eq(organizationApiKey.organizationId, input.organizationId),
            isNull(organizationApiKey.revokedAt),
          ),
        )
        .returning();
      if (revokedKeys.length > 0) {
        await tx.insert(organizationApiKeyAuditLog).values(
          revokedKeys.map((key) => ({
            apiKeyId: key.id,
            organizationId: input.organizationId,
            action: "revoke",
            performedBy: input.deletedBy,
            details: { reason: "organization_soft_deleted" },
          })),
        );
      }

      await tx.insert(organizationEventLog).values({
        organizationId: input.organizationId,
        actorUserId: input.deletedBy,
        actorMemberId: input.actorMemberId ?? null,
        action: "organization.soft_deleted",
        entityType: "organization",
        entityId: input.organizationId,
        details: {
          reason: input.reason,
          revokedApiKeys: revokedKeys.length,
        },
      });
      return { status: "soft_deleted", deletedAt: now };
    }

    const [existing] = await tx
      .select({ type: organization.type })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .limit(1);
    if (!existing) return { status: "not_found" };
    if (existing.type !== null && existing.type !== "LAB") {
      return { status: "not_lab" };
    }
    return { status: "already_deleted" };
  });
}

export type RemoveLabOrganizationOutcome =
  | { status: "hard_deleted" }
  | { status: "soft_deleted"; recordTables: string[] }
  | { status: "already_deleted" }
  | { status: "not_found" }
  | { status: "not_lab" };

/**
 * Removes a LAB organization created a moment ago (a provisioning that failed
 * half way). When it provably holds no evidence the row is hard-deleted with
 * the purge-only setting; when it holds any, it is soft-deleted instead. The
 * proof and the delete share one transaction and the row lock taken by the
 * check, so a record cannot appear in between.
 */
export async function removeLabOrganization(input: {
  organizationId: string;
  deletedBy: string | null;
  reason: string;
}): Promise<RemoveLabOrganizationOutcome> {
  // The system path (the table owner), on purpose: the hard delete lifts the
  // guard of the `organization` row with `calibra.allow_org_purge`, which
  // Postgres honours for the table owner only (migration 0130; a calibra_app
  // session that sets it lifts nothing). The proof that the organization holds
  // no evidence and the delete share this one transaction and the row lock
  // taken by the check; every statement of it names the organization.
  const hardDeleted = await systemDb.transaction(async (tx) => {
    const [locked] = await tx
      .select({ type: organization.type })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .for("update");
    if (!locked) return { status: "not_found" } as const;
    if (locked.type !== null && locked.type !== "LAB") {
      return { status: "not_lab" } as const;
    }

    const recordTables = await evidenceTablesHoldingRecords(
      input.organizationId,
      tx,
    );
    if (recordTables.length > 0) {
      return { status: "has_records", recordTables } as const;
    }

    await tx.execute(
      sql`select set_config('calibra.allow_org_purge', 'on', true)`,
    );
    await tx
      .delete(organization)
      .where(eq(organization.id, input.organizationId));
    return { status: "hard_deleted" } as const;
  });

  if (hardDeleted.status !== "has_records") return hardDeleted;

  // Soft-deleting is always safe, so it can run after the check released its lock.
  const outcome = await softDeleteLabOrganization(input);
  return outcome.status === "soft_deleted"
    ? { status: "soft_deleted", recordTables: hardDeleted.recordTables }
    : outcome;
}
