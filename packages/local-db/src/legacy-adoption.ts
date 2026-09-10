import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";

import { openLocalDatabase } from "./database";
import {
  claimLocalDatabase,
  isSameLocalDatabasePartition,
  readLocalDatabaseOwner,
  readLocalTenantIdentity,
  type LocalDatabasePartition,
} from "./partitions";

export type LegacyAdoptionResult =
  | { adopted: true }
  | {
      adopted: false;
      reason:
        | "no-legacy-database"
        | "partition-already-exists"
        | "legacy-belongs-to-another-account"
        | "legacy-identity-unknown";
    };

/**
 * Move a pre-partition database into its owner's partition, once.
 *
 * Before partitioning there was one database for the whole machine. After it,
 * a packaged build only ever opens `local-partitions/<key>/`, so an upgrade
 * would leave that file — and any calibration work queued in its outbox —
 * orphaned on disk forever.
 *
 * Adoption is deliberately conditional on the legacy database's *own* record
 * of whose it is. Handing it to whoever signs in first would recreate exactly
 * the cross-account exposure partitioning exists to close, so a mismatch
 * leaves the file untouched rather than guessing. A database that was never
 * bootstrapped names nobody, and is likewise left alone.
 *
 * The move takes the SQLite sidecars with it: `-wal` holds committed
 * transactions not yet checkpointed into the main file, so moving without it
 * silently discards the most recent writes — the ones most likely to be the
 * unsynced work this exists to preserve.
 */
export function adoptLegacyLocalDatabase({
  legacyPath,
  partitionPath,
  partition,
}: {
  legacyPath: string;
  partitionPath: string;
  partition: LocalDatabasePartition;
}): LegacyAdoptionResult {
  if (existsSync(partitionPath)) {
    return { adopted: false, reason: "partition-already-exists" };
  }

  if (!existsSync(legacyPath)) {
    return { adopted: false, reason: "no-legacy-database" };
  }

  const legacy = openLocalDatabase({ filePath: legacyPath });
  const owner = readLocalDatabaseOwner(legacy);
  const identity = owner ?? readLocalTenantIdentity(legacy);
  legacy.close();

  if (!identity) {
    return { adopted: false, reason: "legacy-identity-unknown" };
  }

  if (!isSameLocalDatabasePartition(identity, partition)) {
    return { adopted: false, reason: "legacy-belongs-to-another-account" };
  }

  mkdirSync(path.dirname(partitionPath), { recursive: true });

  for (const suffix of ["", "-wal", "-shm"]) {
    const from = `${legacyPath}${suffix}`;
    if (existsSync(from)) renameSync(from, `${partitionPath}${suffix}`);
  }

  const adopted = openLocalDatabase({ filePath: partitionPath });
  claimLocalDatabase(adopted, partition);
  adopted.close();

  return { adopted: true };
}
