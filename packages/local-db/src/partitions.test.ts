import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { openLocalDatabase } from "./database";
import {
  assertLocalDatabaseOwner,
  claimLocalDatabase,
  isSameLocalDatabasePartition,
  localDatabaseHasDomainRows,
  localDatabasePartitionKey,
  LocalDatabaseOwnershipError,
  readLocalDatabaseOwner,
} from "./partitions";

const tempDirectories: string[] = [];

function createDatabase() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-partition-"));
  tempDirectories.push(directory);

  return openLocalDatabase({
    filePath: path.join(directory, "calibra.sqlite"),
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const ana = { userId: "user-ana", organizationId: "org-1" };
const bruno = { userId: "user-bruno", organizationId: "org-1" };
const anaOtherOrg = { userId: "user-ana", organizationId: "org-2" };

describe("localDatabasePartitionKey", () => {
  it("is stable for the same account and organization", () => {
    expect(localDatabasePartitionKey(ana)).toBe(localDatabasePartitionKey(ana));
  });

  it("separates two accounts in the SAME organization", () => {
    // The reason the partition is not organization-only: two accounts in one
    // org have different permissions, and an org-wide file would let the
    // second read everything the first downloaded.
    expect(localDatabasePartitionKey(ana)).not.toBe(
      localDatabasePartitionKey(bruno),
    );
  });

  it("separates one account across two organizations", () => {
    expect(localDatabasePartitionKey(ana)).not.toBe(
      localDatabasePartitionKey(anaOtherOrg),
    );
  });

  it("puts no account identifier in the path", () => {
    // Paths end up in backups, crash reports and support bundles.
    const key = localDatabasePartitionKey(ana);

    expect(key).not.toContain("user-ana");
    expect(key).not.toContain("org-1");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is pinned: changing it relocates every existing partition directory", () => {
    // The key names a directory that already holds a user's offline work. A
    // refactor of the separator or the digest silently orphans every one of
    // them, so the value is asserted literally rather than recomputed.
    expect(localDatabasePartitionKey(ana)).toBe(
      "e323b801250fca4a9ad803f24bb13982",
    );
  });

  it("does not collide when the ids run together", () => {
    // A naive `userId + organizationId` concatenation maps ("ab","c") and
    // ("a","bc") to the same key.
    expect(
      localDatabasePartitionKey({ userId: "ab", organizationId: "c" }),
    ).not.toBe(
      localDatabasePartitionKey({ userId: "a", organizationId: "bc" }),
    );
  });
});

describe("isSameLocalDatabasePartition", () => {
  it("compares both halves", () => {
    expect(isSameLocalDatabasePartition(ana, { ...ana })).toBe(true);
    expect(isSameLocalDatabasePartition(ana, bruno)).toBe(false);
    expect(isSameLocalDatabasePartition(ana, anaOtherOrg)).toBe(false);
  });

  it("treats a missing partition as not matching", () => {
    expect(isSameLocalDatabasePartition(null, ana)).toBe(false);
    expect(isSameLocalDatabasePartition(ana, null)).toBe(false);
  });
});

describe("claimLocalDatabase", () => {
  it("records the owner of a fresh database", () => {
    const database = createDatabase();

    const owner = claimLocalDatabase(database, ana, "2026-09-10T10:00:00.000Z");

    expect(owner).toEqual({ ...ana, claimedAt: "2026-09-10T10:00:00.000Z" });
    expect(readLocalDatabaseOwner(database)).toEqual(owner);
  });

  it("is idempotent for the same partition", () => {
    const database = createDatabase();
    const first = claimLocalDatabase(database, ana, "2026-09-10T10:00:00.000Z");

    expect(
      claimLocalDatabase(database, ana, "2026-09-10T11:00:00.000Z"),
    ).toEqual(first);
  });

  it("refuses to re-point a claimed database at another account", () => {
    const database = createDatabase();
    claimLocalDatabase(database, ana);

    expect(() => claimLocalDatabase(database, bruno)).toThrow(
      LocalDatabaseOwnershipError,
    );
  });
});

describe("assertLocalDatabaseOwner", () => {
  it("passes for the owning partition", () => {
    const database = createDatabase();
    claimLocalDatabase(database, ana);

    expect(assertLocalDatabaseOwner(database, ana)).toMatchObject(ana);
  });

  it("refuses another account in the same organization", () => {
    // The exposure this whole change exists to close.
    const database = createDatabase();
    claimLocalDatabase(database, ana);

    expect(() => assertLocalDatabaseOwner(database, bruno)).toThrow(
      LocalDatabaseOwnershipError,
    );
  });

  it("refuses the same account in another organization", () => {
    const database = createDatabase();
    claimLocalDatabase(database, ana);

    expect(() => assertLocalDatabaseOwner(database, anaOtherOrg)).toThrow(
      LocalDatabaseOwnershipError,
    );
  });

  it("adopts an empty unclaimed database", () => {
    // A brand new file, and a file created before ownership tracking existed
    // but never synced, are both safe to take.
    const database = createDatabase();

    expect(assertLocalDatabaseOwner(database, ana)).toMatchObject(ana);
    expect(readLocalDatabaseOwner(database)).toMatchObject(ana);
  });

  it("refuses an unclaimed database that already holds someone's data", () => {
    // The upgrade case: a database populated before this table existed must
    // not be handed to whoever opens it next.
    const database = createDatabase();
    database
      .prepare(
        `INSERT INTO customers (id, organization_id, name, updated_at, sync_state)
         VALUES ('c1', 'org-1', 'Cliente', '2026-01-01', 'synced')`,
      )
      .run();

    expect(localDatabaseHasDomainRows(database)).toBe(true);
    expect(() => assertLocalDatabaseOwner(database, ana)).toThrow(
      LocalDatabaseOwnershipError,
    );
  });

  it("names both partitions in the error, for support", () => {
    const database = createDatabase();
    claimLocalDatabase(database, ana);

    expect(() => assertLocalDatabaseOwner(database, bruno)).toThrow(
      /user-bruno[\s\S]*user-ana/,
    );
  });
});

describe("localDatabaseHasDomainRows", () => {
  it("is false for a fresh database", () => {
    expect(localDatabaseHasDomainRows(createDatabase())).toBe(false);
  });

  it("ignores the ownership row itself", () => {
    const database = createDatabase();
    claimLocalDatabase(database, ana);

    expect(localDatabaseHasDomainRows(database)).toBe(false);
  });

  it("notices queued offline work", () => {
    // Pending outbox events are the outgoing account's unfinished field work.
    // They are exactly what must never be adopted by another account.
    const database = createDatabase();
    database
      .prepare(
        `INSERT INTO outbox (
           id, event_id, operation, payload_json,
           idempotency_key, status, created_at
         ) VALUES ('o1', 'e1', 'create_customer', '{}', 'k1', 'pending', '2026-01-01')`,
      )
      .run();

    expect(localDatabaseHasDomainRows(database)).toBe(true);
  });
});
