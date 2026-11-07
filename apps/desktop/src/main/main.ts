import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session as electronSession,
  shell,
} from "electron";
import { readDesktopConfig } from "@calibra-facil/config";
import type { DesktopInvokeHandlers } from "@calibra-facil/contracts/desktop-bridge";
import {
  deliverLaunchDeepLink,
  installAppLifecycle,
  installSingleInstanceDeepLinks,
  registerDeepLinkScheme,
} from "./app-lifecycle";
import { DesktopCloudAuthProxy } from "./cloud-auth-proxy";
import { DeepLinkInbox } from "./deep-link-inbox";
import { createDesktopAuthFetch } from "./desktop-auth-fetch";
import { createDesktopEnvironment } from "./desktop-environment";
import { installDesktopLogger, getDesktopLogFilePath } from "./desktop-log";
import { appHandlers } from "./ipc/app-handlers";
import { authHandlers } from "./ipc/auth-handlers";
import {
  broadcastBridgeEvent,
  registerBridgeHandlers,
  type IpcInvokeEvent,
} from "./ipc/bridge-ipc";
import { fileHandlers } from "./ipc/file-handlers";
import { notificationHandlers } from "./ipc/notification-handlers";
import { partitionHandlers } from "./ipc/partition-handlers";
import { syncHandlers } from "./ipc/sync-handlers";
import { updateHandlers } from "./ipc/update-handlers";
import { LocalPartitionController } from "./local-partition-controller";
import { LocalPartitionStore } from "./local-partition-store";
import { LocalServerClient } from "./local-server-client";
import { LocalServerManager } from "./local-server-manager";
import { MainWindowHost } from "./main-window-host";
import {
  buildDesktopUserAgent,
  desktopAppName,
  desktopWindowIconPath,
} from "./main-window";
import { NativeNotificationHost } from "./native-notification-host";
import { installNavigationGuards } from "./navigation-guards";
import { NotificationAnnouncer } from "./notification-announcer";
import {
  declarePackagedRendererScheme,
  desktopAppHost,
  desktopAppScheme,
  registerPackagedRendererProtocol,
} from "./packaged-renderer-protocol";
import { installPermissionPolicy } from "./permissions";
import { formatErrorMessage } from "./renderer-diagnostics";
import { DesktopSecretsStore } from "./secrets-store";
import { DesktopSettingsStore } from "./settings-store";
import { exportSupportBundle } from "./support-bundle";
import { SyncStatusBroadcaster } from "./sync-status-broadcaster";
import { registerSyncWakeTriggers } from "./sync-wake-triggers";
import { isTrustedUrl, resolveTrustedOrigins } from "./trusted-origins";
import { DesktopUpdater } from "./updater";
import { DesktopWindowStateStore } from "./window-state";

/**
 * The composition root of the desktop shell: builds each piece from what it
 * needs, wires them together and runs the start-up sequence. The state the
 * shell keeps lives in the pieces (the window host, the deep-link inbox, the
 * partition controller, the notification announcer); this file holds none.
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const userData = app.getPath("userData");

const environment = createDesktopEnvironment({
  config: readDesktopConfig(),
  isPackaged: app.isPackaged,
  // Cloud API and web origin this desktop build talks to, baked in at build
  // time (see build-env.d.ts); the runtime overrides in the configuration win.
  buildCloudApiUrl: import.meta.env.VITE_DESKTOP_AUTH_API_URL,
  buildCloudWebOrigin: import.meta.env.VITE_DESKTOP_AUTH_ORIGIN,
});

const windowStateStore = new DesktopWindowStateStore(userData);
const localPartitionStore = new LocalPartitionStore(userData);

const localServer = new LocalServerManager({
  skipLocalServer: environment.skipLocalServer,
});
const localServerClient = new LocalServerClient(localServer);
const syncBroadcaster = new SyncStatusBroadcaster(localServerClient, () =>
  BrowserWindow.getAllWindows(),
);

const deepLinks: DeepLinkInbox = new DeepLinkInbox({
  currentWindow: () => mainWindow.current(),
  log: console,
});
const mainWindow = new MainWindowHost({
  windowStateStore,
  rendererUrl: environment.rendererUrl,
  preloadPath: path.join(currentDir, "../preload/preload.cjs"),
  iconPath: desktopWindowIconPath(path.resolve(currentDir, "../../assets")),
  onDocumentLoadStarted: () => deepLinks.markRendererGone(),
});

const partitions = new LocalPartitionController({
  server: localServer,
  store: localPartitionStore,
  sync: localServerClient,
  publishSyncStatus: () => syncBroadcaster.publish(),
  log: console,
});

const desktopAuthFetch = createDesktopAuthFetch(environment);
const cloudAuthProxy = new DesktopCloudAuthProxy({
  targetBaseUrl: environment.cloudApiUrl,
  authFetch: desktopAuthFetch,
});

function trustedOrigins() {
  return resolveTrustedOrigins({
    appScheme: desktopAppScheme,
    appHost: desktopAppHost,
    isPackaged: app.isPackaged,
    configuredRendererUrl: environment.configuredRendererUrl,
  });
}

function assertTrustedSender(event: IpcInvokeEvent) {
  const url = event.senderFrame?.url ?? "";

  if (!isTrustedUrl(url, trustedOrigins())) {
    throw new Error(`Blocked IPC call from untrusted sender: ${url}`);
  }
}

// Every web contents (the main window, but also anything a page manages to
// spawn) is fenced to the app before it can load a page.
app.on("web-contents-created", (_event, contents) => {
  installNavigationGuards(contents, {
    trustedOrigins,
    openExternal: (url) => {
      void shell.openExternal(url);
    },
  });
});

app.setName(desktopAppName);
app.userAgentFallback = buildDesktopUserAgent(app.getVersion());
declarePackagedRendererScheme();

installSingleInstanceDeepLinks({
  focusWindow: () => mainWindow.focus(),
  deepLinks,
});

installAppLifecycle({
  shutdown: () => {
    cloudAuthProxy.stop();
    localServer.stop();
  },
  flushWindowState: () => windowStateStore.flush(),
  reopenWindow: () => void mainWindow.open(),
});

app.whenReady().then(async () => {
  installDesktopLogger();
  // Deny-by-default before any window exists, so no page is ever granted a
  // permission by Electron's allow-all fallback.
  installPermissionPolicy(electronSession.defaultSession, trustedOrigins);
  registerDeepLinkScheme();
  // Electron: on Linux the badge is bound to the app's .desktop file, and does
  // nothing at all unless the name matches. `executableName` in
  // electron-builder.yml produces calibrafacil.desktop.
  if (process.platform === "linux") {
    app.setDesktopName("calibrafacil.desktop");
  }
  if (app.isPackaged) {
    registerPackagedRendererProtocol({
      rendererRoot: path.resolve(currentDir, "../renderer"),
      localServerHost: localServer.host,
      cloudApiUrls: [environment.defaultCloudApiUrl, environment.cloudApiUrl],
    });
  }

  const settingsStore = new DesktopSettingsStore(userData);
  const secretsStore = new DesktopSecretsStore(userData);
  await settingsStore.load();
  await secretsStore.load();
  const updater = new DesktopUpdater({
    settingsStore,
    getSyncStatus: () => localServerClient.syncStatus(),
    getLocalDiagnostics: () => localServerClient.diagnostics(),
    beforeInstall: () => localServer.stop(),
    smokeDownloadedVersion: environment.smokeDownloadedUpdateVersion,
    onStateChange: (state) => {
      broadcastBridgeEvent(
        () => BrowserWindow.getAllWindows(),
        "onUpdateState",
        state,
      );
    },
  });

  const announcer = new NotificationAnnouncer();
  const nativeNotifications = new NativeNotificationHost({
    currentWindow: () => mainWindow.current(),
    focusWindow: () => mainWindow.focus(),
    deepLinks,
    overlayIconPath: path.resolve(
      currentDir,
      "../../assets/notification-overlay.png",
    ),
  });

  const handlers: DesktopInvokeHandlers = {
    ...authHandlers({ authFetch: desktopAuthFetch }),
    ...appHandlers({
      app,
      platform: process.platform,
      arch: process.arch,
      settings: settingsStore,
      secrets: secretsStore,
      localEnvironmentBootstrap: () => localServerClient.environmentBootstrap(),
    }),
    ...syncHandlers({
      client: localServerClient,
      broadcaster: syncBroadcaster,
    }),
    ...partitionHandlers({
      controller: partitions,
      store: localPartitionStore,
    }),
    ...notificationHandlers({
      deepLinks,
      announcer,
      native: nativeNotifications,
      isWindowFocused: () => mainWindow.isFocused(),
    }),
    ...fileHandlers({
      dialog,
      openExternal: (url) => shell.openExternal(url),
      downloadsPath: () => app.getPath("downloads"),
      exportSupportBundle: async (filePath) =>
        exportSupportBundle({
          filePath,
          desktopLogFilePath: getDesktopLogFilePath(),
          rendererBuildManifestPath: path.join(
            currentDir,
            "../renderer/calibra-renderer-build.json",
          ),
          localEnvironment: localServer.bootstrap,
          localRuntime: localServer.runtime,
          syncStatus: await localServerClient.syncStatus(),
          localDiagnostics: await localServerClient.diagnostics(),
          updateState: updater.getState(),
          settingsStore,
          secretsStore,
        }),
    }),
    ...updateHandlers(updater),
  };
  registerBridgeHandlers(ipcMain, handlers, assertTrustedSender);

  let cloudProxyUrl = environment.cloudApiUrl;
  let cloudProxyToken: string | null = null;

  try {
    cloudProxyUrl = await cloudAuthProxy.start();
    cloudProxyToken = cloudAuthProxy.token;
  } catch (error) {
    console.error("[desktop-startup] cloud auth proxy failed to start", {
      error: formatErrorMessage(error),
    });
  }

  const desktopSettings = await settingsStore.get();
  partitions.useCloud({
    cloudApiUrl: cloudProxyUrl,
    cloudProxyToken,
    autoStartSync: desktopSettings.autoStartSync,
  });

  await partitions.startAtLaunch({ packaged: app.isPackaged });
  await syncBroadcaster.publish();

  registerSyncWakeTriggers(localServerClient);
  await mainWindow.open();
  deliverLaunchDeepLink(deepLinks);
});
