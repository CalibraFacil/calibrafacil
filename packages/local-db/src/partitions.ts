import { createHash } from "node:crypto";
import type { LocalDatabasePartition } from "@calibra-facil/contracts";

import type { LocalDatabase } from "./database";

export type { LocalDatabasePartition };

/**
 * Which account and organization a local database belongs to.
 *
 * The desktop keeps **one file per (account, organization)** rather than one
 * per organization. Two accounts can belong to the same organization with
 * different permissions, so an organization-only partition would still let the
 * second account read everything the first had downloaded.
 *
 * The path is not the security boundary. A file is readable by anyone with
 * enough operating-system access, and choosing the wrong path is an ordinary
 * bug. What actually enforces isolation is `assertLocalDatabaseOwner`: the
 * database records who it belongs to, and the manager verifies that before
 * serving a single read.
 */
export type LocalDatabaseOwner = LocalDatabasePartition & {
  claimedAt: string;
};

export class LocalDatabaseOwnershipError extends Error {
  constructor(
    readonly expected: LocalDatabasePartition,
    readonly actual: LocalDatabaseOwner | null,
  ) {
    super(
      actual
        ? `Local database belongs to another account or organization (esperado ${expected.userId}/${expected.organizationId}, encontrado ${actual.userId}/${actual.organizationId}).`
        : "Local database has no ownership record and is not empty.",
    );
    this.name = "LocalDatabaseOwnershipError";
  }
}

/**
 * A stable directory name for a partition.
 *
 * Hashed rather than composed from the ids: a user id and an organization id
 * on disk would put account identifiers in filesystem paths, backups and crash
 * reports for no benefit. The hash is not a secret — it is a deterministic
 * name, and ownership is enforced inside the database, not by the path.
 */
export function localDatabasePartitionKey(
  partition: LocalDatabasePartition,
): string {
  const normalized = `${partition.userId}\u0000${partition.organizationId}`;

  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

/**
 * The database file for a partition, under `root`.
 *
 * Callers pass the *root* rather than a file path so a partition can never be
 * asked to share a file with another: the leaf name is derived, not supplied.
 */
export function localDatabasePartitionPath(
  root: string,
  partition: LocalDatabasePartition,
): string {
  return `${root}/${localDatabasePartitionKey(partition)}/calibra.sqlite`;
}

export function isSameLocalDatabasePartition(
  a: LocalDatabasePartition | null,
  b: LocalDatabasePartition | null,
): boolean {
  if (!a || !b) return false;

  return a.userId === b.userId && a.organizationId === b.organizationId;
}

export function readLocalDatabaseOwner(
  database: LocalDatabase,
): LocalDatabaseOwner | null {
  const row = database
    .prepare<
      [],
      { user_id: string; organization_id: string; claimed_at: string }
    >("SELECT user_id, organization_id, claimed_at FROM local_database_owner WHERE id = 1")
    .get();

  if (!row) return null;

  return {
    userId: row.user_id,
    organizationId: row.organization_id,
    claimedAt: row.claimed_at,
  };
}

/**
 * Claim an *unowned* database for a partition. Never overwrites an existing
 * claim: re-pointing a populated file at a different account is precisely the
 * mistake this table exists to catch, so it fails instead.
 */
export function claimLocalDatabase(
  database: LocalDatabase,
  partition: LocalDatabasePartition,
  claimedAt = new Date().toISOString(),
): LocalDatabaseOwner {
  const existing = readLocalDatabaseOwner(database);

  if (existing) {
    if (!isSameLocalDatabasePartition(existing, partition)) {
      throw new LocalDatabaseOwnershipError(partition, existing);
    }

    return existing;
  }

  database
    .prepare(
      `
INSERT INTO local_database_owner (id, user_id, organization_id, claimed_at)
VALUES (1, @userId, @organizationId, @claimedAt)
`,
    )
    .run({ ...partition, claimedAt });

  return { ...partition, claimedAt };
}

/**
 * Tables whose contents would be another account's data. Used only to decide
 * whether an unclaimed database is safe to adopt — a fresh file with no rows
 * can be claimed, a populated one cannot.
 *
 * Deliberately not exhaustive over every table: it lists the domain records
 * that carry customer and calibration data, which is what makes adoption
 * unsafe. Device-local tables (printer profiles, schema bookkeeping) do not.
 */
const DOMAIN_TABLES = [
  "calibration_jobs",
  "customers",
  "assets",
  "service_orders",
  "non_conformances",
  "attachments",
  "certificate_drafts",
  "reference_standards",
  "tenant_snapshot",
  // Queued field work. Listed explicitly because it is the one thing that
  // must never be adopted by, or uploaded under, another account.
  "outbox",
] as const;

export function localDatabaseHasDomainRows(database: LocalDatabase): boolean {
  for (const table of DOMAIN_TABLES) {
    const exists = database
      .prepare<
        [string],
        { name: string }
      >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);

    // A renamed or mistyped table would otherwise be skipped in silence,
    // quietly weakening the very check that stops one account's data being
    // adopted by another. Refusing to answer beats answering "safe" on
    // incomplete evidence.
    if (!exists) {
      throw new Error(
        `Local database is missing the expected table "${table}"; ownership safety cannot be evaluated.`,
      );
    }

    const row = database
      .prepare<[], { total: number }>(`SELECT COUNT(*) AS total FROM ${table}`)
      .get();

    if ((row?.total ?? 0) > 0) return true;
  }

  return false;
}

/**
 * The check the database manager runs before serving anything.
 *
 * Three outcomes:
 * - claimed by this partition → proceed;
 * - claimed by another → refuse, loudly;
 * - unclaimed → adopt it only when it holds no domain rows, so a database
 *   created before ownership tracking existed is never silently handed to
 *   whoever opens it next.
 */
export function assertLocalDatabaseOwner(
  database: LocalDatabase,
  partition: LocalDatabasePartition,
): LocalDatabaseOwner {
  const owner = readLocalDatabaseOwner(database);

  if (owner) {
    if (!isSameLocalDatabasePartition(owner, partition)) {
      throw new LocalDatabaseOwnershipError(partition, owner);
    }

    return owner;
  }

  if (localDatabaseHasDomainRows(database)) {
    throw new LocalDatabaseOwnershipError(partition, null);
  }

  return claimLocalDatabase(database, partition);
}

/**
 * The account and organization a database's own bootstrap snapshot says it
 * belongs to. `null` when it was never bootstrapped.
 */
export function readLocalTenantIdentity(
  database: LocalDatabase,
): LocalDatabasePartition | null {
  const row = database
    .prepare<[], { organization_id: string; user_id: string }>(
      `
SELECT organization_id, user_id
FROM tenant_snapshot
ORDER BY pulled_at DESC
LIMIT 1
`,
    )
    .get();

  if (!row?.user_id || !row.organization_id) return null;

  return { userId: row.user_id, organizationId: row.organization_id };
}
