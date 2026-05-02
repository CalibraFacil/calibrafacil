#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const defaultEndpoints = [
  "/api/auth/lab/get-session",
  "/api/auth/lab/organization/list",
  "/api/auth/lab/organization/get-full-organization",
  "/api/billing/access",
  "/api/notifications/unread-count",
  "/api/jobs?page=1&limit=20",
];

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1] ?? fallback;

  return fallback;
}

function readNumberArg(name, fallback) {
  const value = Number(readArg(name, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;

  const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(Math.max(index, 0), sortedValues.length - 1)];
}

function formatMs(value) {
  return `${value.toFixed(value < 10 ? 2 : 1)} ms`;
}

function parseEndpoints(value) {
  if (!value) return defaultEndpoints.map((path) => ({ method: "GET", path }));

  return value
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => ({ method: "GET", path }));
}

async function loadEndpoints() {
  const endpointsFile = readArg(
    "endpoints-file",
    process.env.BENCH_ENDPOINTS_FILE,
  );
  if (!endpointsFile) {
    return parseEndpoints(readArg("endpoints", process.env.BENCH_ENDPOINTS));
  }

  const raw = await readFile(endpointsFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${endpointsFile} must contain a JSON array`);
  }

  return parsed.map((endpoint) =>
    typeof endpoint === "string"
      ? { method: "GET", path: endpoint }
      : {
          method: endpoint.method ?? "GET",
          path: endpoint.path,
          name: endpoint.name,
          body: endpoint.body,
          headers: endpoint.headers,
        },
  );
}

function createHeaders(extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  const cookie = readArg("cookie", process.env.BENCH_COOKIE);
  const authorization = readArg(
    "authorization",
    process.env.BENCH_AUTHORIZATION,
  );
  const activeUnitId = readArg(
    "active-unit-id",
    process.env.BENCH_ACTIVE_UNIT_ID,
  );

  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);
  if (activeUnitId) headers.set("x-active-unit-id", activeUnitId);

  return headers;
}

async function timedFetch(baseUrl, endpoint) {
  const url = new URL(endpoint.path, baseUrl);
  const start = performance.now();
  let bytes = 0;
  let status = 0;
  let ok = false;
  let error;

  try {
    const method = endpoint.method ?? "GET";
    const headers = createHeaders(endpoint.headers);
    const requestInit = {
      method,
      headers,
    };

    if (endpoint.body !== undefined && method !== "GET" && method !== "HEAD") {
      headers.set("content-type", "application/json");
      requestInit.body = JSON.stringify(endpoint.body);
    }

    const response = await fetch(url, {
      ...requestInit,
    });

    status = response.status;
    const body = await response.arrayBuffer();
    bytes = body.byteLength;
    ok = response.ok;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  return {
    endpoint,
    status,
    ok,
    bytes,
    error,
    durationMs: performance.now() - start,
  };
}

async function runEndpoint(baseUrl, endpoint, options) {
  const latencies = [];
  const statuses = new Map();
  let bytes = 0;
  let failures = 0;
  let requests = 0;
  let nextAt = performance.now() + options.durationMs;

  async function worker() {
    while (performance.now() < nextAt) {
      const result = await timedFetch(baseUrl, endpoint);
      requests += 1;
      bytes += result.bytes;
      latencies.push(result.durationMs);
      statuses.set(result.status, (statuses.get(result.status) ?? 0) + 1);

      if (!result.ok) {
        failures += 1;
        if (result.error) {
          statuses.set(result.error, (statuses.get(result.error) ?? 0) + 1);
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: options.concurrency }, () => worker()),
  );
  latencies.sort((left, right) => left - right);

  return {
    name: endpoint.name ?? `${endpoint.method ?? "GET"} ${endpoint.path}`,
    requests,
    failures,
    bytes,
    statuses,
    rps: requests / (options.durationMs / 1000),
    avg: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    min: latencies[0] ?? 0,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies.at(-1) ?? 0,
  };
}

async function warmup(baseUrl, endpoints, requests) {
  for (const endpoint of endpoints) {
    for (let index = 0; index < requests; index += 1) {
      await timedFetch(baseUrl, endpoint);
    }
  }
}

function printResult(result) {
  const statuses = [...result.statuses.entries()]
    .map(([status, count]) => `${status}:${count}`)
    .join(" ");

  console.log(`\n${result.name}`);
  console.log(
    `  requests: ${result.requests} (${result.rps.toFixed(1)} req/s)`,
  );
  console.log(`  failures: ${result.failures}`);
  console.log(`  statuses: ${statuses || "none"}`);
  console.log(`  bytes: ${(result.bytes / 1024).toFixed(1)} KiB`);
  console.log(
    `  latency: avg ${formatMs(result.avg)} | min ${formatMs(result.min)} | p50 ${formatMs(result.p50)} | p95 ${formatMs(result.p95)} | p99 ${formatMs(result.p99)} | max ${formatMs(result.max)}`,
  );
}

const baseUrl = readArg(
  "base-url",
  process.env.BENCH_BASE_URL ?? "http://localhost:3000",
);
const concurrency = readNumberArg(
  "concurrency",
  Number(process.env.BENCH_CONCURRENCY ?? 5),
);
const durationSec = readNumberArg(
  "duration",
  Number(process.env.BENCH_DURATION ?? 20),
);
const warmupRequests = readNumberArg(
  "warmup",
  Number(process.env.BENCH_WARMUP ?? 2),
);
const endpoints = await loadEndpoints();

if (!process.env.BENCH_COOKIE && !readArg("cookie")) {
  console.warn(
    "No BENCH_COOKIE/--cookie provided. Authenticated endpoints may return 401.",
  );
}

console.log(`Benchmarking ${baseUrl}`);
console.log(
  `concurrency=${concurrency} duration=${durationSec}s warmup=${warmupRequests} requests/endpoint`,
);

await warmup(baseUrl, endpoints, warmupRequests);

for (const endpoint of endpoints) {
  const result = await runEndpoint(baseUrl, endpoint, {
    concurrency,
    durationMs: durationSec * 1000,
  });
  printResult(result);
}
