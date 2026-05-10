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
const onlineWebParityRoutes = [
  {
    path: "/dashboard/standards",
    text: "Gerencie os padrões e equipamentos de calibração do laboratório",
  },
  {
    path: "/dashboard/assets",
    text: "Gerencie os ativos e instrumentos do laboratório.",
  },
  {
    path: "/dashboard/jobs",
    text: "Gerencie jobs de calibração e emissão de certificados",
  },
  {
    path: "/dashboard/service-orders",
    text: "Recebimento, avaliação, orçamento, execução e entrega",
  },
  {
    path: "/dashboard/reports",
    text: "Visão executiva multiunidade",
  },
  {
    path: "/dashboard/requests",
    text: "Revise, aprove e converta as solicitações enviadas pelos clientes.",
  },
  {
    path: "/dashboard/nc",
    text: "Controle de trabalhos não conformes - ISO 17025 Cláusula 8.7",
  },
  {
    path: "/dashboard/capa",
    text: "Ações corretivas e preventivas - ISO 17025 Cláusula 8.2",
  },
  {
    path: "/dashboard/certificate-designer",
    text: "Edite blocos em A4 com coordenadas em milímetros.",
  },
  {
    path: "/dashboard/settings/profile",
    text: "Gerencie seu perfil de usuário.",
  },
];
const offlineCachedRoutes = [
  {
    path: "/dashboard/standards",
    text: "Gerencie os padrões e equipamentos de calibração do laboratório",
  },
  {
    path: "/dashboard/assets",
    text: "Gerencie os ativos e instrumentos do laboratório.",
  },
  {
    path: "/dashboard/clients",
    text: "Gerencie os clientes do laboratório.",
  },
  {
    path: "/dashboard/jobs",
    text: "Gerencie jobs de calibração e emissão de certificados",
  },
  {
    path: "/dashboard/service-orders",
    text: "Recebimento, avaliação, orçamento, execução e entrega",
  },
];

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
  const localAssets = await localJson(
    firstBootstrap.httpBaseUrl,
    "/api/assets?page=1&limit=20",
    firstLocalHeaders,
  );
  assert(
    Array.isArray(localAssets.data) && localAssets.data.length > 0,
    "local assets missing after sync",
  );
  const localServices = await localJson(
    firstBootstrap.httpBaseUrl,
    "/api/services?page=1&limit=20&isActive=true",
    firstLocalHeaders,
  );
  assert(
    Array.isArray(localServices.data) && localServices.data.length > 0,
    "local services missing after sync",
  );

  const onlineWebParity = await runOnlineWebParitySmoke(
    firstPage,
    firstBootstrap,
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

  const localJob = await localJson(
    firstBootstrap.httpBaseUrl,
    "/api/jobs",
    firstLocalHeaders,
    {
      method: "POST",
      headers: {
        ...firstLocalHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assetId: localAssets.data[0].id,
        serviceId: localServices.data[0].id,
      }),
    },
  );
  assert(localJob.id, "local calibration job did not return an id");

  const execution = await localJson(
    firstBootstrap.httpBaseUrl,
    `/api/jobs/${encodeURIComponent(String(localJob.id))}/submit`,
    firstLocalHeaders,
    {
      method: "POST",
      headers: {
        ...firstLocalHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          indication: "10.02",
          reference: "10",
          indicacao: "10.02",
          valor_padrao: "10",
          tolerancia_max: "0.1",
        },
        results: null,
        selectedStandardIds: [localStandards.data[0].id],
        environment: {
          temperature: 20,
          humidity: 50,
          pressure: 1013,
        },
      }),
    },
  );
  assert(
    execution.data?.status === "REVIEW",
    `local calibration submit did not enter REVIEW: ${JSON.stringify(
      execution,
    )}`,
  );

  const jobAttachment = await uploadLocalAttachment(
    firstBootstrap.httpBaseUrl,
    firstLocalHeaders,
    {
      entityType: "calibration_job",
      entityId: String(localJob.id),
      content: `packaged offline evidence ${new Date().toISOString()}`,
      fileName: "packaged-offline-evidence.txt",
    },
  );
  assert(jobAttachment.id, "local calibration attachment did not return an id");

  const certificateDraft = await localJson(
    firstBootstrap.httpBaseUrl,
    `/api/jobs/${encodeURIComponent(String(localJob.id))}/certificate-draft`,
    firstLocalHeaders,
    {
      method: "POST",
      headers: firstLocalHeaders,
    },
  );
  assert(certificateDraft.id, "local certificate draft did not return an id");
  const draftHtml = await localText(
    firstBootstrap.httpBaseUrl,
    `/api/jobs/${encodeURIComponent(String(localJob.id))}/certificate-draft/file`,
    firstLocalHeaders,
  );
  assert(
    draftHtml.includes("Rascunho local"),
    "local certificate draft HTML is missing the local draft banner",
  );

  const certificatePdf = await localJson(
    firstBootstrap.httpBaseUrl,
    `/api/jobs/${encodeURIComponent(
      String(localJob.id),
    )}/certificate-draft/${encodeURIComponent(certificateDraft.id)}/pdf`,
    firstLocalHeaders,
    {
      method: "POST",
      headers: {
        ...firstLocalHeaders,
        "Content-Type": "application/pdf",
      },
      body: minimalPdfBytes(),
    },
  );
  assert(
    certificatePdf.status === "pdf_generated",
    `local certificate PDF was not persisted: ${JSON.stringify(certificatePdf)}`,
  );

  const offlineCachedScreens = await runOfflineCachedRouteSmoke(firstPage);

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
  const updateInstallBlocked = await evaluate(
    firstPage,
    "window.calibraBridge.installUpdate()",
  );
  assert(
    updateInstallBlocked.status === "downloaded" &&
      updateInstallBlocked.message?.includes("local changes are pending sync"),
    `update install was not blocked by pending outbox: ${JSON.stringify(
      updateInstallBlocked,
    )}`,
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
  await waitForSyncSettled(secondPage);

  const localCustomers = await localJson(
    secondBootstrap.httpBaseUrl,
    `/api/customers?query=${encodeURIComponent(customerName)}&page=1&limit=5`,
    secondLocalHeaders,
  );
  assert(
    localCustomers.data?.some((customer) => customer.name === customerName),
    "offline customer not readable after restart",
  );
  const restartedJob = await localJson(
    secondBootstrap.httpBaseUrl,
    `/api/jobs/${encodeURIComponent(String(localJob.id))}`,
    secondLocalHeaders,
  );
  assert(
    restartedJob.status === "REVIEW",
    "offline calibration execution did not survive restart",
  );
  const restartedDraft = await localText(
    secondBootstrap.httpBaseUrl,
    `/api/jobs/${encodeURIComponent(String(localJob.id))}/certificate-draft/file`,
    secondLocalHeaders,
  );
  assert(
    restartedDraft.includes("Rascunho local"),
    "local certificate draft was not readable after restart",
  );
  const restartedAttachments = await localJson(
    secondBootstrap.httpBaseUrl,
    `/api/attachments?entityType=calibration_job&entityId=${encodeURIComponent(
      String(localJob.id),
    )}&limit=10`,
    secondLocalHeaders,
  );
  assert(
    restartedAttachments.data?.some(
      (attachment) => attachment.id === jobAttachment.id,
    ),
    "local calibration attachment was not listed after restart",
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
  const finalStatus = await waitForSyncIdle(secondPage);
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

  const conflictUx = await runConflictUxSmoke(
    secondPage,
    secondBootstrap,
    localCustomer,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        appInfo,
        cloud: { standards: standards.data.length },
        local: {
          standards: localStandards.data.length,
          assets: localAssets.data.length,
          services: localServices.data.length,
        },
        localWrite: {
          customerId: localCustomer.id,
          jobId: localJob.id,
          attachmentId: jobAttachment.id,
          certificateDraftId: certificateDraft.id,
        },
        onlineWebParity,
        offlineCachedScreens,
        offlineStatus,
        updateInstallBlocked,
        statusAfterRestart,
        finalStatus,
        conflictUx,
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
        CALIBRA_DESKTOP_ENABLE_SMOKE_HOOKS: "1",
        CALIBRA_DESKTOP_SMOKE_DOWNLOADED_UPDATE_VERSION: "9.9.9-smoke",
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

async function navigateHash(page, routePath) {
  await evaluate(
    page,
    `(() => { window.location.hash = ${JSON.stringify(routePath)}; })()`,
  );
}

async function reloadPage(page) {
  await evaluate(page, "window.location.reload()");
  await sleep(1000);
}

async function waitForText(page, text, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = await evaluate(
      page,
      `document.body?.innerText?.includes(${JSON.stringify(text)}) ?? false`,
    );
    if (found) return;
    await sleep(250);
  }

  const bodyText = await evaluate(
    page,
    "document.body?.innerText?.slice(0, 2000) ?? ''",
  );
  throw new Error(`Timed out waiting for text ${JSON.stringify(text)}.
Current body text:
${bodyText}`);
}

async function waitForHashIncludes(page, text, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const hash = await evaluate(page, "window.location.hash");
    if (hash.includes(text)) return;
    await sleep(250);
  }

  const hash = await evaluate(page, "window.location.hash");
  throw new Error(
    `Timed out waiting for hash to include ${JSON.stringify(text)}; got ${hash}`,
  );
}

async function clickElementByText(page, selector, text) {
  const clicked = await evaluate(
    page,
    `(() => {
      const elements = [...document.querySelectorAll(${JSON.stringify(
        selector,
      )})];
      const element = elements.find((candidate) =>
        candidate.textContent?.includes(${JSON.stringify(text)}),
      );
      if (!element) return false;
      element.click();
      return true;
    })()`,
  );
  assert(clicked, `Could not click ${selector} containing ${text}`);
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

async function waitForSyncSettled(page, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let latestStatus = null;

  while (Date.now() - startedAt < timeoutMs) {
    latestStatus = await evaluate(
      page,
      "window.calibraBridge.getSyncStatus()",
    );
    if (latestStatus?.activeRunId === null && latestStatus.state !== "syncing") {
      return latestStatus;
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for sync to settle: ${JSON.stringify(latestStatus)}`,
  );
}

async function waitForSyncIdle(page, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let latestStatus = null;

  while (Date.now() - startedAt < timeoutMs) {
    latestStatus = await waitForSyncSettled(page, timeoutMs);
    if (
      latestStatus.state === "idle" &&
      latestStatus.pendingOutboxCount === 0 &&
      latestStatus.conflictCount === 0
    ) {
      return latestStatus;
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for idle sync status: ${JSON.stringify(latestStatus)}`,
  );
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

async function localText(baseUrl, pathname, headers, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: init.headers ?? headers,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}: ${text}`);
  }

  return text;
}

async function uploadLocalAttachment(baseUrl, headers, input) {
  const form = new FormData();
  form.set("entityType", input.entityType);
  form.set("entityId", input.entityId);
  form.set(
    "file",
    new Blob([input.content], { type: "text/plain" }),
    input.fileName,
  );

  const response = await fetch(`${baseUrl}/api/attachments`, {
    method: "POST",
    headers,
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `/api/attachments returned HTTP ${response.status}: ${text}`,
    );
  }

  return JSON.parse(text);
}

async function runConflictUxSmoke(page, bootstrap, customer) {
  const conflict = seedCustomerConflict(customer);
  const headers = authHeaders(bootstrap);
  const list = await localJson(
    bootstrap.httpBaseUrl,
    "/api/local/sync/conflicts?status=open",
    headers,
  );
  assert(
    list.data?.some((item) => item.id === conflict.id),
    "seeded customer conflict was not listed by the local API",
  );

  await navigateHash(page, "/dashboard/sync/conflicts");
  await signInProductionSessionForUi(page, bootstrap);
  await reloadPage(page);
  await waitForBridge(page);
  await waitForText(page, "Conflitos de sincronização");
  await waitForText(page, `Cliente · ${customer.id}`);
  await waitForText(page, "CAMPO");
  await waitForText(page, "ALTERAÇÃO LOCAL");
  await waitForText(page, "ESTADO NA NUVEM");
  await waitForText(page, "Nome");
  await waitForText(page, conflict.localName);
  await waitForText(page, conflict.remoteName);
  await waitForText(page, "Payload bruto · Local");

  await clickElementByText(page, "a,button", "Editar antes de tentar");
  await waitForHashIncludes(
    page,
    `/dashboard/clients/${encodeURIComponent(String(customer.id))}/info`,
  );
  await waitForText(page, "Edição para conflito local");
  await waitForText(page, "Voltar aos conflitos");
  await waitForText(page, "Salvar Alterações");
  await clickElementByText(page, "button", "Salvar Alterações");
  await waitForHashIncludes(page, "/dashboard/sync/conflicts");
  await waitForText(page, `Cliente · ${customer.id}`);

  await clickElementByText(page, "button", "Manter nuvem");
  await waitForText(page, "Nenhum conflito aberto no banco local.");

  const openAfterResolve = await localJson(
    bootstrap.httpBaseUrl,
    "/api/local/sync/conflicts?status=open",
    headers,
  );
  assert(openAfterResolve.total === 0, "resolved conflict still listed open");

  const database = new Database(localDatabasePath(), { readonly: true });
  try {
    const row = database
      .prepare(
        `
SELECT status, resolved_at
FROM sync_conflicts
WHERE id = @id
LIMIT 1
`,
      )
      .get({ id: conflict.id });
    assert(row?.status === "ignored", "conflict was not ignored by UI action");
    assert(row?.resolved_at, "conflict resolved_at was not recorded");
  } finally {
    database.close();
  }

  return {
    conflictId: conflict.id,
    entityType: "customer",
    entityId: String(customer.id),
    resolution: "ignored",
  };
}

async function runOnlineWebParitySmoke(page, bootstrap) {
  await signInProductionSessionForUi(page, bootstrap);
  await navigateHash(page, "/dashboard");
  await reloadPage(page);
  await waitForBridge(page);

  for (const route of onlineWebParityRoutes) {
    await verifyRouteLoads(page, route);
  }

  return onlineWebParityRoutes.map((route) => route.path);
}

async function runOfflineCachedRouteSmoke(page) {
  const loadedRoutes = [];

  for (const route of offlineCachedRoutes) {
    await verifyRouteLoads(page, route);
    loadedRoutes.push(route.path);
  }

  return loadedRoutes;
}

async function verifyRouteLoads(page, route) {
  await navigateHash(page, route.path);
  await waitForHashIncludes(page, route.path);
  await waitForText(page, route.text);
  await assertPageDoesNotInclude(page, "Tela indisponível offline");
  await assertPageDoesNotInclude(page, "Cache não pronto");
  await assertPageDoesNotInclude(page, "Erro ao carregar");
}

async function assertPageDoesNotInclude(page, text) {
  const bodyText = await evaluate(
    page,
    "document.body?.innerText?.slice(0, 5000) ?? ''",
  );
  assert(
    !bodyText.includes(text),
    `Page unexpectedly included ${JSON.stringify(text)}:\n${bodyText}`,
  );
}

function seedCustomerConflict(customer) {
  const now = new Date().toISOString();
  const eventId = `event-smoke-conflict-${Date.now()}`;
  const id = `smoke-conflict:customer:${customer.id}:${eventId}`;
  const localName = `${customer.name} Local`;
  const remoteName = `${customer.name} Nuvem`;
  const localPayload = {
    operation: "update_local_customer",
    name: localName,
    email: customer.email,
    phone: customer.phone,
    updatedAt: now,
  };
  const remotePayload = {
    operation: "update_local_customer",
    name: remoteName,
    email: customer.email,
    phone: customer.phone,
    updatedAt: now,
  };

  const database = new Database(localDatabasePath());
  try {
    database.transaction(() => {
      database
        .prepare(
          `
INSERT INTO domain_events (
  event_id,
  aggregate_kind,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_json,
  metadata_json,
  actor_user_id,
  device_id,
  occurred_at,
  causation_id,
  correlation_id,
  sync_state
) VALUES (
  @eventId,
  'customer',
  @customerId,
  2,
  'customer.updated',
  @localPayloadJson,
  '{}',
  NULL,
  'packaged-conflict-smoke',
  @now,
  NULL,
  NULL,
  'conflict'
)
ON CONFLICT(event_id) DO NOTHING
`,
        )
        .run({
          eventId,
          customerId: String(customer.id),
          localPayloadJson: JSON.stringify(localPayload),
          now,
        });

      database
        .prepare(
          `
INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  last_error,
  created_at
) VALUES (
  @outboxId,
  @eventId,
  'update_local_customer',
  @localPayloadJson,
  @idempotencyKey,
  'conflict',
  'concurrent_update: conflict requires review',
  @now
)
ON CONFLICT(id) DO NOTHING
`,
        )
        .run({
          outboxId: `outbox:${eventId}`,
          eventId,
          localPayloadJson: JSON.stringify(localPayload),
          idempotencyKey: `local:${eventId}`,
          now,
        });

      database
        .prepare(
          `
INSERT INTO sync_conflicts (
  id,
  event_id,
  entity_type,
  entity_id,
  local_payload_json,
  remote_payload_json,
  conflict_type,
  status,
  created_at
) VALUES (
  @id,
  @eventId,
  'customer',
  @customerId,
  @localPayloadJson,
  @remotePayloadJson,
  'concurrent_update',
  'open',
  @now
)
ON CONFLICT(id) DO NOTHING
`,
        )
        .run({
          id,
          eventId,
          customerId: String(customer.id),
          localPayloadJson: JSON.stringify(localPayload),
          remotePayloadJson: JSON.stringify(remotePayload),
          now,
        });
    })();
  } finally {
    database.close();
  }

  return { id, eventId, localName, remoteName };
}

async function signInProductionSessionForUi(page, bootstrap) {
  const response = await evaluate(
    page,
    `window.calibraBridge.authFetch(${JSON.stringify({
      url: `${apiBase}/api/auth/lab/sign-in/email`,
      method: "POST",
      headers: [
        ["content-type", "application/json"],
        ["x-active-unit-id", activeUnitId],
      ],
      body: JSON.stringify({ email, password }),
    })})`,
  );
  assert(
    response.status === 200,
    `production UI sign-in returned HTTP ${response.status}: ${response.body}`,
  );
  await evaluate(
    page,
    `(() => {
      window.localStorage.setItem('dashboard-active-org', ${JSON.stringify(
        bootstrap.organizationId,
      )});
      window.localStorage.setItem(
        ${JSON.stringify(`dashboard-active-unit:${bootstrap.organizationId}`)},
        ${JSON.stringify(String(bootstrap.unitId))},
      );
    })()`,
  );
}

function printLocalDiagnostics() {
  try {
    const dbPath = localDatabasePath();
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

function localDatabasePath() {
  return path.join(userData, "local-data", "calibra.sqlite");
}

function authHeaders(bootstrap) {
  return { Authorization: `Bearer ${bootstrap.localApiToken}` };
}

function createPseudoCnpj() {
  const suffix = String(Date.now()).slice(-8).padStart(8, "0");
  return `99${suffix}0001${Math.floor(Math.random() * 90 + 10)}`;
}

function minimalPdfBytes() {
  return Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 20 100 Td (Calibra smoke) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000204 00000 n
trailer
<< /Size 5 /Root 1 0 R >>
startxref
297
%%EOF
`);
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
