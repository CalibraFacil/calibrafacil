import path from "node:path";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
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
  type DesktopAuthFetchRequest,
  type DesktopAuthFetchResponse,
} from "@calibra-facil/contracts";
import { desktopIpcChannels } from "./channels";
import { DesktopCloudAuthProxy } from "./cloud-auth-proxy";
import { LocalServerManager } from "./local-server-manager";
import {
  desktopIpcInvokeContracts,
  type DesktopIpcInvokeChannel,
} from "./ipc-contracts";
import { DesktopSecretsStore } from "./secrets-store";
import { DesktopSettingsStore } from "./settings-store";
import {
  defaultSupportBundlePath,
  exportSupportBundle,
} from "./support-bundle";
import { DesktopUpdater } from "./updater";
import { buildMainWindowOptions, hideMainWindowMenu } from "./main-window";
import { getDesktopLogFilePath, installDesktopLogger } from "./desktop-log";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopAppScheme = "app";
const desktopAppHost = "calibra-facil";
const defaultCloudApiUrl = "https://api.calibrafacil.com";
const packagedRendererUrl = `${desktopAppScheme}://${desktopAppHost}/index.html`;
const localServer = new LocalServerManager();

let mainWindow: BrowserWindow | null = null;
let cloudAuthProxy: DesktopCloudAuthProxy | null = null;

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

    const rendererRoot = path.join(__dirname, "../renderer");
    const requestedPath =
      url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = path.resolve(rendererRoot, `.${requestedPath}`);

    if (!filePath.startsWith(rendererRoot)) {
      return new Response("Not found", { status: 404 });
    }

    try {
      const bytes = await readFile(filePath);
      return new Response(bytes, {
        headers: {
          "Content-Type": contentTypeForPath(filePath),
        },
      });
    } catch {
      const indexHtml = await readFile(path.join(rendererRoot, "index.html"));
      return new Response(indexHtml, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }
  });
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

function createWindow() {
  mainWindow = new BrowserWindow(
    buildMainWindowOptions(path.join(__dirname, "../preload/preload.cjs")),
  );
  hideMainWindowMenu(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  void mainWindow.loadURL(rendererUrl());
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
    const filePath = await chooseCertificatePdfPath(request.jobId);
    if (!filePath) return null;

    await saveLocalCertificatePdf(request.jobId, filePath);
    return filePath;
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
      defaultPath: defaultSupportBundlePath(),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;

    return exportSupportBundle({
      filePath: result.filePath,
      desktopLogFilePath: getDesktopLogFilePath(),
      rendererBuildManifestPath: path.join(
        __dirname,
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
  const allowedOrigins = new Set([
    "https://api.calibrafacil.com",
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

  return "https://calibrafacil.com";
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
    const cookies = headers.getSetCookie.call(headers);
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

async function chooseCertificatePdfPath(jobId: string | number) {
  const result = await dialog.showSaveDialog({
    defaultPath: `${toSafeFileName(String(jobId)) || "certificado"}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });

  return result.canceled ? null : (result.filePath ?? null);
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

function toSafeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

app.whenReady().then(async () => {
  installDesktopLogger();
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
  const cloudProxyUrl = await cloudAuthProxy.start();
  await localServer.start({
    cloudApiUrl: cloudProxyUrl,
    cloudProxyToken: cloudAuthProxy.token,
  });
  await broadcastSyncStatus();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  cloudAuthProxy?.stop();
  cloudAuthProxy = null;
  localServer.stop();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
