import os from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { LocalPartitionStore } from "./local-partition-store";

const tempDirectories: string[] = [];

function createUserData() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-partition-"));
  tempDirectories.push(directory);
  return directory;
}

function writeStoreFile(userData: string, contents: string) {
  mkdirSync(path.join(userData, "settings"), { recursive: true });
  writeFileSync(
    path.join(userData, "settings", "local-partition.json"),
    contents,
  );
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const ana = { userId: "user-ana", organizationId: "org-1" };

describe("LocalPartitionStore", () => {
  it("remembers nothing on a fresh device", async () => {
    await expect(
      new LocalPartitionStore(createUserData()).load(),
    ).resolves.toBe(null);
  });

  it("round-trips an authorized partition across restarts", async () => {
    const userData = createUserData();

    await new LocalPartitionStore(userData).remember(
      ana,
      "2026-09-10T10:00:00.000Z",
    );

    await expect(new LocalPartitionStore(userData).load()).resolves.toEqual({
      partition: ana,
      authorizedAt: "2026-09-10T10:00:00.000Z",
    });
  });

  it("replaces the grant rather than accumulating them", async () => {
    // Only one identity may hold offline access at a time.
    const userData = createUserData();
    const store = new LocalPartitionStore(userData);

    await store.remember(ana);
    await store.remember({ userId: "user-bruno", organizationId: "org-1" });

    await expect(
      new LocalPartitionStore(userData).load(),
    ).resolves.toMatchObject({
      partition: { userId: "user-bruno" },
    });
  });

  it("forgets the grant without being told what to delete", async () => {
    // `forget` revokes offline *access*. The database it pointed at keeps the
    // account's queued field work; nothing here touches it.
    const userData = createUserData();
    const store = new LocalPartitionStore(userData);
    await store.remember(ana);

    await store.forget();

    await expect(new LocalPartitionStore(userData).load()).resolves.toBe(null);
  });

  it("falls back to no offline access on a corrupt file", async () => {
    // Costing a sign-in beats opening a database on a damaged claim.
    const userData = createUserData();
    writeStoreFile(userData, "{ not json");

    await expect(new LocalPartitionStore(userData).load()).resolves.toBe(null);
  });

  it("rejects a structurally invalid grant", async () => {
    const userData = createUserData();
    writeStoreFile(
      userData,
      JSON.stringify({ partition: { userId: "" }, authorizedAt: 12 }),
    );

    await expect(new LocalPartitionStore(userData).load()).resolves.toBe(null);
  });

  it("rejects a grant missing the organization half", async () => {
    // An account-only grant would be an organization-wide one by omission.
    const userData = createUserData();
    writeStoreFile(
      userData,
      JSON.stringify({
        partition: { userId: "user-ana" },
        authorizedAt: "2026-09-10T10:00:00.000Z",
      }),
    );

    await expect(new LocalPartitionStore(userData).load()).resolves.toBe(null);
  });
});
