import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { openLocalDatabase } from "./database";
import { adoptLegacyLocalDatabase } from "./legacy-adoption";
import { claimLocalDatabase, readLocalDatabaseOwner } from "./partitions";

const tempDirectories: string[] = [];

function createRoot() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-legacy-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const ana = { userId: "user-ana", organizationId: "org-1" };
const bruno = { userId: "user-bruno", organizationId: "org-1" };

function seedLegacy(
  legacyPath: string,
  identity: { userId: string; organizationId: string } | null,
) {
  const database = openLocalDatabase({ filePath: legacyPath });

  if (identity) {
    database
      .prepare(
        `INSERT INTO tenant_snapshot (
           tenant_id, organization_id, active_unit_id, user_id,
           snapshot_json, pulled_at
         ) VALUES (
           @organizationId, @organizationId, 1, @userId,
           '{}', '2026-01-01T00:00:00.000Z'
         )`,
      )
      .run(identity);
  }

  // Queued work: the thing that must survive the upgrade.
  database
    .prepare(
      `INSERT INTO outbox (
         id, event_id, operation, payload_json, idempotency_key, status, created_at
       ) VALUES ('o-1', 'e-1', 'op', '{}', 'k-1', 'pending', '2026-01-01')`,
    )
    .run();
  database.close();
}

function pendingCount(filePath: string) {
  const database = openLocalDatabase({ filePath });
  const row = database
    .prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM outbox")
    .get();
  database.close();

  return row?.total ?? 0;
}

describe("adoptLegacyLocalDatabase", () => {
  it("moves the legacy database into its owner's partition", () => {
    // The upgrade case: work queued before partitioning existed must not be
    // orphaned on disk.
    const root = createRoot();
    const legacyPath = path.join(root, "local-data", "calibra.sqlite");
    const partitionPath = path.join(
      root,
      "partitions",
      "abc",
      "calibra.sqlite",
    );
    seedLegacy(legacyPath, ana);

    expect(
      adoptLegacyLocalDatabase({ legacyPath, partitionPath, partition: ana }),
    ).toEqual({ adopted: true });

    expect(existsSync(legacyPath)).toBe(false);
    expect(pendingCount(partitionPath)).toBe(1);
  });

  it("claims the adopted database for its owner", () => {
    const root = createRoot();
    const legacyPath = path.join(root, "local-data", "calibra.sqlite");
    const partitionPath = path.join(
      root,
      "partitions",
      "abc",
      "calibra.sqlite",
    );
    seedLegacy(legacyPath, ana);

    adoptLegacyLocalDatabase({ legacyPath, partitionPath, partition: ana });

    const database = openLocalDatabase({ filePath: partitionPath });
    expect(readLocalDatabaseOwner(database)).toMatchObject(ana);
    database.close();
  });

  it("leaves a legacy database belonging to another account alone", () => {
    // Handing it to whoever signs in first is precisely the exposure
    // partitioning exists to close.
    const root = createRoot();
    const legacyPath = path.join(root, "local-data", "calibra.sqlite");
    const partitionPath = path.join(
      root,
      "partitions",
      "abc",
      "calibra.sqlite",
    );
    seedLegacy(legacyPath, ana);

    expect(
      adoptLegacyLocalDatabase({ legacyPath, partitionPath, partition: bruno }),
    ).toEqual({
      adopted: false,
      reason: "legacy-belongs-to-another-account",
    });

    expect(existsSync(legacyPath)).toBe(true);
    expect(existsSync(partitionPath)).toBe(false);
  });

  it("leaves a database that names nobody alone", () => {
    // Never bootstrapped, so nothing says whose it is.
    const root = createRoot();
    const legacyPath = path.join(root, "local-data", "calibra.sqlite");
    const partitionPath = path.join(
      root,
      "partitions",
      "abc",
      "calibra.sqlite",
    );
    seedLegacy(legacyPath, null);

    expect(
      adoptLegacyLocalDatabase({ legacyPath, partitionPath, partition: ana }),
    ).toEqual({ adopted: false, reason: "legacy-identity-unknown" });

    expect(existsSync(legacyPath)).toBe(true);
  });

  it("never overwrites an existing partition", () => {
    const root = createRoot();
    const legacyPath = path.join(root, "local-data", "calibra.sqlite");
    const partitionPath = path.join(
      root,
      "partitions",
      "abc",
      "calibra.sqlite",
    );
    seedLegacy(legacyPath, ana);
    const existing = openLocalDatabase({ filePath: partitionPath });
    claimLocalDatabase(existing, ana);
    existing.close();

    expect(
      adoptLegacyLocalDatabase({ legacyPath, partitionPath, partition: ana }),
    ).toEqual({ adopted: false, reason: "partition-already-exists" });

    expect(existsSync(legacyPath)).toBe(true);
  });

  it("is a no-op when there is no legacy database", () => {
    const root = createRoot();

    expect(
      adoptLegacyLocalDatabase({
        legacyPath: path.join(root, "missing.sqlite"),
        partitionPath: path.join(root, "partitions", "abc", "calibra.sqlite"),
        partition: ana,
      }),
    ).toEqual({ adopted: false, reason: "no-legacy-database" });
  });

  it("prefers an explicit ownership claim over the tenant snapshot", () => {
    // A database already claimed by partitioning is authoritative about its
    // owner, whatever an older snapshot row says.
    const root = createRoot();
    const legacyPath = path.join(root, "local-data", "calibra.sqlite");
    const partitionPath = path.join(
      root,
      "partitions",
      "abc",
      "calibra.sqlite",
    );
    seedLegacy(legacyPath, ana);
    const claimed = openLocalDatabase({ filePath: legacyPath });
    claimLocalDatabase(claimed, bruno);
    claimed.close();

    expect(
      adoptLegacyLocalDatabase({ legacyPath, partitionPath, partition: ana }),
    ).toMatchObject({ reason: "legacy-belongs-to-another-account" });
  });
});
