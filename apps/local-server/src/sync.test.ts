import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openLocalDatabase } from "@calibra-facil/local-db";
import type { LocalServerConfig } from "./bootstrap";
import { createLocalSyncRuntime } from "./sync";

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-sync-test-"));
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createConfig(dbPath: string): LocalServerConfig {
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
    userId: "user-1",
    syncEnabled: true,
    bootstrapToken: null,
    cloudApiUrl: null,
    cloudAuthToken: null,
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
  };
}

describe("createLocalSyncRuntime", () => {
  it("records sync run ids and last errors in status snapshots", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const runtime = createLocalSyncRuntime(createConfig(dbPath), database);

    await expect(runtime.runInitialSync()).rejects.toThrow(
      "Cloud API URL is not configured for local sync",
    );

    expect(runtime.getStatus()).toMatchObject({
      state: "error",
      activeRunId: null,
      lastRunId: expect.stringMatching(/^initial-/),
      lastError: "Cloud API URL is not configured for local sync",
    });

    database.close();
  });
});
