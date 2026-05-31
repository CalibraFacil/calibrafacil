import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopSettings,
  LocalDiagnostics,
  SyncStatusSnapshot,
} from "@calibra-facil/contracts";
import type { DesktopSettingsStore } from "./settings-store";
import { DesktopUpdater } from "./updater";

const mocks = vi.hoisted(() => {
  const autoUpdater: {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    logger: unknown;
    allowPrerelease: boolean;
    channel: string | null;
    on: ReturnType<typeof vi.fn>;
    checkForUpdates: ReturnType<typeof vi.fn>;
    downloadUpdate: ReturnType<typeof vi.fn>;
    quitAndInstall: ReturnType<typeof vi.fn>;
  } = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: {},
    allowPrerelease: false,
    channel: null,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  };

  return {
    app: {
      isPackaged: true,
    },
    autoUpdater,
    handlers: new Map<string, (...args: unknown[]) => void>(),
  };
});

vi.mock("electron", () => ({
  app: mocks.app,
}));

vi.mock("electron-updater", () => ({
  autoUpdater: mocks.autoUpdater,
}));

function createUpdater(
  options: {
    syncStatus?: Partial<SyncStatusSnapshot>;
    diagnostics?: LocalDiagnostics | null;
    beforeInstall?: () => void;
    seedDownloadedEvent?: boolean;
  } = {},
) {
  const beforeInstall = options.beforeInstall ?? vi.fn(() => {});
  const settings: DesktopSettings = {
    autoStartSync: true,
    updateChannel: "stable",
  };
  const syncStatus: SyncStatusSnapshot = {
    state: "idle",
    pendingOutboxCount: 0,
    conflictCount: 0,
    lastSyncedAt: null,
    ...options.syncStatus,
  };

  const updater = new DesktopUpdater({
    settingsStore: {
      get: vi.fn(async () => settings),
    } satisfies Pick<DesktopSettingsStore, "get">,
    getSyncStatus: vi.fn(async () => syncStatus),
    getLocalDiagnostics: vi.fn(async () => options.diagnostics ?? null),
    beforeInstall,
  });

  if (options.seedDownloadedEvent !== false) {
    mocks.handlers.get("update-downloaded")?.({ version: "9.9.9" });
  }

  return { updater, beforeInstall };
}

function localDiagnostics(
  input: Partial<LocalDiagnostics["database"]>,
): LocalDiagnostics {
  return {
    runtime: {
      desktopRunId: "desktop-run-1",
      localServerRunId: "local-server-run-1",
    },
    sync: {
      state: "idle",
      activeRunId: null,
      lastRunId: null,
      lastError: null,
    },
    database: {
      schemaVersion: 5,
      integrity: {
        ok: true,
        messages: [],
      },
      pendingOutboxCount: 0,
      conflictCount: 0,
      activeCalibrationJobCount: 0,
      activeServiceOrderWorkflowCount: 0,
      ...input,
    },
  };
}

describe("DesktopUpdater", () => {
  afterEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.autoUpdater.autoDownload = true;
    mocks.autoUpdater.autoInstallOnAppQuit = true;
    mocks.autoUpdater.logger = {};
    mocks.autoUpdater.allowPrerelease = false;
    mocks.autoUpdater.channel = null;
    vi.unstubAllEnvs();
  });

  it("supports a guarded smoke hook for downloaded update state", () => {
    vi.stubEnv("CALIBRA_DESKTOP_ENABLE_SMOKE_HOOKS", "1");
    vi.stubEnv(
      "CALIBRA_DESKTOP_SMOKE_DOWNLOADED_UPDATE_VERSION",
      "9.9.9-smoke",
    );

    const { updater } = createUpdater({ seedDownloadedEvent: false });

    expect(updater.getState()).toMatchObject({
      status: "downloaded",
      version: "9.9.9-smoke",
      message: "Smoke update downloaded and ready to install.",
    });
  });

  it("blocks update install while local changes are pending sync", async () => {
    const { updater, beforeInstall } = createUpdater({
      syncStatus: { pendingOutboxCount: 2 },
    });

    const state = await updater.installUpdate();

    expect(state).toMatchObject({
      status: "downloaded",
      message:
        "Update install is blocked while local changes are pending sync.",
    });
    expect(beforeInstall).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("blocks update install while sync conflicts need review", async () => {
    const { updater, beforeInstall } = createUpdater({
      syncStatus: { state: "conflict", conflictCount: 1 },
    });

    const state = await updater.installUpdate();

    expect(state).toMatchObject({
      status: "downloaded",
      message: "Update install is blocked while sync conflicts require review.",
    });
    expect(beforeInstall).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("blocks update install while calibration work is active", async () => {
    const { updater, beforeInstall } = createUpdater({
      diagnostics: localDiagnostics({ activeCalibrationJobCount: 1 }),
    });

    const state = await updater.installUpdate();

    expect(state).toMatchObject({
      status: "downloaded",
      message: "Update install is blocked while a calibration is in progress.",
    });
    expect(beforeInstall).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("stops local services and installs when sync and diagnostics are safe", async () => {
    const { updater, beforeInstall } = createUpdater({
      diagnostics: localDiagnostics({}),
    });

    const state = await updater.installUpdate();

    expect(state).toMatchObject({
      status: "downloaded",
      version: "9.9.9",
    });
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
});

mocks.autoUpdater.on.mockImplementation(
  (event: string, handler: (...args: unknown[]) => void) => {
    mocks.handlers.set(event, handler);
  },
);
