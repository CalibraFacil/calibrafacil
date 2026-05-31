import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopSettings,
  LocalEnvironmentBootstrap,
  LocalDiagnostics,
  SyncStatusSnapshot,
} from "@calibra-facil/contracts";
import type { DesktopSecretsStore } from "./secrets-store";
import type { DesktopSettingsStore } from "./settings-store";
import { exportSupportBundle } from "./support-bundle";

const mocks = vi.hoisted(() => ({
  app: {
    getName: vi.fn(() => "Calibra Facil"),
    getVersion: vi.fn(() => "1.2.3"),
    getPath: vi.fn(() => os.tmpdir()),
    isPackaged: true,
  },
}));

vi.mock("electron", () => ({
  app: mocks.app,
}));

const tempDirectories: string[] = [];

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("exportSupportBundle", () => {
  it("writes desktop, sync, diagnostics, and redacted secret status data", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "calibra-support-bundle-"),
    );
    tempDirectories.push(directory);
    const filePath = path.join(directory, "support.json");
    const desktopLogPath = path.join(directory, "desktop.log");
    const localServerLogPath = path.join(directory, "local-server.log");
    const rendererBuildManifestPath = path.join(
      directory,
      "calibra-renderer-build.json",
    );
    await writeFile(
      desktopLogPath,
      "2026-01-15T10:00:00.000Z [desktop] [error] preload failed\n",
      "utf8",
    );
    await writeFile(
      localServerLogPath,
      "2026-01-15T10:00:00.000Z [local-server] sync failed\n",
      "utf8",
    );
    await writeFile(
      rendererBuildManifestPath,
      JSON.stringify({
        schemaVersion: 1,
        sourcePackage: "@calibra-facil/web",
        stagedAt: "2026-01-15T10:00:00.000Z",
        indexSha256: "abc123",
      }),
      "utf8",
    );
    const settings: DesktopSettings = {
      autoStartSync: true,
      updateChannel: "stable",
    };
    const syncStatus: SyncStatusSnapshot = {
      state: "conflict",
      pendingOutboxCount: 2,
      conflictCount: 1,
      lastSyncedAt: "2026-01-15T10:00:00.000Z",
    };
    const diagnostics: LocalDiagnostics = {
      runtime: {
        desktopRunId: "desktop-run-1",
        localServerRunId: "local-server-run-1",
      },
      sync: {
        state: "conflict",
        activeRunId: null,
        lastRunId: "sync-run-1",
        lastError: null,
      },
      database: {
        schemaVersion: 5,
        integrity: {
          ok: true,
          messages: [],
        },
        pendingOutboxCount: 2,
        conflictCount: 1,
        activeCalibrationJobCount: 1,
        activeServiceOrderWorkflowCount: 0,
      },
    };
    const localEnvironment: LocalEnvironmentBootstrap = {
      httpBaseUrl: "http://127.0.0.1:4317",
      localApiToken: "local-token",
      appVersion: "1.2.3",
      localServerVersion: "0.0.0",
      deviceId: "device-1",
      tenantId: null,
      organizationId: "org-1",
      unitId: 10,
      userId: "user-1",
      dbSchemaVersion: 5,
      syncEnabled: true,
      syncState: "conflict",
    };
    const secretStatuses: Awaited<
      ReturnType<DesktopSecretsStore["getStatuses"]>
    > = [
      {
        name: "cloudAuthToken",
        stored: true,
        encryptionAvailable: true,
        updatedAt: "2026-01-15T10:00:00.000Z",
      },
    ];

    await exportSupportBundle({
      filePath,
      desktopLogFilePath: desktopLogPath,
      rendererBuildManifestPath,
      localEnvironment,
      localRuntime: {
        state: "ready",
        desktopRunId: "desktop-run-1",
        localServerRunId: "local-server-run-1",
        logFilePath: localServerLogPath,
      },
      syncStatus,
      localDiagnostics: diagnostics,
      updateState: {
        status: "downloaded",
        version: "1.2.4",
      },
      settingsStore: {
        get: vi.fn(async () => settings),
      } satisfies Pick<DesktopSettingsStore, "get">,
      secretsStore: {
        getStatuses: vi.fn(async () => secretStatuses),
      } satisfies Pick<DesktopSecretsStore, "getStatuses">,
    });

    const payload = JSON.parse(await readFile(filePath, "utf8"));

    expect(payload.desktop.settings).toEqual(settings);
    expect(payload.desktop.update).toMatchObject({
      status: "downloaded",
      version: "1.2.4",
    });
    expect(payload.desktop.log).toMatchObject({
      path: desktopLogPath,
      truncated: false,
      tail: expect.stringContaining("preload failed"),
    });
    expect(payload.desktop.rendererBuild).toEqual({
      path: rendererBuildManifestPath,
      data: {
        schemaVersion: 1,
        sourcePackage: "@calibra-facil/web",
        stagedAt: "2026-01-15T10:00:00.000Z",
        indexSha256: "abc123",
      },
    });
    expect(payload.desktop.secrets).toEqual([
      {
        name: "cloudAuthToken",
        stored: true,
        encryptionAvailable: true,
        updatedAt: "2026-01-15T10:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(payload)).not.toContain("local-token");
    expect(payload.localServer.environment).toEqual({
      ...localEnvironment,
      localApiToken: "[redacted]",
    });
    expect(payload.localServer.runtime).toMatchObject({
      state: "ready",
      desktopRunId: "desktop-run-1",
      localServerRunId: "local-server-run-1",
      logFilePath: expect.stringContaining("local-server.log"),
    });
    expect(payload.localServer.log).toMatchObject({
      path: localServerLogPath,
      truncated: false,
      tail: expect.stringContaining("sync failed"),
    });
    expect(payload.localServer.syncStatus).toEqual(syncStatus);
    expect(payload.localServer.diagnostics).toEqual(diagnostics);
  });
});
