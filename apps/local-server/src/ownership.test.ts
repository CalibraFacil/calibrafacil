import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimLocalDatabase,
  LocalDatabaseOwnershipError,
  openLocalDatabase,
  readLocalDatabaseOwner,
} from "@calibra-facil/local-db";

import { createLocalServerFromConfig } from "./server";
import {
  LocalServerPartitionRequiredError,
  resolveLocalServerDbPath,
} from "./bootstrap";
import type { LocalServerConfig } from "./bootstrap";

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-ownership-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createConfig(
  dbPath: string,
  overrides: Partial<LocalServerConfig> = {},
): LocalServerConfig {
  return {
    host: "127.0.0.1",
    port: 4317,
    appVersion: "test",
    localServerVersion: "test",
    dbPath,
    storageRoot: path.join(path.dirname(dbPath), "files"),
    deviceId: "device-test",
    tenantId: null,
    organizationId: "org-1",
    unitId: 1,
    userId: "user-ana",
    syncEnabled: false,
    bootstrapToken: null,
    cloudApiUrl: null,
    cloudAuthToken: null,
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
    ...overrides,
  };
}

describe("local server database ownership", () => {
  it("claims a fresh database for the configured account", () => {
    const dbPath = createTempDatabasePath();

    const instance = createLocalServerFromConfig(createConfig(dbPath));

    expect(readLocalDatabaseOwner(instance.database)).toMatchObject({
      userId: "user-ana",
      organizationId: "org-1",
    });
  });

  it("refuses to start against another account's database", () => {
    // The exposure: on a shared workstation, account B must not be served
    // account A's calibration records because the file happened to be there.
    const dbPath = createTempDatabasePath();
    const seeded = openLocalDatabase({ filePath: dbPath });
    claimLocalDatabase(seeded, {
      userId: "user-ana",
      organizationId: "org-1",
    });

    expect(() =>
      createLocalServerFromConfig(
        createConfig(dbPath, { userId: "user-bruno" }),
      ),
    ).toThrow(LocalDatabaseOwnershipError);
  });

  it("refuses another organization for the same account", () => {
    const dbPath = createTempDatabasePath();
    const seeded = openLocalDatabase({ filePath: dbPath });
    claimLocalDatabase(seeded, {
      userId: "user-ana",
      organizationId: "org-1",
    });

    expect(() =>
      createLocalServerFromConfig(
        createConfig(dbPath, { organizationId: "org-2" }),
      ),
    ).toThrow(LocalDatabaseOwnershipError);
  });

  it("starts again for the owning account", () => {
    const dbPath = createTempDatabasePath();
    createLocalServerFromConfig(createConfig(dbPath));

    expect(() =>
      createLocalServerFromConfig(createConfig(dbPath)),
    ).not.toThrow();
  });

  it("leaves dev and test runs without an identity alone", () => {
    // `pnpm dev` has no signed-in account; requiring one would make the
    // local server unstartable outside the packaged app.
    const dbPath = createTempDatabasePath();

    const instance = createLocalServerFromConfig(
      createConfig(dbPath, { userId: null, organizationId: null }),
    );

    expect(readLocalDatabaseOwner(instance.database)).toBeNull();
  });
});

describe("resolveLocalServerDbPath", () => {
  const base = createConfig("/tmp/explicit/calibra.sqlite");

  it("uses the explicit path when there is no data root", () => {
    expect(resolveLocalServerDbPath(base)).toBe("/tmp/explicit/calibra.sqlite");
  });

  it("uses the explicit path for a run with no identity", () => {
    // `pnpm dev` and the test suites have no signed-in account.
    expect(
      resolveLocalServerDbPath({
        ...base,
        dataRoot: "/tmp/root",
        userId: null,
        organizationId: null,
      }),
    ).toBe("/tmp/explicit/calibra.sqlite");
  });

  it("derives a partitioned path, ignoring a stale explicit one", () => {
    // The host passing a stale dbPath beside a fresh identity is exactly the
    // mistake this removes: the two cannot disagree if only one is used.
    const derived = resolveLocalServerDbPath({
      ...base,
      dataRoot: "/tmp/root",
    });

    expect(derived).not.toBe("/tmp/explicit/calibra.sqlite");
    expect(derived.startsWith("/tmp/root/")).toBe(true);
    expect(derived.endsWith("/calibra.sqlite")).toBe(true);
  });

  it("gives two accounts in one organization different files", () => {
    const ana = resolveLocalServerDbPath({ ...base, dataRoot: "/tmp/root" });
    const bruno = resolveLocalServerDbPath({
      ...base,
      dataRoot: "/tmp/root",
      userId: "user-bruno",
    });

    expect(ana).not.toBe(bruno);
  });

  it("gives one account in two organizations different files", () => {
    const org1 = resolveLocalServerDbPath({ ...base, dataRoot: "/tmp/root" });
    const org2 = resolveLocalServerDbPath({
      ...base,
      dataRoot: "/tmp/root",
      organizationId: "org-2",
    });

    expect(org1).not.toBe(org2);
  });

  it("puts no account identifier in the path", () => {
    const derived = resolveLocalServerDbPath({
      ...base,
      dataRoot: "/tmp/root",
    });

    expect(derived).not.toContain("user-ana");
    expect(derived).not.toContain("org-1");
  });
});

describe("packaged builds require a partition", () => {
  it("refuses to open an unpartitioned database", () => {
    // The dev-only convenience of a database belonging to nobody must not be
    // reachable in a packaged build, where "nobody" means "whoever opens the
    // app next".
    const dbPath = createTempDatabasePath();

    expect(() =>
      createLocalServerFromConfig(
        createConfig(dbPath, {
          requirePartition: true,
          userId: null,
          organizationId: null,
        }),
      ),
    ).toThrow(LocalServerPartitionRequiredError);
  });

  it("refuses an account with no organization", () => {
    const dbPath = createTempDatabasePath();

    expect(() =>
      createLocalServerFromConfig(
        createConfig(dbPath, {
          requirePartition: true,
          organizationId: null,
        }),
      ),
    ).toThrow(LocalServerPartitionRequiredError);
  });

  it("refuses an organization with no account", () => {
    const dbPath = createTempDatabasePath();

    expect(() =>
      createLocalServerFromConfig(
        createConfig(dbPath, { requirePartition: true, userId: null }),
      ),
    ).toThrow(LocalServerPartitionRequiredError);
  });

  it("starts for a fully identified partition", () => {
    const dbPath = createTempDatabasePath();

    expect(() =>
      createLocalServerFromConfig(
        createConfig(dbPath, { requirePartition: true }),
      ),
    ).not.toThrow();
  });

  it("leaves dev and test runs alone", () => {
    // Without the flag, an unpartitioned server is still allowed — that is
    // what `pnpm dev` and these suites rely on.
    const dbPath = createTempDatabasePath();

    expect(() =>
      createLocalServerFromConfig(
        createConfig(dbPath, { userId: null, organizationId: null }),
      ),
    ).not.toThrow();
  });
});
