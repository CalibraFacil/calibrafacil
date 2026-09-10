import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  CalibraBridge,
  DesktopNotificationsPublish,
  LocalPartitionActivationRequest,
  LocalPartitionActivationResult,
  DesktopUpdateState,
  SyncStatusSnapshot,
  SyncTrigger,
} from "@calibra-facil/contracts";
import { desktopIpcChannels } from "../main/channels";

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args);

function subscribe<T>(channel: string, listener: (value: T) => void) {
  const handler = (_event: IpcRendererEvent, value: T) => {
    listener(value);
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const calibraBridge: CalibraBridge = {
  authFetch: (request) => invoke(desktopIpcChannels.authFetch, request),
  getAppInfo: () => invoke(desktopIpcChannels.getAppInfo),
  getLocalEnvironmentBootstrap: () =>
    invoke(desktopIpcChannels.getLocalEnvironmentBootstrap),
  getSettings: () => invoke(desktopIpcChannels.getSettings),
  setSettings: (patch) => invoke(desktopIpcChannels.setSettings, patch),
  getSecretStatuses: () => invoke(desktopIpcChannels.getSecretStatuses),
  setSecret: (secret) => invoke(desktopIpcChannels.setSecret, secret),
  deleteSecret: (name) => invoke(desktopIpcChannels.deleteSecret, name),
  getSyncState: () => invoke(desktopIpcChannels.getSyncState),
  getSyncStatus: () => invoke(desktopIpcChannels.getSyncStatus),
  onSyncStatus: (listener) =>
    subscribe<SyncStatusSnapshot>(
      desktopIpcChannels.syncStatusChanged,
      listener,
    ),
  startSync: () => invoke(desktopIpcChannels.startSync),
  pauseSync: () => invoke(desktopIpcChannels.pauseSync),
  resumeSync: () => invoke(desktopIpcChannels.resumeSync),
  retrySync: () => invoke(desktopIpcChannels.retrySync),
  wakeSync: (trigger: SyncTrigger) =>
    invoke(desktopIpcChannels.wakeSync, trigger),
  onDeepLink: (listener: (path: string) => void) =>
    subscribe<string>(desktopIpcChannels.deepLinkRequested, listener),
  notifyDeepLinkReady: () => invoke<boolean>(desktopIpcChannels.deepLinkReady),
  publishNotifications: (payload: DesktopNotificationsPublish) =>
    invoke<boolean>(desktopIpcChannels.publishNotifications, payload),
  revealFile: (filePath: string) =>
    invoke<boolean>(desktopIpcChannels.revealFile, filePath),
  onHistoryCommand: (listener: (command: string) => void) =>
    subscribe<string>(desktopIpcChannels.historyCommand, listener),
  activateLocalPartition: (request: LocalPartitionActivationRequest) =>
    invoke<LocalPartitionActivationResult>(
      desktopIpcChannels.activateLocalPartition,
      request,
    ),
  pickFile: () => invoke(desktopIpcChannels.pickFile),
  pickFolder: () => invoke(desktopIpcChannels.pickFolder),
  saveFile: () => invoke(desktopIpcChannels.saveFile),
  saveCertificatePdf: (input) =>
    invoke(desktopIpcChannels.saveCertificatePdf, input),
  openExternal: (url) => invoke(desktopIpcChannels.openExternal, url),
  exportSupportBundle: () => invoke(desktopIpcChannels.exportSupportBundle),
  getUpdateState: () => invoke(desktopIpcChannels.getUpdateState),
  onUpdateState: (listener) =>
    subscribe<DesktopUpdateState>(
      desktopIpcChannels.updateStateChanged,
      listener,
    ),
  checkForUpdate: () => invoke(desktopIpcChannels.checkForUpdate),
  downloadUpdate: () => invoke(desktopIpcChannels.downloadUpdate),
  installUpdate: () => invoke(desktopIpcChannels.installUpdate),
};

contextBridge.exposeInMainWorld("calibraBridge", calibraBridge);
