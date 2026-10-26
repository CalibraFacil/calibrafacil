/**
 * Verification of the audit-trail hash chain (roadmap 2 B1; ISO/IEC 17025 8.4
 * control of records, 7.5.2 amendment of records).
 *
 * `job_audit_log` carries a per-organization hash chain (migration 0131): every
 * row's `row_hash` is the sha256 of its predecessor's hash and its own immutable
 * content, assigned by a BEFORE INSERT trigger. Revoking UPDATE/DELETE from the
 * application role (migration 0130) stops the application from rewriting history;
 * the chain makes a rewrite by anyone else (the table owner, a restored backup)
 * DETECTABLE. This module recomputes the chain of every laboratory (the SQL
 * functions `calibra_audit_chain_verify` / `_head` / `_link_hash` do the work, so
 * there is one implementation of the canonical row text) and reports the first
 * break per laboratory.
 *
 * Three things it catches that the chain alone cannot show:
 *   - a TAIL deletion: each intact run records a checkpoint (the head it saw) in
 *     `platform_event_log`; the next run fails `checkpoint_missing` when that link
 *     is gone and `checkpoint_mismatch` when it changed. The checkpoint event is
 *     also the hook for the external timestamp of the head (roadmap 2 B4: an ACT
 *     timestamp over `headHash`), which would additionally defeat a rewrite of the
 *     whole chain by the owner.
 *   - a row that never got a link (`unchained_row`: the trigger was bypassed).
 *   - a break reported once is not announced again every day: the fingerprint of the
 *     break is stored on the platform event, and a run that finds the same break only
 *     lists it in its result (so the cron keeps failing until a human resolves it).
 *
 * Cross-laboratory by design (a platform integrity job, like certificate-drift): it
 * runs on the system path (`systemDb`), reads through the SQL functions, and writes
 * the finding to the laboratory's own event log in a transaction that names it.
 * It repairs nothing: evidence is preserved as found.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { systemDb } from "@calibra-facil/db";
import { platformEventLog } from "@calibra-facil/db/schema";
import { notifyAuditChainBroken } from "@calibra-facil/notifications";

import { writeOrganizationAuditEvent } from "./audit";
import { getExecuteRows } from "./db";
import { orgDb } from "./org-db";

/** The tables that carry a chain (the SQL function `calibra_audit_chain_columns`). */
const CHAINED_AUDIT_TABLES = ["job_audit_log"] as const;
type ChainedAuditTable = (typeof CHAINED_AUDIT_TABLES)[number];

export const CHAIN_CHECKPOINT_ACTION = "audit.chain.verified";
export const CHAIN_BROKEN_PLATFORM_ACTION = "audit.chain.broken";
export const CHAIN_BROKEN_ORGANIZATION_ACTION = "audit.chain_broken";
const CHAIN_ENTITY_TYPE = "audit_chain";

type AuditChainBreakKind =
  | "sequence_gap"
  | "prev_hash_mismatch"
  | "row_hash_mismatch"
  | "unchained_row"
  | "checkpoint_missing"
  | "checkpoint_mismatch";

type AuditChainBreak = {
  table: ChainedAuditTable;
  organizationId: string;
  kind: AuditChainBreakKind;
  /** Position in the organization's chain; null for an unchained row. */
  chainSeq: number | null;
  /** The row to look at (for a gap: the first row after the hole). */
  rowId: number | null;
  expectedHash: string | null;
  actualHash: string | null;
};

export type AuditChainReport = {
  /** Chains recomputed (one per organization and table). */
  chains: number;
  /** Links recomputed. */
  links: number;
  intact: number;
  /** Every break found, including ones announced by an earlier run. */
  broken: AuditChainBreak[];
  /** The breaks announced by THIS run (platform event, organization event, notification). */
  announced: AuditChainBreak[];
  /** Checkpoints recorded by this run. */
  checkpoints: number;
  /** Announcements that could not be written (the break is still in `broken`). */
  failures: Array<{ organizationId: string; error: unknown }>;
};

/** Thrown at the end of a run that found a break, carrying what it found. */
export class AuditChainBrokenError extends Error {
  constructor(readonly report: AuditChainReport) {
    super(
      `audit chain: ${report.broken.length} broken chain(s): ${report.broken
        .map(
          (found) =>
            `${found.table}/${found.organizationId} ${found.kind}${found.chainSeq === null ? "" : ` at ${found.chainSeq}`}`,
        )
        .join("; ")}`,
    );
    this.name = "AuditChainBrokenError";
  }
}

const BREAK_KINDS: readonly AuditChainBreakKind[] = [
  "sequence_gap",
  "prev_hash_mismatch",
  "row_hash_mismatch",
  "unchained_row",
  "checkpoint_missing",
  "checkpoint_mismatch",
];

function isBreakKind(value: unknown): value is AuditChainBreakKind {
  return BREAK_KINDS.some((kind) => kind === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

type Executor = Pick<typeof systemDb, "execute">;

/** The first break of one chain according to the SQL function, null when intact. */
async function firstBreakOf(
  executor: Executor,
  table: ChainedAuditTable,
  organizationId: string,
): Promise<AuditChainBreak | null> {
  const rows = getExecuteRows<unknown>(
    await executor.execute(sql`
      select out_row_id::text as row_id,
             out_chain_seq::text as chain_seq,
             out_kind as kind,
             encode(out_expected, 'hex') as expected,
             encode(out_actual, 'hex') as actual
        from calibra_audit_chain_verify(${table}, ${organizationId})`),
  );
  const [row] = rows;
  if (!isRecord(row) || !isBreakKind(row.kind)) return null;
  return {
    table,
    organizationId,
    kind: row.kind,
    chainSeq: numberOrNull(row.chain_seq),
    rowId: numberOrNull(row.row_id),
    expectedHash: stringOrNull(row.expected),
    actualHash: stringOrNull(row.actual),
  };
}

type Head = { chainSeq: number; rowHash: string; links: number };

async function headOf(
  executor: Executor,
  table: ChainedAuditTable,
  organizationId: string,
): Promise<Head | null> {
  const rows = getExecuteRows<unknown>(
    await executor.execute(sql`
      select out_chain_seq::text as chain_seq,
             encode(out_row_hash, 'hex') as row_hash,
             out_links::text as links
        from calibra_audit_chain_head(${table}, ${organizationId})`),
  );
  const [row] = rows;
  if (!isRecord(row)) return null;
  const chainSeq = numberOrNull(row.chain_seq);
  const rowHash = stringOrNull(row.row_hash);
  const links = numberOrNull(row.links);
  if (chainSeq === null || rowHash === null || links === null) return null;
  return { chainSeq, rowHash, links };
}

async function linkHashOf(
  executor: Executor,
  table: ChainedAuditTable,
  organizationId: string,
  chainSeq: number,
): Promise<string | null> {
  const rows = getExecuteRows<unknown>(
    await executor.execute(sql`
      select encode(calibra_audit_chain_link_hash(${table}, ${organizationId}, ${chainSeq}), 'hex') as row_hash`),
  );
  const [row] = rows;
  return isRecord(row) ? stringOrNull(row.row_hash) : null;
}

function entityIdOf(table: ChainedAuditTable, organizationId: string): string {
  return `${table}:${organizationId}`;
}

/** The newest checkpoint a previous intact run recorded for this chain. */
async function lastCheckpoint(
  table: ChainedAuditTable,
  organizationId: string,
): Promise<{ headSeq: number; headHash: string } | null> {
  const [event] = await systemDb
    .select({ details: platformEventLog.details })
    .from(platformEventLog)
    .where(
      and(
        eq(platformEventLog.action, CHAIN_CHECKPOINT_ACTION),
        eq(platformEventLog.entityType, CHAIN_ENTITY_TYPE),
        eq(platformEventLog.entityId, entityIdOf(table, organizationId)),
      ),
    )
    .orderBy(desc(platformEventLog.id))
    .limit(1);
  const details = event?.details;
  if (!isRecord(details)) return null;
  const headSeq = numberOrNull(details.headSeq);
  const headHash = stringOrNull(details.headHash);
  return headSeq === null || headHash === null ? null : { headSeq, headHash };
}

function fingerprintOf(found: AuditChainBreak): string {
  return [
    found.table,
    found.organizationId,
    found.kind,
    found.chainSeq ?? "-",
    found.actualHash ?? "-",
  ].join("|");
}

async function alreadyAnnounced(found: AuditChainBreak): Promise<boolean> {
  const [event] = await systemDb
    .select({ id: platformEventLog.id })
    .from(platformEventLog)
    .where(
      and(
        eq(platformEventLog.action, CHAIN_BROKEN_PLATFORM_ACTION),
        eq(platformEventLog.entityType, CHAIN_ENTITY_TYPE),
        eq(
          platformEventLog.entityId,
          entityIdOf(found.table, found.organizationId),
        ),
        sql`${platformEventLog.details} ->> 'fingerprint' = ${fingerprintOf(found)}`,
      ),
    )
    .limit(1);
  return event !== undefined;
}

/**
 * Records a break: the platform event (survives the organization, carries the
 * fingerprint that keeps the next run quiet), the organization's own event log
 * entry (written in a transaction that names it) and the notification to its
 * admins and owners.
 */
async function announce(found: AuditChainBreak): Promise<void> {
  const details = {
    table: found.table,
    kind: found.kind,
    chainSeq: found.chainSeq,
    rowId: found.rowId,
    expectedHash: found.expectedHash,
    actualHash: found.actualHash,
  };
  await systemDb.insert(platformEventLog).values({
    actorUserId: null,
    targetUserId: null,
    action: CHAIN_BROKEN_PLATFORM_ACTION,
    entityType: CHAIN_ENTITY_TYPE,
    entityId: entityIdOf(found.table, found.organizationId),
    details: { ...details, fingerprint: fingerprintOf(found) },
  });
  await orgDb(found.organizationId).transaction((tx) =>
    writeOrganizationAuditEvent(
      {
        organizationId: found.organizationId,
        action: CHAIN_BROKEN_ORGANIZATION_ACTION,
        entityType: CHAIN_ENTITY_TYPE,
        entityId: found.rowId === null ? null : String(found.rowId),
        details,
      },
      tx,
    ),
  );
  await notifyAuditChainBroken(found.organizationId, {
    table: found.table,
    kind: found.kind,
    chainSeq: found.chainSeq,
    rowId: found.rowId,
  });
}

/** Laboratories to verify: the one asked for, else every organization that holds rows. */
async function organizationsToVerify(
  table: ChainedAuditTable,
  organizationId: string | undefined,
): Promise<string[]> {
  if (organizationId !== undefined) return [organizationId];
  const rows = getExecuteRows<unknown>(
    await systemDb.execute(sql`
      select o.id as id
        from organization o
       where exists (
         select 1 from ${sql.identifier(table)} t where t.organization_id = o.id)
          -- a laboratory whose rows ALL vanished still has its checkpoint to answer for
          or exists (
         select 1 from platform_event_log p
          where p.action = ${CHAIN_CHECKPOINT_ACTION}
            and p.entity_type = ${CHAIN_ENTITY_TYPE}
            and p.entity_id = ${table} || ':' || o.id)
       order by o.id`),
  );
  return rows.flatMap((row) =>
    isRecord(row) && typeof row.id === "string" ? [row.id] : [],
  );
}

export type VerifyAuditChainsOptions = {
  /** Verify this laboratory only. */
  organizationId?: string;
  /**
   * Record what the run finds: a checkpoint for an intact chain, the platform
   * event + organization event + notification for a break. The cron records; the
   * on-demand CLI does not unless asked.
   */
  record: boolean;
};

/**
 * Recomputes the chains. Never throws for a break (it returns them): the caller
 * decides, so one laboratory's break never hides another's.
 */
export async function verifyAuditChains(
  options: VerifyAuditChainsOptions,
): Promise<AuditChainReport> {
  const report: AuditChainReport = {
    chains: 0,
    links: 0,
    intact: 0,
    broken: [],
    announced: [],
    checkpoints: 0,
    failures: [],
  };

  for (const table of CHAINED_AUDIT_TABLES) {
    const organizations = await organizationsToVerify(
      table,
      options.organizationId,
    );
    for (const organizationId of organizations) {
      report.chains += 1;
      let found = await firstBreakOf(systemDb, table, organizationId);
      const head = await headOf(systemDb, table, organizationId);
      report.links += head?.links ?? 0;

      if (found === null) {
        const checkpoint = await lastCheckpoint(table, organizationId);
        if (checkpoint !== null) {
          if (head === null || head.chainSeq < checkpoint.headSeq) {
            found = {
              table,
              organizationId,
              kind: "checkpoint_missing",
              chainSeq: checkpoint.headSeq,
              rowId: null,
              expectedHash: checkpoint.headHash,
              actualHash: null,
            };
          } else {
            const now = await linkHashOf(
              systemDb,
              table,
              organizationId,
              checkpoint.headSeq,
            );
            if (now !== checkpoint.headHash) {
              found = {
                table,
                organizationId,
                kind: "checkpoint_mismatch",
                chainSeq: checkpoint.headSeq,
                rowId: null,
                expectedHash: checkpoint.headHash,
                actualHash: now,
              };
            }
          }
        }
        if (found === null) {
          report.intact += 1;
          if (
            options.record &&
            head !== null &&
            head.chainSeq !== checkpoint?.headSeq
          ) {
            await systemDb.insert(platformEventLog).values({
              actorUserId: null,
              targetUserId: null,
              action: CHAIN_CHECKPOINT_ACTION,
              entityType: CHAIN_ENTITY_TYPE,
              entityId: entityIdOf(table, organizationId),
              details: {
                table,
                organizationId,
                headSeq: head.chainSeq,
                headHash: head.rowHash,
                links: head.links,
              },
            });
            report.checkpoints += 1;
          }
          continue;
        }
      }

      report.broken.push(found);
      if (!options.record) continue;
      try {
        if (await alreadyAnnounced(found)) continue;
        await announce(found);
        report.announced.push(found);
      } catch (error) {
        report.failures.push({ organizationId, error });
        console.error(
          `[audit-chain] could not announce the break of ${table}/${organizationId}`,
          error,
        );
      }
    }
  }

  console.log(
    `[audit-chain] chains=${report.chains} links=${report.links} intact=${report.intact} broken=${report.broken.length} announced=${report.announced.length}`,
  );
  return report;
}

/**
 * The cron entry point: verifies and records every laboratory, then fails the run
 * (so the `cron_run` heartbeat shows it and the trigger sees a non-2xx) when any
 * chain is broken. The report travels on the error.
 */
export async function runAuditChainVerification(): Promise<AuditChainReport> {
  const report = await verifyAuditChains({ record: true });
  if (report.broken.length > 0) throw new AuditChainBrokenError(report);
  return report;
}
