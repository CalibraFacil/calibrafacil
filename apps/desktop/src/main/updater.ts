import { app } from "electron";
import { autoUpdater } from "electron-updater";
import {
  desktopUpdateStateSchema,
  type DesktopUpdateState,
  type LocalDiagnostics,
  type SyncStatusSnapshot,
} from "@calibra-facil/contracts";
import type { DesktopSettingsStore } from "./settings-store";

type DesktopUpdaterOptions = {
  settingsStore: Pick<DesktopSettingsStore, "get">;
  getSyncStatus: () => Promise<SyncStatusSnapshot>;
  getLocalDiagnostics: () => Promise<LocalDiagnostics | null>;
  beforeInstall: () => void;
  onStateChange?: (state: DesktopUpdateState) => void;
};

export class DesktopUpdater {
  private state: DesktopUpdateState = { status: "idle" };

  constructor(private readonly options: DesktopUpdaterOptions) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;

    autoUpdater.on("checking-for-update", () => {
      this.setState({ status: "checking" });
    });

    autoUpdater.on("update-available", (info) => {
      this.setState({
        status: "available",
        version: info.version,
        message: "An update is available.",
      });
    });

    autoUpdater.on("update-not-available", (info) => {
      this.setState({
        status: "not-available",
        version: info.version,
        message: "No update is available.",
      });
    });

    autoUpdater.on("download-progress", (info) => {
      this.setState({
        status: "downloading",
        message: `Downloading update (${Math.round(info.percent)}%).`,
      });
    });

    autoUpdater.on("update-downloaded", (event) => {
      this.setState({
        status: "downloaded",
        version: event.version,
        message: "Update downloaded and ready to install.",
      });
    });

    autoUpdater.on("error", (error) => {
      this.setState({
        status: "error",
        message: formatUpdaterError(error),
      });
    });

    const smokeDownloadedVersion = getSmokeDownloadedUpdateVersion();
    if (smokeDownloadedVersion) {
      this.setState({
        status: "downloaded",
        version: smokeDownloadedVersion,
        message: "Smoke update downloaded and ready to install.",
      });
    }
  }

  getState() {
    return desktopUpdateStateSchema.parse(this.state);
  }

  async checkForUpdate() {
    if (!app.isPackaged) {
      return this.setState({
        status: "not-available",
        message: "Update checks are only enabled for packaged builds.",
      });
    }

    await this.configureChannel();
    this.setState({ status: "checking" });

    try {
      await autoUpdater.checkForUpdates();
      return this.getState();
    } catch (error) {
      return this.setState({
        status: "error",
        message: formatUpdaterError(error),
      });
    }
  }

  async downloadUpdate() {
    if (!app.isPackaged) {
      return this.setState({
        status: "error",
        message: "Update downloads are only enabled for packaged builds.",
      });
    }

    await this.configureChannel();
    this.setState({ status: "downloading" });

    try {
      await autoUpdater.downloadUpdate();
      return this.getState();
    } catch (error) {
      return this.setState({
        status: "error",
        message: formatUpdaterError(error),
      });
    }
  }

  async installUpdate() {
    if (this.state.status !== "downloaded") {
      return this.setState({
        ...this.state,
        message: "No downloaded update is ready to install.",
      });
    }

    const blockReason = await this.getInstallBlockReason();
    if (blockReason) {
      return this.setState({
        ...this.state,
        message: blockReason,
      });
    }

    this.options.beforeInstall();
    autoUpdater.quitAndInstall(false, true);
    return this.getState();
  }

  private async configureChannel() {
    const settings = await this.options.settingsStore.get();
    autoUpdater.allowPrerelease = settings.updateChannel === "beta";
    autoUpdater.channel = settings.updateChannel === "beta" ? "beta" : null;
  }

  private async getInstallBlockReason() {
    const syncStatus = await this.options.getSyncStatus();
    if (syncStatus.state === "syncing") {
      return "Update install is blocked while sync is running.";
    }

    if (syncStatus.pendingOutboxCount > 0) {
      return "Update install is blocked while local changes are pending sync.";
    }

    if (syncStatus.conflictCount > 0 || syncStatus.state === "conflict") {
      return "Update install is blocked while sync conflicts require review.";
    }

    const diagnostics = await this.options.getLocalDiagnostics();
    if (diagnostics?.database.activeCalibrationJobCount) {
      return "Update install is blocked while a calibration is in progress.";
    }

    if (diagnostics?.database.activeServiceOrderWorkflowCount) {
      return "Update install is blocked while a service order workflow is in progress.";
    }

    return null;
  }

  private setState(state: DesktopUpdateState) {
    this.state = desktopUpdateStateSchema.parse(state);
    this.options.onStateChange?.(this.state);
    return this.state;
  }
}

function formatUpdaterError(error: unknown) {
  return error instanceof Error ? error.message : "Desktop update failed.";
}

function getSmokeDownloadedUpdateVersion() {
  if (process.env.CALIBRA_DESKTOP_ENABLE_SMOKE_HOOKS !== "1") return null;

  const version = process.env.CALIBRA_DESKTOP_SMOKE_DOWNLOADED_UPDATE_VERSION;
  return version && version.trim() ? version.trim() : null;
}
