import path from "node:path";
import { Buffer } from "node:buffer";
import { readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  powerMonitor,
  protocol,
  screen,
  session as electronSession,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import {
  appInfoSchema,
  certificatePdfExportRequestSchema,
  desktopAuthFetchRequestSchema,
  desktopAuthFetchResponseSchema,
  desktopSecretNameSchema,
  desktopSecretWriteSchema,
  desktopUpdateStateSchema,
  localEnvironmentBootstrapSchema,
  localDiagnosticsSchema,
  syncActionResultSchema,
  syncStatusSnapshotSchema,
  syncTriggerSchema,
  desktopNotificationsPublishSchema,
  localPartitionActivationRequestSchema,
  type DesktopAuthFetchRequest,
  type DesktopAuthFetchResponse,
  type LocalDatabasePartition,
  type SyncTrigger,
} from "@calibra-facil/contracts";
import { desktopIpcChannels } from "./channels";
import {
  DesktopWindowStateStore,
  resolveWindowState,
  type ResolvedWindowState,
} from "./window-state";
import {
  desktopDeepLinkScheme,
  describeDeepLinkRejection,
  findDeepLinkInArgv,
  resolveDeepLink,
} from "./deep-links";
import { resolveUnreadBadge } from "./unread-badge";
import {
  describeLocalPartitionRefusal,
  resolveLocalPartitionActivation,
} from "./local-partition-activation";
import { LocalPartitionStore } from "./local-partition-store";
import {
  buildCertificateFileName,
  buildSupportBundleFileName,
} from "./download-naming";
import {
  observeNotifications,
  type NativeNotificationRequest,
} from "./native-notifications";
import { DesktopCloudAuthProxy } from "./cloud-auth-proxy";
import { LocalServerManager } from "./local-server-manager";
import {
  desktopIpcInvokeContracts,
  type DesktopIpcInvokeChannel,
} from "./ipc-contracts";
import { DesktopSecretsStore } from "./secrets-store";
import { DesktopSettingsStore } from "./settings-store";
import { exportSupportBundle } from "./support-bundle";
import { DesktopUpdater } from "./updater";
import {
  buildDesktopUserAgent,
  buildMainWindowOptions,
  desktopAppName,
  mainWindowSizeConstraints,
  desktopWindowIconPath,
  hideMainWindowMenu,
} from "./main-window";
import { getDesktopLogFilePath, installDesktopLogger } from "./desktop-log";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const windowStateStore = new DesktopWindowStateStore(app.getPath("userData"));
const localPartitionStore = new LocalPartitionStore(app.getPath("userData"));

/** The account and organization the running local server serves, if any. */
let activeLocalPartition: LocalDatabasePartition | null = null;

/**
 * The cloud endpoint the local server was started against. Captured once so a
 * partition switch restarts it against the same proxy rather than recomputing
 * a URL that may have moved.
 */
let localServerCloudOptions: {
  cloudApiUrl: string | null;
  cloudProxyToken: string | null;
  autoStartSync?: boolean;
} = { cloudApiUrl: null, cloudProxyToken: null };

type LocalPartitionActivationResult =
  | { status: "idle" }
  | {
      status: "active";
      partition: LocalDatabasePartition;
      /** The renderer must drop cached data when this is true. */
      switched: boolean;
    }
  | { status: "refused"; reason: string; message: string }
  | { status: "failed"; message: string };

/**
 * A link that arrived before the renderer could receive it — a cold launch,
 * or a second instance while the first is still booting. Held until the
 * renderer reports it is ready, then delivered once.
 */
let pendingDeepLinkPath: string | null = null;
let rendererReadyForDeepLinks = false;

/**
 * Notification ids the host has already accounted for this session. Reset on
 * quit only: it is a de-duplication set, not a record worth persisting, and
 * carrying it across launches would suppress the first announcement after an
 * update.
 */
/**
 * Announcement state, kept **per organization**. One session-global set would
 * mean switching from A to B leaves B already primed — so B's existing unread
 * backlog is announced as new, and a slow in-flight response for A can
 * overwrite B's badge afterwards.
 */
let notificationScope: {
  organizationKey: string;
  announcedIds: ReadonlySet<number>;
  primed: boolean;
  highWaterMarkId: number | null;
} | null = null;
const desktopAppScheme = "app";
const desktopAppHost = "calibra-facil";
// Cloud API and web origin this desktop build talks to, baked in at build time
// (see build-env.d.ts); runtime env vars below can still override them. An
// empty value (an unset CI variable) counts as unset.
const defaultCloudApiUrl =
  import.meta.env.VITE_DESKTOP_AUTH_API_URL || "http://localhost:3000";
const defaultCloudWebOrigin =
  import.meta.env.VITE_DESKTOP_AUTH_ORIGIN || "http://localhost:5173";
const packagedRendererUrl = `${desktopAppScheme}://${desktopAppHost}/`;
const localServer = new LocalServerManager();

let mainWindow: BrowserWindow | null = null;
let cloudAuthProxy: DesktopCloudAuthProxy | null = null;

app.setName(desktopAppName);
app.userAgentFallback = buildDesktopUserAgent(app.getVersion());

protocol.registerSchemesAsPrivileged([
  {
    scheme: desktopAppScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function rendererUrl() {
  if (!app.isPackaged) {
    return process.env.CALIBRA_DESKTOP_RENDERER_URL ?? "http://localhost:5173";
  }

  return packagedRendererUrl;
}

function cloudApiUrl() {
  return process.env.CALIBRA_DESKTOP_AUTH_API_URL ?? defaultCloudApiUrl;
}

function registerPackagedRendererProtocol() {
  if (!app.isPackaged) return;

  protocol.handle(desktopAppScheme, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== desktopAppHost) {
      return new Response("Not found", { status: 404 });
    }

    const rendererRoot = path.resolve(currentDir, "../renderer");
    const requestedPath =
      url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = path.resolve(rendererRoot, `.${requestedPath}`);

    if (!isPathInside(rendererRoot, filePath)) {
      return new Response("Not found", { status: 404 });
    }

    try {
      const bytes = await readFile(filePath);
      return new Response(bytes, {
        headers: {
          "Content-Type": contentTypeForPath(filePath),
        },
      });
    } catch (error) {
      if (!isRendererNavigationRequest(request, requestedPath)) {
        console.error("[desktop-renderer] packaged asset not found", {
          requestedPath,
          filePath,
          error: formatErrorMessage(error),
        });
        return new Response("Not found", { status: 404 });
      }

      try {
        const indexHtml = await readFile(path.join(rendererRoot, "index.html"));
        return new Response(indexHtml, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      } catch (indexError) {
        console.error("[desktop-renderer] packaged index not found", {
          rendererRoot,
          error: formatErrorMessage(indexError),
        });
        return new Response("Renderer not found", { status: 500 });
      }
    }
  });
}

function isPathInside(parentPath: string, childPath: string) {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function isRendererNavigationRequest(request: Request, requestedPath: string) {
  if (requestedPath === "/index.html") return true;

  const acceptHeader = request.headers.get("accept") ?? "";
  return acceptHeader.includes("text/html");
}

function contentTypeForPath(filePath: string) {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createWindow(restored: ResolvedWindowState) {
  const desktopUserAgent = buildDesktopUserAgent(app.getVersion());
  const window = new BrowserWindow(
    buildMainWindowOptions(
      path.join(currentDir, "../preload/preload.cjs"),
      desktopIconPath(),
      restored,
    ),
  );
  mainWindow = window;
  window.webContents.setUserAgent(desktopUserAgent);
  installRendererDiagnostics(window);
  hideMainWindowMenu(window);
  installWindowStatePersistence(window, restored);

  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow?.setTitle(desktopAppName);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  window
    .loadURL(rendererUrl(), {
      userAgent: desktopUserAgent,
    })
    .catch((error) => {
      console.error("[desktop-renderer] loadURL failed", {
        url: rendererUrl(),
        error: formatErrorMessage(error),
      });
    });
}

/**
 * Back/forward gestures the OS reports to the *window* rather than the page.
 *
 * Only the gestures: the keyboard shortcuts live in the renderer, because
 * deciding whether Alt+Left means "go back" or "previous word" requires
 * knowing whether a text field has focus, which the main process cannot see.
 *
 * The renderer owns the router history, so these are forwarded rather than
 * applied to `webContents` — driving both would produce two competing
 * histories.
 */
function installHistoryGestures(window: BrowserWindow) {
  const send = (command: "back" | "forward") => {
    if (window.isDestroyed()) return;
    window.webContents.send(desktopIpcChannels.historyCommand, command);
  };

  // Windows: mouse thumb buttons arrive as app commands.
  window.on("app-command", (event, command) => {
    if (command === "browser-backward") {
      event.preventDefault();
      send("back");
    } else if (command === "browser-forward") {
      event.preventDefault();
      send("forward");
    }
  });

  // macOS: three-finger trackpad swipe, when the system gesture is enabled.
  // The reported direction is the physical finger movement, while the
  // platform convention is swipe *right* to go back — as in Safari and
  // Finder. Mapping them directly navigated the wrong way every time.
  window.on("swipe", (_event, direction) => {
    if (direction === "right") send("back");
    else if (direction === "left") send("forward");
  });
}

/**
 * Restore the saved window state and keep it up to date.
 *
 * Order matters: maximize/fullscreen are applied *after* the normal bounds are
 * set, so unmaximizing later returns the window to the size it had rather than
 * to the platform default. And the window is only shown once it is positioned,
 * otherwise the user watches it appear at the default size and jump.
 */
function installWindowStatePersistence(
  window: BrowserWindow,
  restored: ResolvedWindowState,
) {
  if (restored.maximized) window.maximize();
  if (restored.fullScreen) window.setFullScreen(true);

  window.once("ready-to-show", () => window.show());
  installHistoryGestures(window);

  // A reload tears down the renderer's listener. Until it re-announces, links
  // must go back to the buffer rather than into a window that cannot hear
  // them.
  window.webContents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      // Only a real document load tears down the renderer's subscription. A
      // TanStack route or hash transition is in-place and keeps it — clearing
      // readiness there stranded every later deep link in the buffer, because
      // the still-mounted subscription never re-announces.
      if (isMainFrame && !isInPlace) rendererReadyForDeepLinks = false;
    },
  );

  const capture = () => {
    if (window.isDestroyed()) return;

    void windowStateStore.save({
      // `getNormalBounds` is the restore geometry: while maximized,
      // `getBounds` returns the whole screen, which would make "unmaximize" a
      // no-op on the next launch.
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
    });
  };

  // Listed one by one: Electron's overloads type each event name separately,
  // so a loop over a union collapses to the first overload's signature.
  window.on("resized", capture);
  window.on("moved", capture);
  window.on("maximize", capture);
  window.on("unmaximize", capture);
  window.on("enter-full-screen", capture);
  window.on("leave-full-screen", capture);

  // `close`, not `closed`: the window must still be alive to be measured.
  window.on("close", capture);
}

function desktopIconPath() {
  return desktopWindowIconPath(path.resolve(currentDir, "../../assets"));
}

function installRendererDiagnostics(window: BrowserWindow) {
  window.webContents.on("did-fail-load", (_event, ...details) => {
    const [errorCode, errorDescription, validatedURL, isMainFrame] = details;
    console.error("[desktop-renderer] did-fail-load", {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });

  window.webContents.on("did-finish-load", () => {
    console.log("[desktop-renderer] did-finish-load", {
      url: window.webContents.getURL(),
    });
  });

  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("[desktop-renderer] preload-error", {
      preloadPath,
      error: formatErrorMessage(error),
    });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[desktop-renderer] render-process-gone", details);
  });

  window.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      if (!message) return;

      const payload = {
        level,
        message,
        line,
        sourceId,
      };
      if (level >= 3) {
        console.error("[desktop-renderer] console", payload);
      } else if (level >= 2) {
        console.warn("[desktop-renderer] console", payload);
      } else {
        console.log("[desktop-renderer] console", payload);
      }
    },
  );
}

function assertTrustedSender(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url ?? "";
  const allowed =
    url.startsWith(`${desktopAppScheme}://${desktopAppHost}/`) ||
    trustedRendererOrigins().some((origin) => url.startsWith(origin));

  if (!allowed) {
    throw new Error(`Blocked IPC call from untrusted sender: ${url}`);
  }
}

function trustedRendererOrigins() {
  const origins = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
  const configured = process.env.CALIBRA_DESKTOP_RENDERER_URL;

  if (configured) {
    try {
      origins.add(new URL(configured).origin);
    } catch {
      // Invalid renderer URLs fail later in BrowserWindow.loadURL.
    }
  }

  return [...origins];
}

function handle(
  channel: DesktopIpcInvokeChannel,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    const contract = desktopIpcInvokeContracts[channel];
    const parsedArgs = contract.args.parse(args);
    return contract.response.parse(await listener(event, ...parsedArgs));
  });
}

function broadcast(channel: string, payload: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

async function broadcastSyncStatus() {
  broadcast(
    desktopIpcChannels.syncStatusChanged,
    syncStatusSnapshotSchema.parse(await getLocalSyncStatus()),
  );
}

async function broadcastSyncingStatus() {
  const current = await getLocalSyncStatus();
  broadcast(
    desktopIpcChannels.syncStatusChanged,
    syncStatusSnapshotSchema.parse({
      ...current,
      state: "syncing",
    }),
  );
}

function registerIpc(
  settingsStore: DesktopSettingsStore,
  secretsStore: DesktopSecretsStore,
  updater: DesktopUpdater,
) {
  handle(desktopIpcChannels.authFetch, (_event, request) =>
    desktopAuthFetch(request),
  );

  handle(desktopIpcChannels.getAppInfo, () =>
    appInfoSchema.parse({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
    }),
  );

  handle(desktopIpcChannels.getLocalEnvironmentBootstrap, () =>
    getCurrentLocalEnvironmentBootstrap(),
  );

  handle(desktopIpcChannels.getSettings, () => settingsStore.get());

  handle(desktopIpcChannels.setSettings, (_event, patch) =>
    settingsStore.update(patch),
  );

  handle(desktopIpcChannels.getSecretStatuses, () =>
    secretsStore.getStatuses(),
  );

  handle(desktopIpcChannels.setSecret, (_event, secret) =>
    secretsStore.set(desktopSecretWriteSchema.parse(secret)),
  );

  handle(desktopIpcChannels.deleteSecret, (_event, name) =>
    secretsStore.delete(desktopSecretNameSchema.parse(name)),
  );

  handle(desktopIpcChannels.getSyncState, async () => {
    return (await getLocalSyncStatus()).state;
  });

  handle(desktopIpcChannels.getSyncStatus, () => getLocalSyncStatus());

  handle(desktopIpcChannels.startSync, async () => {
    await broadcastSyncingStatus();
    const result = await postLocalSyncAction("/api/local/sync/start");
    await broadcastSyncStatus();
    return result;
  });
  handle(desktopIpcChannels.pauseSync, async () => {
    const result = await postLocalSyncAction("/api/local/sync/pause");
    await broadcastSyncStatus();
    return result;
  });
  handle(desktopIpcChannels.resumeSync, async () => {
    const result = await postLocalSyncAction("/api/local/sync/resume");
    await broadcastSyncStatus();
    return result;
  });
  handle(desktopIpcChannels.wakeSync, async (_event, trigger) => {
    const result = await wakeLocalSync(syncTriggerSchema.parse(trigger));
    await broadcastSyncStatus();
    return result;
  });
  handle(desktopIpcChannels.activateLocalPartition, async (_event, input) => {
    return activateLocalPartition(
      localPartitionActivationRequestSchema.parse(input),
    );
  });
  handle(desktopIpcChannels.deepLinkReady, () => {
    rendererReadyForDeepLinks = true;
    flushPendingDeepLink();
    return true;
  });
  handle(desktopIpcChannels.publishNotifications, (_event, payload) => {
    const published = desktopNotificationsPublishSchema.parse(payload);

    // A response that arrives after the user has already switched scope is
    // stale: applying its badge or announcing its rows would attribute one
    // organization's work to another.
    if (
      notificationScope &&
      notificationScope.organizationKey !== published.organizationKey
    ) {
      notificationScope = null;
    }

    const scope = notificationScope ?? {
      organizationKey: published.organizationKey,
      announcedIds: new Set<number>(),
      primed: false,
      highWaterMarkId: published.highWaterMarkId,
    };

    applyUnreadBadge(published.unreadCount);

    const decision = observeNotifications({
      entries: published.entries,
      seen: scope.announcedIds,
      primed: scope.primed,
      highWaterMarkId: scope.highWaterMarkId,
      windowFocused: mainWindow?.isFocused() ?? false,
    });

    notificationScope = {
      organizationKey: published.organizationKey,
      announcedIds: decision.seen,
      primed: true,
      highWaterMarkId: scope.highWaterMarkId,
    };

    for (const request of decision.deliver) {
      presentNativeNotification(request);
    }

    return true;
  });
  handle(desktopIpcChannels.retrySync, async () => {
    await broadcastSyncingStatus();
    const result = await postLocalSyncAction("/api/local/sync/retry");
    await broadcastSyncStatus();
    return result;
  });

  handle(desktopIpcChannels.pickFile, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle(desktopIpcChannels.pickFolder, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle(desktopIpcChannels.saveFile, async () => {
    const result = await dialog.showSaveDialog({});
    return result.canceled ? null : (result.filePath ?? null);
  });

  handle(desktopIpcChannels.saveCertificatePdf, async (_event, input) => {
    const request = certificatePdfExportRequestSchema.parse(input);
    const filePath = await chooseCertificatePdfPath(request);
    // Cancelling is an ordinary outcome, not a failure: `null` all the way up,
    // so the renderer shows nothing rather than an error toast.
    if (!filePath) return null;

    await saveLocalCertificatePdf(request.jobId, filePath);
    rememberDownloadDirectory(filePath);
    return filePath;
  });

  handle(desktopIpcChannels.revealFile, async (_event, filePath) => {
    if (typeof filePath !== "string" || filePath.length === 0) return false;

    // A path saved earlier in the session may have been moved or deleted since.
    try {
      await stat(filePath);
    } catch {
      return false;
    }

    shell.showItemInFolder(filePath);
    return true;
  });

  handle(desktopIpcChannels.openExternal, async (_event, url) => {
    if (typeof url !== "string") return false;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return false;
    await shell.openExternal(parsed.toString());
    return true;
  });

  handle(desktopIpcChannels.exportSupportBundle, async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(downloadDirectory(), buildSupportBundleFileName()),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;

    rememberDownloadDirectory(result.filePath);

    return exportSupportBundle({
      filePath: result.filePath,
      desktopLogFilePath: getDesktopLogFilePath(),
      rendererBuildManifestPath: path.join(
        currentDir,
        "../renderer/calibra-renderer-build.json",
      ),
      localEnvironment: localServer.bootstrap,
      localRuntime: localServer.runtime,
      syncStatus: await getLocalSyncStatus(),
      localDiagnostics: await getLocalDiagnostics(),
      updateState: updater.getState(),
      settingsStore,
      secretsStore,
    });
  });

  handle(desktopIpcChannels.getUpdateState, () =>
    desktopUpdateStateSchema.parse(updater.getState()),
  );

  handle(desktopIpcChannels.checkForUpdate, () => updater.checkForUpdate());
  handle(desktopIpcChannels.downloadUpdate, () => updater.downloadUpdate());
  handle(desktopIpcChannels.installUpdate, () => updater.installUpdate());
}

async function desktopAuthFetch(
  input: unknown,
): Promise<DesktopAuthFetchResponse> {
  const request = desktopAuthFetchRequestSchema.parse(input);
  const url = new URL(request.url);
  assertAllowedDesktopAuthUrl(url);

  const headers = createDesktopAuthHeaders(request.headers);
  const authOrigin = getDesktopAuthOrigin(url);
  headers.set("Origin", authOrigin);
  headers.set("Referer", `${authOrigin}/`);

  const cookieHeader = await getDesktopAuthCookieHeader(url);
  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }

  const fetchInit: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.body && request.method !== "GET" && request.method !== "HEAD") {
    fetchInit.body = decodeDesktopAuthFetchBody(request.body);
  }

  const response = await fetch(url, fetchInit);
  await persistDesktopAuthCookies(url, readSetCookieHeaders(response.headers));

  return desktopAuthFetchResponseSchema.parse({
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()].filter(
      ([name]) => name.toLowerCase() !== "set-cookie",
    ),
    body: await response.text(),
  });
}

function decodeDesktopAuthFetchBody(
  body: NonNullable<DesktopAuthFetchRequest["body"]>,
) {
  if (typeof body === "string") {
    return body;
  }

  return Buffer.from(body.data, "base64");
}

function assertAllowedDesktopAuthUrl(url: URL) {
  const configuredApiUrl = process.env.CALIBRA_DESKTOP_AUTH_API_URL;
  const configuredOrigin = configuredApiUrl
    ? safeUrlOrigin(configuredApiUrl)
    : null;
  const defaultOrigin = safeUrlOrigin(defaultCloudApiUrl);
  const allowedOrigins = new Set([
    ...(defaultOrigin ? [defaultOrigin] : []),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...(configuredOrigin ? [configuredOrigin] : []),
  ]);

  if (!allowedOrigins.has(url.origin)) {
    throw new Error(
      `Blocked desktop API request to untrusted origin: ${url.origin}`,
    );
  }

  if (!url.pathname.startsWith("/api/")) {
    throw new Error(
      `Blocked desktop API request to unsupported path: ${url.pathname}`,
    );
  }
}

function safeUrlOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getDesktopAuthOrigin(url: URL) {
  const configuredOrigin = process.env.CALIBRA_DESKTOP_AUTH_ORIGIN
    ? safeUrlOrigin(process.env.CALIBRA_DESKTOP_AUTH_ORIGIN)
    : null;

  if (configuredOrigin) {
    return configuredOrigin;
  }

  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return safeUrlOrigin(rendererUrl()) ?? "http://localhost:5173";
  }

  return defaultCloudWebOrigin;
}

function createDesktopAuthHeaders(entries: Array<[string, string]>) {
  const headers = new Headers();
  const blockedHeaders = new Set([
    "connection",
    "content-length",
    "cookie",
    "host",
    "origin",
    "referer",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "user-agent",
  ]);

  for (const [name, value] of entries) {
    const lowerName = name.toLowerCase();
    if (blockedHeaders.has(lowerName) || lowerName.startsWith("sec-ch-")) {
      continue;
    }

    headers.set(name, value);
  }

  return headers;
}

async function getDesktopAuthCookieHeader(url: URL) {
  const cookies = await electronSession.defaultSession.cookies.get({
    url: url.origin,
  });

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function readSetCookieHeaders(headers: Headers) {
  if ("getSetCookie" in headers && typeof headers.getSetCookie === "function") {
    const cookies = headers.getSetCookie();
    if (Array.isArray(cookies)) {
      return cookies.filter((cookie) => typeof cookie === "string");
    }
  }

  return splitSetCookieHeader(headers.get("set-cookie"));
}

function splitSetCookieHeader(header: string | null) {
  if (!header) return [];

  const cookies: string[] = [];
  let start = 0;
  let inExpires = false;

  for (let index = 0; index < header.length; index += 1) {
    const rest = header.slice(index).toLowerCase();
    if (rest.startsWith("expires=")) {
      inExpires = true;
    }

    if (inExpires && header[index] === ";") {
      inExpires = false;
    }

    if (
      header[index] === "," &&
      !inExpires &&
      /\s*[^=;,]+=[^;,]+/.test(header.slice(index + 1))
    ) {
      cookies.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }

  cookies.push(header.slice(start).trim());
  return cookies.filter(Boolean);
}

async function persistDesktopAuthCookies(url: URL, setCookieHeaders: string[]) {
  await Promise.all(
    setCookieHeaders.map((header) => persistDesktopAuthCookie(url, header)),
  );
}

async function persistDesktopAuthCookie(url: URL, header: string) {
  const parsed = parseSetCookie(header);
  if (!parsed) return;

  if (parsed.deleteCookie) {
    await electronSession.defaultSession.cookies.remove(
      url.origin,
      parsed.name,
    );
    return;
  }

  await electronSession.defaultSession.cookies.set({
    url: url.origin,
    name: parsed.name,
    value: parsed.value,
    domain: parsed.domain,
    path: parsed.path,
    secure: parsed.secure,
    httpOnly: parsed.httpOnly,
    expirationDate: parsed.expirationDate,
    sameSite: parsed.sameSite,
  });
}

function parseSetCookie(header: string) {
  const [nameValue, ...attributes] = header
    .split(";")
    .map((part) => part.trim());
  if (!nameValue) return null;

  const separatorIndex = nameValue.indexOf("=");
  if (separatorIndex <= 0) return null;

  const parsed: {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    expirationDate?: number;
    sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
    deleteCookie?: boolean;
  } = {
    name: nameValue.slice(0, separatorIndex),
    value: nameValue.slice(separatorIndex + 1),
  };

  for (const attribute of attributes) {
    const [rawName, ...rawValueParts] = attribute.split("=");
    if (!rawName) continue;

    const attributeName = rawName.toLowerCase();
    const attributeValue = rawValueParts.join("=");

    if (attributeName === "domain" && attributeValue) {
      parsed.domain = attributeValue;
    } else if (attributeName === "path" && attributeValue) {
      parsed.path = attributeValue;
    } else if (attributeName === "secure") {
      parsed.secure = true;
    } else if (attributeName === "httponly") {
      parsed.httpOnly = true;
    } else if (attributeName === "max-age") {
      const maxAge = Number(attributeValue);
      if (Number.isFinite(maxAge)) {
        parsed.deleteCookie = maxAge <= 0;
        parsed.expirationDate = Math.floor(Date.now() / 1000 + maxAge);
      }
    } else if (attributeName === "expires" && attributeValue) {
      const expiresAt = Date.parse(attributeValue);
      if (Number.isFinite(expiresAt)) {
        parsed.deleteCookie = expiresAt <= Date.now();
        parsed.expirationDate = Math.floor(expiresAt / 1000);
      }
    } else if (attributeName === "samesite") {
      const sameSite = attributeValue.toLowerCase();
      if (sameSite === "none") {
        parsed.sameSite = "no_restriction";
      } else if (sameSite === "lax" || sameSite === "strict") {
        parsed.sameSite = sameSite;
      }
    }
  }

  return parsed;
}

async function getLocalSyncStatus() {
  try {
    const response = await fetch(
      `${localServer.baseUrl}/api/local/sync/status`,
      {
        headers: createLocalApiHeaders(),
      },
    );
    if (!response.ok) {
      throw new Error(`Local sync status failed with HTTP ${response.status}`);
    }

    return syncStatusSnapshotSchema.parse(await response.json());
  } catch {
    return syncStatusSnapshotSchema.parse({
      state: localServer.bootstrap?.syncState ?? "offline",
      pendingOutboxCount: 0,
      conflictCount: 0,
      lastSyncedAt: null,
    });
  }
}

async function getLocalDiagnostics() {
  try {
    const response = await fetch(
      `${localServer.baseUrl}/api/local/diagnostics`,
      {
        headers: createLocalApiHeaders(),
      },
    );
    if (!response.ok) {
      throw new Error(`Local diagnostics failed with HTTP ${response.status}`);
    }

    return localDiagnosticsSchema.parse(await response.json());
  } catch {
    return null;
  }
}

async function getCurrentLocalEnvironmentBootstrap() {
  if (!localServer.bootstrap) return null;

  try {
    const response = await fetch(
      `${localServer.baseUrl}/.well-known/calibra/local-environment`,
      {
        headers: createLocalApiHeaders(),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Local environment bootstrap failed with HTTP ${response.status}`,
      );
    }

    return localEnvironmentBootstrapSchema.parse({
      ...(await response.json()),
      localApiToken: localServer.bootstrap.localApiToken,
    });
  } catch {
    return localServer.bootstrap;
  }
}

/**
 * Tell the local server that the world outside changed. The scheduler
 * coalesces, so this is fire-and-forget from the host's point of view: two
 * wakes in the same second are one sync, and a wake while a sync is running
 * queues exactly one follow-up.
 */
async function wakeLocalSync(trigger: SyncTrigger) {
  try {
    const response = await fetch(`${localServer.baseUrl}/api/local/sync/wake`, {
      method: "POST",
      headers: createLocalApiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ trigger }),
    });

    if (!response.ok) {
      return syncActionResultSchema.parse({
        ok: false,
        message: `Local sync wake failed with HTTP ${response.status}.`,
      });
    }

    return syncActionResultSchema.parse({ ok: true });
  } catch (error) {
    return syncActionResultSchema.parse({
      ok: false,
      message:
        error instanceof Error ? error.message : "Local sync wake failed.",
    });
  }
}

async function postLocalSyncAction(pathname: string) {
  try {
    const response = await fetch(`${localServer.baseUrl}${pathname}`, {
      method: "POST",
      headers: createLocalApiHeaders(),
    });
    const result = syncActionResultSchema.parse(await response.json());

    if (!response.ok && result.ok) {
      return syncActionResultSchema.parse({
        ok: false,
        message: `Local sync action failed with HTTP ${response.status}.`,
      });
    }

    return result;
  } catch (error) {
    return syncActionResultSchema.parse({
      ok: false,
      message:
        error instanceof Error ? error.message : "Local sync action failed.",
    });
  }
}

function createLocalApiHeaders(init?: HeadersInit) {
  const headers = new Headers(init);
  const token = localServer.bootstrap?.localApiToken;

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

async function chooseCertificatePdfPath(request: {
  jobId: string | number;
  certificateNumber?: string | null;
  customerName?: string | null;
}) {
  const result = await dialog.showSaveDialog({
    defaultPath: path.join(
      downloadDirectory(),
      buildCertificateFileName({
        jobId: request.jobId,
        certificateNumber: request.certificateNumber,
        customerName: request.customerName,
      }),
    ),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });

  return result.canceled ? null : (result.filePath ?? null);
}

/**
 * Where the next save dialog opens. Labs save certificate after certificate
 * into the same folder, so re-opening in the OS downloads directory every time
 * makes the operator navigate on every single export.
 *
 * Session-scoped on purpose: persisting it would mean restoring a path that
 * may since have been a removable drive or a disconnected share.
 */
let lastDownloadDirectory: string | null = null;

function downloadDirectory() {
  return lastDownloadDirectory ?? app.getPath("downloads");
}

function rememberDownloadDirectory(filePath: string) {
  lastDownloadDirectory = path.dirname(filePath);
}

async function saveLocalCertificatePdf(
  jobId: string | number,
  filePath: string,
) {
  if (!localServer.baseUrl) {
    throw new Error("Local server is not ready.");
  }

  const routeId = encodeURIComponent(String(jobId));
  const draftResponse = await fetch(
    `${localServer.baseUrl}/api/jobs/${routeId}/certificate-draft`,
    {
      method: "POST",
      headers: createLocalApiHeaders(),
    },
  );

  if (!draftResponse.ok) {
    throw new Error(
      `Local certificate draft failed with HTTP ${draftResponse.status}.`,
    );
  }
  const draft: unknown = await draftResponse.json();
  const draftId =
    draft && typeof draft === "object" && !Array.isArray(draft)
      ? Object.fromEntries(Object.entries(draft)).id
      : null;
  if (typeof draftId !== "string" || draftId.length === 0) {
    throw new Error("Local certificate draft response is missing an id.");
  }

  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await pdfWindow.loadURL(
      `${localServer.baseUrl}/api/jobs/${routeId}/certificate-draft/file`,
      {
        extraHeaders: localApiExtraHeaders(),
      },
    );
    const pdf = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
    });
    await persistLocalCertificatePdf(jobId, draftId, pdf);
    await writeFile(filePath, pdf);
  } finally {
    pdfWindow.destroy();
  }
}

async function persistLocalCertificatePdf(
  jobId: string | number,
  draftId: string,
  pdf: Uint8Array,
) {
  const response = await fetch(
    `${localServer.baseUrl}/api/jobs/${encodeURIComponent(
      String(jobId),
    )}/certificate-draft/${encodeURIComponent(draftId)}/pdf`,
    {
      method: "POST",
      headers: createLocalApiHeaders({ "Content-Type": "application/pdf" }),
      body: toArrayBuffer(pdf),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Local certificate PDF storage failed with HTTP ${response.status}.`,
    );
  }
}

function localApiExtraHeaders() {
  const token = localServer.bootstrap?.localApiToken;
  return token ? `Authorization: Bearer ${token}` : "";
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/**
 * Single instance. Without the lock, opening a `calibrafacil://` link while
 * the app is running starts a *second* copy — which then races the first for
 * the local server port and the SQLite file. The lock makes the running
 * instance the one that handles the link.
 */
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    focusMainWindow();
    const link = findDeepLinkInArgv(argv);
    if (link) handleDeepLink(link);
  });

  // macOS delivers links through this event instead of argv, both cold and
  // warm. It can fire before `whenReady`, which is why the handler buffers.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    focusMainWindow();
    handleDeepLink(url);
  });
}

function registerDeepLinkScheme() {
  // Packaged builds get the registration from the installer (see
  // electron-builder.yml). This covers `pnpm dev:desktop`, where there is no
  // installer to do it, and is a no-op when the registration already exists.
  if (process.defaultApp) {
    const [entryScript] = process.argv.slice(1);
    if (entryScript) {
      app.setAsDefaultProtocolClient(desktopDeepLinkScheme, process.execPath, [
        path.resolve(entryScript),
      ]);
      return;
    }
  }

  app.setAsDefaultProtocolClient(desktopDeepLinkScheme);
}

function handleDeepLink(rawUrl: string) {
  const resolved = resolveDeepLink(rawUrl);

  if (!resolved.ok) {
    // Logged, never surfaced as a dialog: an unsolicited link from a hostile
    // page must not be able to interrupt the operator with a modal.
    console.warn("[desktop-deep-link] rejected", {
      reason: resolved.reason,
      message: describeDeepLinkRejection(resolved.reason),
    });
    return;
  }

  deliverDeepLinkPath(resolved.path);
}

/**
 * Send an already-validated route path to the renderer, or hold it until one
 * is listening.
 *
 * Separate from `handleDeepLink` so internal re-delivery — flushing the
 * buffer, a notification click — does not re-run untrusted-input validation on
 * a path that already passed it. Joined, a future tightening of
 * `resolveDeepLink` could break delivery of data that never came from outside.
 */
function deliverDeepLinkPath(path: string) {
  if (!rendererReadyForDeepLinks || !mainWindow || mainWindow.isDestroyed()) {
    pendingDeepLinkPath = path;
    return;
  }

  mainWindow.webContents.send(desktopIpcChannels.deepLinkRequested, path);
}

function flushPendingDeepLink() {
  const pending = pendingDeepLinkPath;
  pendingDeepLinkPath = null;
  if (pending) deliverDeepLinkPath(pending);
}

/**
 * macOS and Linux take a numeric badge; Windows only takes a 16x16 taskbar
 * overlay, which carries presence rather than a count. `resolveUnreadBadge`
 * owns that decision so it can be tested without Electron.
 */
function applyUnreadBadge(unreadCount: number) {
  const effect = resolveUnreadBadge(unreadCount, process.platform);

  if (effect.kind === "count") {
    app.setBadgeCount(effect.count);
    return;
  }

  if (effect.kind === "overlay") {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (!effect.visible) {
      mainWindow.setOverlayIcon(null, "");
      return;
    }

    const overlay = nativeImage.createFromPath(
      path.resolve(currentDir, "../../assets/notification-overlay.png"),
    );
    // A missing or unreadable asset must not throw inside an IPC handler.
    if (overlay.isEmpty()) return;

    mainWindow.setOverlayIcon(overlay, effect.description);
  }
}

function presentNativeNotification(request: NativeNotificationRequest) {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: request.title,
    body: request.body,
  });

  notification.on("click", () => {
    focusMainWindow();
    if (!request.actionPath) return;

    // Buffered like an OS deep link, so a click during a reload is not lost.
    // The path was already validated when the notification was built.
    deliverDeepLinkPath(request.actionPath);
  });

  notification.show();
}

/**
 * Open the local database belonging to a verified identity, closing whatever
 * was open before.
 *
 * The order is the point, and it is the order a switch has to happen in:
 *
 * 1. decide, from the activation policy — never from the caller's assertion;
 * 2. pause continuous sync and let the run in flight finish, so no push lands
 *    under the outgoing account's credentials after the switch begins;
 * 3. stop the local server, which closes its database;
 * 4. start it on the incoming partition, which derives its own path and
 *    verifies the ownership record inside the file before serving a route;
 * 5. remember the grant, so this identity — and only this one — can open
 *    offline next time.
 *
 * The outgoing account's database is left exactly as it was. Its queued field
 * work is not deleted, not migrated, and never uploaded under the incoming
 * account's credentials; it waits for its owner to authenticate again.
 */
function activateLocalPartition(input: {
  partition: LocalDatabasePartition | null;
  identityVerified: boolean;
}): Promise<LocalPartitionActivationResult> {
  // Strictly one at a time. Two activations overlapping — switching
  // organization while the gate is still pending is enough — would race over
  // which database is open and which partition is recorded as active.
  const queued = activationQueue
    .catch(() => undefined)
    .then(() => activateLocalPartitionOnce(input));

  activationQueue = queued.then(
    () => undefined,
    () => undefined,
  );

  return queued;
}

let activationQueue: Promise<unknown> = Promise.resolve();

async function activateLocalPartitionOnce(input: {
  partition: LocalDatabasePartition | null;
  identityVerified: boolean;
}): Promise<LocalPartitionActivationResult> {
  const decision = resolveLocalPartitionActivation({
    requested: input.partition,
    identityVerified: input.identityVerified,
    running: activeLocalPartition,
    remembered: (await localPartitionStore.load())?.partition ?? null,
  });

  if (decision.action === "idle") {
    return { status: "idle" };
  }

  if (decision.action === "refuse") {
    console.warn("[desktop-partition] refused", { reason: decision.reason });
    return {
      status: "refused",
      reason: decision.reason,
      message: describeLocalPartitionRefusal(decision.reason),
    };
  }

  if (decision.action === "reuse") {
    return { status: "active", partition: decision.partition, switched: false };
  }

  const target =
    decision.action === "switch" ? decision.to : decision.partition;

  // A `start` decision does not mean nothing is running. On first launch — or
  // after an upgrade, when no grant exists yet — startup may already have
  // opened the *unpartitioned* database while `activeLocalPartition` stayed
  // null. `LocalServerManager.start()` short-circuits on a ready server, so
  // without stopping it first the host would report the target as active while
  // still serving the shared file: the original cross-account exposure,
  // preserved exactly where it is least expected.
  // Anything other than fully stopped has to be torn down, not just "ready".
  // A start already in flight is the dangerous case: `LocalServerManager.start`
  // returns its cached promise and ignores the new options, so the host would
  // record the incoming partition as active while the server finishes opening
  // the previous one's database.
  const serverNeedsRestart = localServer.state !== "stopped";
  const switched = decision.action === "switch" || serverNeedsRestart;

  if (switched) {
    await quiesceLocalSync();
    localServer.stop();
  }

  try {
    await localServer.start({
      ...localServerCloudOptions,
      partition: target,
    });
  } catch (error) {
    activeLocalPartition = null;
    // Leave nothing running. Without this the manager keeps respawning a
    // configuration that cannot start, and its restart timer can later abort
    // an otherwise healthy activation.
    localServer.stop();
    console.error("[desktop-partition] failed to open partition", {
      error: formatErrorMessage(error),
    });

    return {
      status: "failed",
      message:
        "Não foi possível abrir os dados locais desta conta neste computador.",
    };
  }

  activeLocalPartition = target;

  // Only an online-verified activation grants offline access. An offline start
  // is *using* a grant, not issuing one.
  if (decision.action === "switch" || !decision.offline) {
    await localPartitionStore.remember(target);
  }

  await broadcastSyncStatus();

  return { status: "active", partition: target, switched };
}

/**
 * Stop the sync loop and wait for the run in flight. Pausing alone would let
 * an in-progress push finish *after* the database it was reading has been
 * closed and replaced.
 */
async function quiesceLocalSync() {
  await postLocalSyncAction("/api/local/sync/pause");

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await getLocalSyncStatus();
    if (status.scheduler?.syncing !== true) return;

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  console.warn("[desktop-partition] sync did not settle before switching");
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

app.whenReady().then(async () => {
  installDesktopLogger();
  registerDeepLinkScheme();
  // Electron: on Linux the badge is bound to the app's .desktop file, and does
  // nothing at all unless the name matches. `executableName` in
  // electron-builder.yml produces calibrafacil.desktop.
  if (process.platform === "linux") {
    app.setDesktopName("calibrafacil.desktop");
  }
  registerPackagedRendererProtocol();
  const settingsStore = new DesktopSettingsStore(app.getPath("userData"));
  const secretsStore = new DesktopSecretsStore(app.getPath("userData"));
  await settingsStore.load();
  await secretsStore.load();
  const updater = new DesktopUpdater({
    settingsStore,
    getSyncStatus: getLocalSyncStatus,
    getLocalDiagnostics,
    beforeInstall: () => localServer.stop(),
    onStateChange: (state) => {
      broadcast(
        desktopIpcChannels.updateStateChanged,
        desktopUpdateStateSchema.parse(state),
      );
    },
  });
  registerIpc(settingsStore, secretsStore, updater);
  cloudAuthProxy = new DesktopCloudAuthProxy({
    targetBaseUrl: cloudApiUrl(),
    authFetch: desktopAuthFetch,
  });
  let cloudProxyUrl = cloudApiUrl();
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
  localServerCloudOptions = {
    cloudApiUrl: cloudProxyUrl,
    cloudProxyToken,
    autoStartSync: desktopSettings.autoStartSync,
  };

  // Offline start: open the partition this device last authorized, and only
  // that one. A different account has to sign in online first.
  const rememberedPartition =
    (await localPartitionStore.load())?.partition ?? null;

  if (app.isPackaged && !rememberedPartition) {
    // Nothing to open until someone signs in. Spawning an unpartitioned
    // server here would create a database belonging to nobody, and the
    // restart logic would retry a configuration that cannot succeed.
    console.log("[desktop-startup] no authorized partition; local server idle");
    await broadcastSyncStatus();
  } else {
    try {
      await localServer.start({
        ...localServerCloudOptions,
        partition: rememberedPartition,
      });
      activeLocalPartition = rememberedPartition;
    } catch (error) {
      console.error("[desktop-startup] local server failed to start", {
        error: formatErrorMessage(error),
      });
    }

    await broadcastSyncStatus();
  }

  registerSyncWakeTriggers();
  createWindow(await resolveMainWindowState());

  // Windows and Linux deliver a cold-launch link in argv; macOS already
  // queued it through `open-url`.
  const launchLink = findDeepLinkInArgv(process.argv);
  if (launchLink) handleDeepLink(launchLink);
});

async function resolveMainWindowState() {
  return resolveWindowState({
    saved: await windowStateStore.load(),
    displays: screen.getAllDisplays(),
    constraints: mainWindowSizeConstraints,
  });
}

/**
 * Host-level reasons to sync that the local server cannot observe on its own.
 *
 * A technician who finishes work on a train, closes the lid, and opens it at
 * the lab gets `resume`; the OS network stack coming back gets `online`. Both
 * are coalesced by the scheduler, so a flapping connection produces one sync,
 * not one per event.
 */
function registerSyncWakeTriggers() {
  powerMonitor.on("resume", () => {
    void wakeLocalSync("reconnect");
  });

  // `unlock-screen` is not emitted on every platform; Electron ignores an
  // unknown listener rather than throwing, so no platform branch is needed.
  powerMonitor.on("unlock-screen", () => {
    void wakeLocalSync("reconnect");
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

let windowStateFlushed = false;

app.on("before-quit", (event) => {
  cloudAuthProxy?.stop();
  cloudAuthProxy = null;
  localServer.stop();

  // The window's own `close` handler queues the final capture *after* this
  // runs, and `void flush()` would not delay shutdown anyway — so the newest
  // geometry could be lost on quit. Defer the quit once, let the close
  // captures land, then flush and quit for real.
  if (windowStateFlushed) return;

  event.preventDefault();
  void (async () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.close();
    }

    await windowStateStore.flush();
    windowStateFlushed = true;
    app.quit();
  })();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void resolveMainWindowState().then(createWindow);
  }
});
