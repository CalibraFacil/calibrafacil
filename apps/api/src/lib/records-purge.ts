import { readRetentionConfig } from "@calibra-facil/config";
/**
 * Records purge (decision Q16, docs/architecture/records-retention.md).
 *
 * Hard-deletes a LAB organization, with everything it owns, only when ALL of:
 *   - it is soft-deleted (`organization.deleted_at`);
 *   - it is not under legal hold (`organization.legal_hold`);
 *   - its newest evidence (and its own deletion) is older than its
 *     `retention_years`: `calibra_retain_until(org, newest) <= now`.
 *
 * Off unless `RECORDS_PURGE_ENABLED=true`, and even when enabled it only LOGS
 * what it would purge (dry run) unless `RECORDS_PURGE_MODE=execute`. Before it
 * deletes anything it writes a `records.purge.started` row to
 * `platform_event_log` (append-only, platform-level, survives the purge), and a
 * `completed` / `failed` row afterwards.
 *
 * Cross-tenant by design (a platform maintenance job, like certificate-drift),
 * so it appears in test/integration/tenant-sql-allowlist.ts.
 */
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { platformEventLog } from "@calibra-facil/db/schema";
import {
  PLATFORM_EVIDENCE_TABLES,
  listEvidenceTables,
  organizationErasureOrder,
  organizationScopeSql,
  recordDateColumns,
} from "@calibra-facil/db/records-retention";
import { getExecuteRows } from "./db";

export type PurgeMode = "dry-run" | "execute";

export type PurgeConfig = { enabled: boolean; mode: PurgeMode };

/** Disabled and dry-run unless the environment says otherwise, exactly. */
export function readPurgeConfig(
  env?: Record<string, string | undefined>,
): PurgeConfig {
  const { purgeEnabled, purgeMode } = readRetentionConfig(env);
  return { enabled: purgeEnabled, mode: purgeMode };
}

export type PurgeDecision = {
  organizationId: string;
  slug: string;
  deletedAt: Date;
  retentionYears: number;
  legalHold: boolean;
  newestEvidenceAt: Date | null;
  retainUntil: Date | null;
  verdict: "eligible" | "legal_hold" | "in_retention";
};

type Executor = Pick<
  Parameters<Parameters<typeof db.transaction>[0]>[0],
  "execute"
>;

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

/**
 * The schema stores UTC wall-clock `timestamp` columns and raw `db.execute`
 * rows carry them as `2020-06-01 00:00:00` strings, which `new Date()` would
 * read as LOCAL time: pin them to UTC unless they name an offset.
 */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value !== "string") return null;
  const iso = value.trim().replace(" ", "T");
  const hasOffset = /T.*(Z|[+-]\d{2}(:?\d{2})?)$/.test(iso);
  const parsed = new Date(hasOffset ? iso : `${iso}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Newest record date over every evidence table of the organization (its own
 * soft delete counts as a record). Timestamps are compared as `timestamp`
 * (the schema stores UTC wall-clock time).
 */
async function newestEvidenceAt(
  executor: Executor,
  organizationId: string,
): Promise<Date | null> {
  const probes = listEvidenceTables()
    .filter((table) => !PLATFORM_EVIDENCE_TABLES.includes(table))
    .flatMap((table) => {
      const scope = organizationScopeSql(table, organizationId);
      const columns = recordDateColumns(table);
      if (!scope || columns.length === 0 || !IDENTIFIER.test(table)) return [];
      const newest = sql.join(
        columns.map((column) => sql`${sql.identifier(column)}::timestamp`),
        sql`, `,
      );
      return [
        sql`SELECT max(greatest(${newest})) AS newest FROM ${sql.identifier(table)} WHERE ${scope}`,
      ];
    });
  if (probes.length === 0) return null;
  const rows = getExecuteRows<{ newest: unknown }>(
    await executor.execute(
      sql`SELECT max(newest) AS newest FROM (${sql.join(probes, sql` UNION ALL `)}) AS evidence`,
    ),
  );
  return toDate(rows[0]?.newest);
}

/**
 * Every soft-deleted LAB organization with the verdict the purge would reach
 * at `now`. Pure read; the dry run and the execute mode share it.
 */
export async function evaluatePurgeCandidates(
  now: Date = new Date(),
  executor: Executor = db,
  onlyOrganizationId: string | null = null,
): Promise<PurgeDecision[]> {
  const organizations = getExecuteRows<{
    id: string;
    slug: string;
    deleted_at: unknown;
    retention_years: number;
    legal_hold: boolean;
  }>(
    await executor.execute(sql`
      SELECT id, slug, deleted_at, retention_years, legal_hold
        FROM organization
       WHERE deleted_at IS NOT NULL
         AND coalesce(type, 'LAB') = 'LAB'
         AND (${onlyOrganizationId}::text IS NULL OR id = ${onlyOrganizationId})
       ORDER BY deleted_at, id`),
  );

  const decisions: PurgeDecision[] = [];
  for (const row of organizations) {
    const deletedAt = toDate(row.deleted_at);
    if (!deletedAt) continue;
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose: ordered deletes in one transaction, one organization at a time
    const evidenceAt = await newestEvidenceAt(executor, row.id);
    const newest =
      evidenceAt && evidenceAt.getTime() > deletedAt.getTime()
        ? evidenceAt
        : deletedAt;
    const [until] = getExecuteRows<{ retain_until: unknown }>(
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose: ordered deletes in one transaction, one organization at a time
      await executor.execute(
        sql`SELECT calibra_retain_until(${row.id}, ${newest.toISOString()}::timestamp) AS retain_until`,
      ),
    );
    const retainUntil = toDate(until?.retain_until);
    const inRetention =
      retainUntil === null || retainUntil.getTime() > now.getTime();
    decisions.push({
      organizationId: row.id,
      slug: row.slug,
      deletedAt,
      retentionYears: row.retention_years,
      legalHold: row.legal_hold,
      newestEvidenceAt: evidenceAt,
      retainUntil,
      verdict: row.legal_hold
        ? "legal_hold"
        : inRetention
          ? "in_retention"
          : "eligible",
    });
  }
  return decisions;
}

class PurgeSkipped extends Error {
  constructor(readonly reason: string) {
    super(`purge skipped: ${reason}`);
  }
}

type PurgeOutcome =
  | { organizationId: string; status: "would_purge" }
  | {
      organizationId: string;
      status: "purged";
      deletedRows: Record<string, number>;
    }
  | { organizationId: string; status: "skipped"; reason: string }
  | { organizationId: string; status: "failed"; message: string };

export type PurgeRunResult = {
  enabled: boolean;
  mode: PurgeMode;
  evaluated: number;
  eligible: string[];
  outcomes: PurgeOutcome[];
};

async function writePlatformEvent(
  action: string,
  organizationId: string,
  details: Record<string, unknown>,
) {
  await db.insert(platformEventLog).values({
    actorUserId: null,
    targetUserId: null,
    action,
    entityType: "organization",
    entityId: organizationId,
    details,
  });
}

function describeDecision(decision: PurgeDecision) {
  return {
    slug: decision.slug,
    deletedAt: decision.deletedAt.toISOString(),
    retentionYears: decision.retentionYears,
    newestEvidenceAt: decision.newestEvidenceAt?.toISOString() ?? null,
    retainUntil: decision.retainUntil?.toISOString() ?? null,
  };
}

/**
 * Deletes one eligible organization. The eligibility is checked again inside
 * the transaction, under a lock on the organization row, so a legal hold or a
 * restore that lands between the scan and the delete wins.
 */
async function executePurge(
  decision: PurgeDecision,
  now: Date,
): Promise<PurgeOutcome> {
  const organizationId = decision.organizationId;
  await writePlatformEvent("records.purge.started", organizationId, {
    ...describeDecision(decision),
    mode: "execute",
  });

  try {
    const deletedRows = await db.transaction(async (tx) => {
      // The two settings are transaction-local (set_config(..., true)): the
      // purge-only DELETE guard of organization, and the immutability triggers
      // of the evidence tables (calibra_history_rewrite_allowed, migration 0115).
      await tx.execute(
        sql`select set_config('calibra.allow_org_purge', 'on', true)`,
      );
      await tx.execute(
        sql`select set_config('calibra.allow_audit_rewrite', 'on', true)`,
      );

      await tx.execute(
        sql`SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`,
      );
      const [current] = await evaluatePurgeCandidates(now, tx, organizationId);
      if (current?.verdict !== "eligible") {
        throw new PurgeSkipped(current?.verdict ?? "restored");
      }

      // Client organizations of the laboratory's customers (portal logins).
      const clientOrganizations = getExecuteRows<{ id: string }>(
        await tx.execute(sql`
          SELECT DISTINCT auth_organization_id AS id
            FROM customer
           WHERE lab_organization_id = ${organizationId}
             AND auth_organization_id IS NOT NULL`),
      ).map((row) => row.id);

      const counts: Record<string, number> = {};
      for (const table of organizationErasureOrder()) {
        const scope = organizationScopeSql(table, organizationId);
        if (!scope || !IDENTIFIER.test(table)) continue;
        const [deleted] = getExecuteRows<{ n: number }>(
          // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose: ordered deletes in one transaction, one organization at a time
          await tx.execute(
            sql`WITH removed AS (DELETE FROM ${sql.identifier(table)} WHERE ${scope} RETURNING 1) SELECT count(*)::int AS n FROM removed`,
          ),
        );
        if (deleted && deleted.n > 0) counts[table] = deleted.n;
      }

      await tx.execute(
        sql`DELETE FROM organization WHERE id = ${organizationId} AND deleted_at IS NOT NULL AND NOT legal_hold`,
      );
      for (const clientId of clientOrganizations) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose: ordered deletes in one transaction, one organization at a time
        await tx.execute(sql`
          DELETE FROM organization o
           WHERE o.id = ${clientId}
             AND o.type = 'CLIENT'
             AND NOT EXISTS (
               SELECT 1 FROM customer c WHERE c.auth_organization_id = o.id)`);
      }
      return counts;
    });

    await writePlatformEvent("records.purge.completed", organizationId, {
      ...describeDecision(decision),
      deletedRows,
    });
    return { organizationId, status: "purged", deletedRows };
  } catch (error) {
    if (error instanceof PurgeSkipped) {
      await writePlatformEvent("records.purge.skipped", organizationId, {
        reason: error.reason,
      });
      return { organizationId, status: "skipped", reason: error.reason };
    }
    const message = error instanceof Error ? error.message : String(error);
    await writePlatformEvent("records.purge.failed", organizationId, {
      message,
    });
    return { organizationId, status: "failed", message };
  }
}

/**
 * The cron entry point. Returns immediately when disabled. In dry-run mode it
 * logs the organizations it WOULD purge and writes nothing.
 */
export async function runRecordsPurge(
  options: { config?: PurgeConfig; now?: Date } = {},
): Promise<PurgeRunResult> {
  const config = options.config ?? readPurgeConfig();
  const now = options.now ?? new Date();
  if (!config.enabled) {
    return {
      enabled: false,
      mode: config.mode,
      evaluated: 0,
      eligible: [],
      outcomes: [],
    };
  }

  const decisions = await evaluatePurgeCandidates(now);
  const eligible = decisions.filter((entry) => entry.verdict === "eligible");
  const outcomes: PurgeOutcome[] = [];

  for (const decision of eligible) {
    if (config.mode === "dry-run") {
      console.log(
        "[records-purge] dry run: would purge",
        JSON.stringify({
          organizationId: decision.organizationId,
          ...describeDecision(decision),
        }),
      );
      outcomes.push({
        organizationId: decision.organizationId,
        status: "would_purge",
      });
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose: ordered deletes in one transaction, one organization at a time
    outcomes.push(await executePurge(decision, now));
  }

  return {
    enabled: true,
    mode: config.mode,
    evaluated: decisions.length,
    eligible: eligible.map((entry) => entry.organizationId),
    outcomes,
  };
}
