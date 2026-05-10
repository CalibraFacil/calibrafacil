import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPath = path.join(
  root,
  "apps/desktop/out/linux-unpacked/@calibra-facildesktop",
);
const apiBase = normalizeBaseUrl(
  process.env.CALIBRA_PARITY_API_URL ?? "https://api.calibrafacil.com",
);
const email = process.env.CALIBRA_PARITY_EMAIL;
const password = process.env.CALIBRA_PARITY_PASSWORD;
const activeUnitId = process.env.CALIBRA_PARITY_ACTIVE_UNIT_ID ?? "1";
const origin = process.env.CALIBRA_PARITY_ORIGIN ?? "https://calibrafacil.com";

if (!email || !password) {
  console.error(`Packaged offline desktop smoke requires credentials.

Set:
  CALIBRA_PARITY_EMAIL='user@example.com'
  CALIBRA_PARITY_PASSWORD='...'

Optional:
  CALIBRA_PARITY_API_URL='https://api.calibrafacil.com'
  CALIBRA_PARITY_ACTIVE_UNIT_ID='1'
`);
  process.exit(2);
}

const tempRoot = await mkdtemp(
  path.join(os.tmpdir(), "calibra-packaged-offline-"),
);
const userData = path.join(tempRoot, "user-data");
const proxyPort = await getAvailablePort();
const firstRemoteDebuggingPort = await getAvailablePort();
const secondRemoteDebuggingPort = await getAvailablePort();

let cloudOnline = true;
let appProcess = null;
let proxyServer = null;
let latestBootstrap = null;

try {
  proxyServer = await startLoopbackCloudProxy();
  appProcess = await launchPackagedApp(firstRemoteDebuggingPort);
  const firstPage = await connectChromeDevTools(firstRemoteDebuggingPort);

  await waitForBridge(firstPage);
  const appInfo = await evaluate(
    firstPage,
    "window.calibraBridge.getAppInfo()",
  );
  assert(appInfo.isPackaged === true, "expected packaged desktop app");

  const signIn = await desktopAuthFetch(
    firstPage,
    "/api/auth/lab/sign-in/email",
    {
      method: "POST",
      headers: [
        ["content-type", "application/json"],
        ["x-active-unit-id", activeUnitId],
      ],
      body: JSON.stringify({ email, password }),
    },
  );
  assert(
    signIn.status === 200,
    `sign-in returned HTTP ${signIn.status}: ${signIn.body}`,
  );

  const standards = await desktopAuthFetchJson(
    firstPage,
    "/api/standards?page=1&limit=20",
    { headers: [["x-active-unit-id", activeUnitId]] },
  );
  assert(
    Array.isArray(standards.data) && standards.data.length > 0,
    "cloud standards missing before sync",
  );

  const firstSync = await evaluate(
    firstPage,
    "window.calibraBridge.startSync()",
  );
  assert(
    firstSync.ok === true,
    `startSync failed: ${JSON.stringify(firstSync)}`,
  );

  const firstBootstrap = await waitForLocalBootstrap(firstPage);
  latestBootstrap = firstBootstrap;
  const firstLocalHeaders = authHeaders(firstBootstrap);
  const localStandards = await localJson(
    firstBootstrap.httpBaseUrl,
    "/api/standards?page=1&limit=20",
    firstLocalHeaders,
  );
  assert(
    Array.isArray(localStandards.data) && localStandards.data.length > 0,
    "local standards missing after sync",
  );

  cloudOnline = false;
  const customerName = `Smoke Offline Restart ${Date.now()}`;
  const localCustomer = await localJson(
    firstBootstrap.httpBaseUrl,
    "/api/customers",
    firstLocalHeaders,
    {
      method: "POST",
      headers: {
        ...firstLocalHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: customerName,
        taxId: createPseudoCnpj(),
        email: `offline-${Date.now()}@calibrafacil.com`,
        phone: "51999999999",
      }),
    },
  );
  assert(localCustomer.id, "local customer did not return an id");

  const offlineRetry = await evaluate(
    firstPage,
    "window.calibraBridge.retrySync()",
  );
  assert(
    offlineRetry.ok === false,
    "retrySync unexpectedly succeeded while cloud proxy was offline",
  );
  const offlineStatus = await evaluate(
    firstPage,
    "window.calibraBridge.getSyncStatus()",
  );
  assert(
    offlineStatus.pendingOutboxCount >= 1,
    `expected pending outbox while offline: ${JSON.stringify(offlineStatus)}`,
  );

  await closePackagedApp();
  appProcess = await launchPackagedApp(secondRemoteDebuggingPort);
  const secondPage = await connectChromeDevTools(secondRemoteDebuggingPort);

  await waitForBridge(secondPage);
  const secondBootstrap = await waitForLocalBootstrap(secondPage);
  latestBootstrap = secondBootstrap;
  const secondLocalHeaders = authHeaders(secondBootstrap);
  const statusAfterRestart = await evaluate(
    secondPage,
    "window.calibraBridge.getSyncStatus()",
  );
  assert(
    statusAfterRestart.pendingOutboxCount >= 1,
    `pending outbox did not survive restart: ${JSON.stringify(
      statusAfterRestart,
    )}`,
  );

  const localCustomers = await localJson(
    secondBootstrap.httpBaseUrl,
    `/api/customers?query=${encodeURIComponent(customerName)}&page=1&limit=5`,
    secondLocalHeaders,
  );
  assert(
    localCustomers.data?.some((customer) => customer.name === customerName),
    "offline customer not readable after restart",
  );

  cloudOnline = true;
  const onlineRetry = await evaluate(
    secondPage,
    "window.calibraBridge.retrySync()",
  );
  assert(
    onlineRetry.ok === true,
    `retrySync online failed: ${JSON.stringify(onlineRetry)}`,
  );
  const finalStatus = await evaluate(
    secondPage,
    "window.calibraBridge.getSyncStatus()",
  );
  assert(
    finalStatus.state === "idle",
    `final status not idle: ${JSON.stringify(finalStatus)}`,
  );
  assert(
    finalStatus.pendingOutboxCount === 0,
    `pending outbox not drained: ${JSON.stringify(finalStatus)}`,
  );
  assert(
    finalStatus.conflictCount === 0,
    `unexpected sync conflicts: ${JSON.stringify(finalStatus)}`,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        appInfo,
        cloud: { standards: standards.data.length },
        local: { standards: localStandards.data.length },
        localWrite: { customerId: localCustomer.id },
        offlineStatus,
        statusAfterRestart,
        finalStatus,
      },
      null,
      2,
    ),
  );
} catch (error) {
  printLocalDiagnostics();
  throw error;
} finally {
  await closePackagedApp().catch(() => {});
  await closeProxyServer();
  await rm(tempRoot, { recursive: true, force: true });
}

async function startLoopbackCloudProxy() {
  const server = createServer(async (request, response) => {
    try {
      if (!cloudOnline) {
        response.statusCode = 503;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "Simulated offline cloud" }));
        return;
      }

      const target = new URL(request.url ?? "/", apiBase);
      const body = Buffer.concat(await readRequestChunks(request));
      const headers = createProxyHeaders(request.headers);
      const forwarded = await fetch(target, {
        method: request.method,
        headers,
        body:
          body.length > 0 &&
          request.method !== "GET" &&
          request.method !== "HEAD"
            ? body
            : undefined,
        redirect: "manual",
      });

      response.statusCode = forwarded.status;
      response.statusMessage = forwarded.statusText;
      for (const [name, value] of forwarded.headers) {
        if (isHopByHopResponseHeader(name)) continue;
        response.setHeader(name, value);
      }

      const cookies = readSetCookieHeaders(forwarded.headers).map(
        rewriteCookieForLoopbackProxy,
      );
      if (cookies.length > 0) {
        response.setHeader("Set-Cookie", cookies);
      }

      response.end(Buffer.from(await forwarded.arrayBuffer()));
    } catch (error) {
      response.statusCode = 502;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "proxy failed",
        }),
      );
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(proxyPort, "127.0.0.1", resolve);
  });
  return server;
}

function readRequestChunks(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    request.on("error", reject);
    request.on("end", () => resolve(chunks));
  });
}

function createProxyHeaders(inputHeaders) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(inputHeaders)) {
    if (!value) continue;
    const lowerName = name.toLowerCase();
    if (["host", "connection", "content-length"].includes(lowerName)) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }

  headers.set("Origin", origin);
  headers.set("Referer", `${origin}/`);
  if (activeUnitId) headers.set("x-active-unit-id", activeUnitId);

  return headers;
}

function readSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  return splitSetCookieHeader(headers.get("set-cookie"));
}

function splitSetCookieHeader(header) {
  if (!header) return [];

  const cookies = [];
  let start = 0;
  let inExpires = false;

  for (let index = 0; index < header.length; index += 1) {
    const rest = header.slice(index).toLowerCase();
    if (rest.startsWith("expires=")) inExpires = true;
    if (inExpires && header[index] === ";") inExpires = false;
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

function rewriteCookieForLoopbackProxy(cookie) {
  return cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !part.toLowerCase().startsWith("domain="))
    .join("; ");
}

function isHopByHopResponseHeader(name) {
  return [
    "connection",
    "content-encoding",
    "content-length",
    "set-cookie",
    "transfer-encoding",
  ].includes(name.toLowerCase());
}

async function launchPackagedApp(remoteDebuggingPort) {
  const child = spawn(
    appPath,
    [
      `--remote-debugging-port=${remoteDebuggingPort}`,
      `--user-data-dir=${userData}`,
      "--no-sandbox",
      "--disable-gpu",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        CALIBRA_DESKTOP_AUTH_API_URL: `http://127.0.0.1:${proxyPort}`,
        CALIBRA_DESKTOP_AUTH_ORIGIN: origin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk) =>
    process.stderr.write(`[desktop stdout] ${chunk}`),
  );
  child.stderr.on("data", (chunk) =>
    process.stderr.write(`[desktop stderr] ${chunk}`),
  );
  child.once("exit", (code, signal) => {
    if (appProcess === child) {
      process.stderr.write(`[desktop exit] code=${code} signal=${signal}\n`);
    }
  });

  return child;
}

async function closePackagedApp() {
  if (!appProcess || appProcess.exitCode !== null) return;
  appProcess.kill("SIGTERM");
  await new Promise((resolve) => {
    appProcess.once("exit", resolve);
    setTimeout(resolve, 2500).unref();
  });

  if (appProcess.exitCode === null) {
    appProcess.kill("SIGKILL");
  }
  appProcess = null;
}

function closeProxyServer() {
  return new Promise((resolve) => {
    if (!proxyServer) {
      resolve();
      return;
    }
    proxyServer.close(resolve);
    proxyServer = null;
  });
}

async function connectChromeDevTools(port) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      const page =
        pages.find(
          (item) => item.type === "page" && item.webSocketDebuggerUrl,
        ) ?? pages[0];

      if (page?.webSocketDebuggerUrl) {
        return connectWebSocketPage(page.webSocketDebuggerUrl);
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw lastError ?? new Error("Chrome DevTools did not become ready");
}

async function connectWebSocketPage(webSocketDebuggerUrl) {
  const webSocket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    webSocket.addEventListener("open", resolve, { once: true });
    webSocket.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  webSocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(JSON.stringify(message.error)));
      } else {
        request.resolve(message.result);
      }
    }
  });

  return {
    send(method, params = {}) {
      const requestId = ++id;
      webSocket.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
      });
    },
    close() {
      webSocket.close();
    },
  };
}

async function evaluate(page, expression) {
  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }

  return result.result?.value;
}

async function waitForBridge(page) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const ready = await evaluate(
      page,
      "Boolean(window.calibraBridge && window.calibraBridge.authFetch)",
    );
    if (ready) return;
    await sleep(250);
  }

  throw new Error("desktop bridge did not become ready");
}

async function waitForLocalBootstrap(page) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const bootstrap = await evaluate(
      page,
      "window.calibraBridge.getLocalEnvironmentBootstrap()",
    );
    if (bootstrap?.httpBaseUrl && bootstrap?.localApiToken) {
      return bootstrap;
    }

    await sleep(250);
  }

  throw new Error("local environment bootstrap did not become ready");
}

async function desktopAuthFetch(page, pathname, init = {}) {
  return evaluate(
    page,
    `window.calibraBridge.authFetch(${JSON.stringify({
      url: `http://127.0.0.1:${proxyPort}${pathname}`,
      method: init.method ?? "GET",
      headers: init.headers ?? [],
      body: init.body ?? null,
    })})`,
  );
}

async function desktopAuthFetchJson(page, pathname, init = {}) {
  const response = await desktopAuthFetch(page, pathname, init);
  assert(
    response.status >= 200 && response.status < 300,
    `${pathname} returned HTTP ${response.status}: ${response.body}`,
  );
  return JSON.parse(response.body);
}

async function localJson(baseUrl, pathname, headers, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: init.headers ?? headers,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

function printLocalDiagnostics() {
  try {
    const dbPath = path.join(userData, "local-data", "calibra.sqlite");
    const database = new Database(dbPath, { readonly: true });
    try {
      const outbox = database
        .prepare(
          `
SELECT id, event_id, operation, status, last_error, created_at
FROM outbox
ORDER BY created_at DESC
LIMIT 10
`,
        )
        .all();
      console.error(
        JSON.stringify(
          {
            localDiagnostics: {
              dbPath,
              latestBootstrap,
              outbox,
              customers: readOptionalRows(
                database,
                `
SELECT id, remote_id, name, tax_id, email, sync_state, updated_at
FROM customers
ORDER BY updated_at DESC
LIMIT 10
`,
              ),
              domainEvents: readOptionalRows(
                database,
                `
SELECT event_id, aggregate_kind, aggregate_id, event_type, sync_state, occurred_at
FROM domain_events
ORDER BY occurred_at DESC
LIMIT 10
`,
              ),
            },
          },
          null,
          2,
        ),
      );
    } finally {
      database.close();
    }
  } catch (error) {
    console.error(
      `Unable to read packaged local diagnostics: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function readOptionalRows(database, query) {
  try {
    return database.prepare(query).all();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function authHeaders(bootstrap) {
  return { Authorization: `Bearer ${bootstrap.localApiToken}` };
}

function createPseudoCnpj() {
  const suffix = String(Date.now()).slice(-8).padStart(8, "0");
  return `99${suffix}0001${Math.floor(Math.random() * 90 + 10)}`;
}

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
