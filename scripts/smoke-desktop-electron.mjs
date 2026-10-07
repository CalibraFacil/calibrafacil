import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(
  path.join(os.tmpdir(), "calibra-electron-smoke-"),
);
// The same surface apps/desktop/src/preload/preload.test.ts pins: this checks
// that the built preload exposes it, and nothing more.
const expectedBridgeKeys = [
  "activateLocalPartition",
  "authFetch",
  "checkForUpdate",
  "deleteSecret",
  "downloadUpdate",
  "exportSupportBundle",
  "getAppInfo",
  "getLocalEnvironmentBootstrap",
  "getSecretStatuses",
  "getSettings",
  "getSyncState",
  "getSyncStatus",
  "getUpdateState",
  "installUpdate",
  "notifyDeepLinkReady",
  "onDeepLink",
  "onHistoryCommand",
  "onSyncStatus",
  "onUpdateState",
  "openExternal",
  "pauseSync",
  "pickFile",
  "pickFolder",
  "publishNotifications",
  "resumeSync",
  "retrySync",
  "revealFile",
  "saveCertificatePdf",
  "saveFile",
  "setSecret",
  "setSettings",
  "startSync",
  "wakeSync",
].sort();
const expectedLocalDbSchemaVersion = 5;

await run("pnpm", ["--dir", "apps/desktop", "run", "build"]);

const localPort = await getAvailablePort();
const rendererPort = await getAvailablePort();
const cloudPort = await getAvailablePort();
const localBaseUrl = `http://127.0.0.1:${localPort}`;
const rendererBaseUrl = `http://127.0.0.1:${rendererPort}`;
const cloudBaseUrl = `http://127.0.0.1:${cloudPort}`;
let localApiAuthorization = null;
const cloudRequests = [];
let electron = null;

const localServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", localBaseUrl);

  if (url.pathname === "/.well-known/calibra/local-environment") {
    return sendJson(response, {
      appVersion: "smoke",
      localServerVersion: "smoke",
      deviceId: "device-smoke",
      tenantId: "org-smoke",
      organizationId: "org-smoke",
      unitId: 1,
      userId: "user-smoke",
      dbSchemaVersion: expectedLocalDbSchemaVersion,
      syncEnabled: true,
      syncState: "idle",
      httpBaseUrl: localBaseUrl,
      localApiToken: null,
    });
  }

  if (url.pathname === "/api/local/sync/status") {
    localApiAuthorization = request.headers.authorization ?? null;
    return sendJson(response, {
      state: "idle",
      pendingOutboxCount: 0,
      conflictCount: 0,
      lastSyncedAt: null,
    });
  }

  if (
    request.method === "POST" &&
    [
      "/api/local/sync/start",
      "/api/local/sync/pause",
      "/api/local/sync/retry",
    ].includes(url.pathname)
  ) {
    localApiAuthorization = request.headers.authorization ?? null;
    return sendJson(response, { ok: true });
  }

  if (url.pathname === "/api/local/diagnostics") {
    localApiAuthorization = request.headers.authorization ?? null;
    return sendJson(response, {
      runtime: {
        desktopRunId: "desktop-electron-smoke-run",
        localServerRunId: "local-server-electron-smoke-run",
      },
      sync: {
        state: "idle",
        activeRunId: null,
        lastRunId: null,
        lastError: null,
      },
      database: {
        schemaVersion: expectedLocalDbSchemaVersion,
        integrity: { ok: true },
        pendingOutboxCount: 0,
        conflictCount: 0,
        activeCalibrationJobCount: 0,
        activeServiceOrderWorkflowCount: 0,
      },
    });
  }

  response.writeHead(404);
  response.end("not found");
});

let smokeResult = null;
let smokeResolve;
let smokeReject;
const smokeDone = new Promise((resolve, reject) => {
  smokeResolve = resolve;
  smokeReject = reject;
});

const rendererServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", rendererBaseUrl);

  if (url.pathname === "/__smoke_result" && request.method === "POST") {
    const body = await readBody(request);
    try {
      smokeResult = JSON.parse(body);
      smokeResolve(smokeResult);
    } catch (error) {
      smokeReject(error);
    }
    return sendJson(response, { ok: true });
  }

  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(renderSmokeHtml());
});

const cloudServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", cloudBaseUrl);
  const body = await readBody(request);
  cloudRequests.push({
    method: request.method,
    pathname: url.pathname,
    origin: request.headers.origin ?? null,
    referer: request.headers.referer ?? null,
    cookie: request.headers.cookie ?? null,
    body,
  });

  if (
    request.method === "POST" &&
    url.pathname === "/api/auth/lab/sign-in/email"
  ) {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": "calibra_smoke_session=session-1; Path=/; HttpOnly",
    });
    response.end(JSON.stringify({ user: { id: "user-smoke" } }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/standards") {
    return sendJson(response, {
      data: [
        {
          id: 456,
          name: "Laboratório Exemplo - Peso padrão 20 kg",
          serialNumber: "EXEMPLO-20KG",
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  }

  response.writeHead(404);
  response.end("not found");
});

try {
  await listen(localServer, localPort);
  await listen(rendererServer, rendererPort);
  await listen(cloudServer, cloudPort);

  electron = spawnElectron({
    CALIBRA_DESKTOP_SKIP_LOCAL_SERVER: "1",
    CALIBRA_LOCAL_HOST: "127.0.0.1",
    CALIBRA_LOCAL_PORT: String(localPort),
    CALIBRA_DESKTOP_RENDERER_URL: rendererBaseUrl,
    CALIBRA_DESKTOP_AUTH_API_URL: cloudBaseUrl,
    XDG_CONFIG_HOME: path.join(tempDir, "config"),
    XDG_CACHE_HOME: path.join(tempDir, "cache"),
  });

  const result = await withTimeout(smokeDone, 20_000);
  assert(result.ok === true, result.error ?? "renderer smoke failed");
  assert(
    localApiAuthorization?.startsWith("Bearer "),
    "desktop did not authorize local API calls",
  );
  assert(
    cloudRequests.length === 2,
    `expected 2 desktop cloud requests, got ${cloudRequests.length}`,
  );
  assert(
    cloudRequests.every((request) => request.origin === rendererBaseUrl),
    "desktop cloud bridge did not attach the renderer Origin header",
  );
  assert(
    cloudRequests.every((request) => request.referer === `${rendererBaseUrl}/`),
    "desktop cloud bridge did not attach the renderer Referer header",
  );
  assert(
    cloudRequests[1]?.cookie?.includes("calibra_smoke_session=session-1"),
    "desktop cloud bridge did not persist and replay auth cookies",
  );

  console.log(
    `Desktop Electron smoke passed on ${rendererBaseUrl} -> ${localBaseUrl} with cloud ${cloudBaseUrl}.`,
  );
} finally {
  if (electron && electron.exitCode === null) {
    electron.kill();
    await new Promise((resolve) => {
      electron.once("exit", resolve);
      setTimeout(resolve, 1000).unref();
    });
  }
  await closeServer(cloudServer);
  await closeServer(rendererServer);
  await closeServer(localServer);
  await rm(tempDir, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 100,
  });
}

function spawnElectron(extraEnv) {
  const baseCommand =
    process.platform === "win32"
      ? {
          executable: "pnpm.cmd",
          args: ["--dir", "apps/desktop", "exec", "electron", "."],
        }
      : {
          executable: "pnpm",
          args: ["--dir", "apps/desktop", "exec", "electron", "."],
        };
  const command = maybeWrapWithXvfb(baseCommand);
  const child = spawn(command.executable, command.args, {
    cwd: root,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logChunks = [];
  child.stdout.on("data", (chunk) => logChunks.push(chunk));
  child.stderr.on("data", (chunk) => logChunks.push(chunk));
  child.once("exit", (code, signal) => {
    if (!smokeResult) {
      const output = Buffer.concat(logChunks).toString("utf8");
      smokeReject(
        new Error(
          `Electron exited before smoke completed (code=${code}, signal=${signal}).\n${output}`,
        ),
      );
    }
  });

  return child;
}

function maybeWrapWithXvfb(command) {
  if (process.platform !== "linux" || process.env.DISPLAY) return command;
  const lookup = spawnSync("bash", ["-lc", "command -v xvfb-run"], {
    encoding: "utf8",
  });
  if (lookup.status !== 0) return command;

  return {
    executable: "xvfb-run",
    args: ["-a", command.executable, ...command.args],
  };
}

function renderSmokeHtml() {
  return `<!doctype html>
<meta charset="utf-8" />
<title>CalibraFacil Desktop Smoke</title>
<script>
const expectedKeys = ${JSON.stringify(expectedBridgeKeys)};
const report = async (payload) => {
  await fetch('/__smoke_result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

(async () => {
  const bridge = window.calibraBridge;
  if (!bridge) throw new Error('window.calibraBridge is missing');

  const actualKeys = Object.keys(bridge).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('Unexpected bridge keys: ' + actualKeys.join(', '));
  }

  if (typeof window.require !== 'undefined') {
    throw new Error('window.require is exposed');
  }

  if (typeof window.process !== 'undefined') {
    throw new Error('window.process is exposed');
  }

  const [appInfo, bootstrap, settings, syncStatus, syncAction, updateState, blockedExternal] =
    await Promise.all([
      bridge.getAppInfo(),
      bridge.getLocalEnvironmentBootstrap(),
      bridge.getSettings(),
      bridge.getSyncStatus(),
      bridge.startSync(),
      bridge.getUpdateState(),
      bridge.openExternal('file:///tmp/not-allowed'),
    ]);
  const signInResponse = await bridge.authFetch({
    url: ${JSON.stringify(`${cloudBaseUrl}/api/auth/lab/sign-in/email`)},
    method: 'POST',
    headers: [['content-type', 'application/json']],
    body: JSON.stringify({ email: 'smoke@example.test', password: 'secret' }),
  });
  const standardsResponse = await bridge.authFetch({
    url: ${JSON.stringify(`${cloudBaseUrl}/api/standards?page=1&limit=20`)},
    method: 'GET',
    headers: [],
    body: null,
  });

  if (!appInfo || appInfo.isPackaged !== false) {
    throw new Error('App info did not identify dev Electron smoke');
  }
  if (!bootstrap || bootstrap.httpBaseUrl !== ${JSON.stringify(localBaseUrl)}) {
    throw new Error('Local bootstrap did not use smoke local API');
  }
  if (!bootstrap.localApiToken) {
    throw new Error('Local bootstrap token was not attached by desktop main');
  }
  if (!settings || settings.updateChannel !== 'stable') {
    throw new Error('Default desktop settings did not load');
  }
  if (!syncStatus || syncStatus.state !== 'idle') {
    throw new Error('Sync status did not round-trip through local API');
  }
  if (!syncAction || syncAction.ok !== true) {
    throw new Error('Sync action did not round-trip through local API');
  }
  if (!updateState || typeof updateState.status !== 'string') {
    throw new Error('Update state did not load');
  }
  if (blockedExternal !== false) {
    throw new Error('Unsafe external URL was not blocked');
  }
  if (signInResponse.status !== 200) {
    throw new Error('Desktop auth bridge sign-in returned HTTP ' + signInResponse.status);
  }
  if (standardsResponse.status !== 200) {
    throw new Error('Desktop auth bridge standards returned HTTP ' + standardsResponse.status);
  }
  const standards = JSON.parse(standardsResponse.body);
  if (standards.data?.[0]?.serialNumber !== 'EXEMPLO-20KG') {
    throw new Error('Desktop auth bridge did not return cloud standards data');
  }

  await report({ ok: true });
})().catch(async (error) => {
  await report({ ok: false, error: error && error.stack ? error.stack : String(error) });
});
</script>`;
}

function sendJson(response, value) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("failed to allocate local port"));
        }
      });
    });
  });
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${executable} ${args.join(" ")} failed with code=${code} signal=${signal}\n${Buffer.concat(
            chunks,
          ).toString("utf8")}`,
        ),
      );
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
