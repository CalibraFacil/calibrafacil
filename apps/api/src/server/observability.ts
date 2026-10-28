import { readObservabilityConfig } from "@calibra-facil/config";
import { countQueueJobsByStatus } from "@calibra-facil/db/queue";
import type { Context, Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { log } from "../lib/logger";
import type { Env } from "./env";

/**
 * Request id, access log and metrics of the API (roadmap 2 G2, review 3.6).
 *
 * - Every response carries `X-Request-Id`: the caller's, when it is a plain
 *   token (a proxy or a client correlating its own logs), else a new one.
 * - One JSON access-log line per request (`log("info", "http_request")`):
 *   method, route path (never the query string, which can carry tokens),
 *   status, duration, request id.
 * - In-process counters, served by `GET /api/metrics` in the Prometheus text
 *   format to a scraper holding `METRICS_TOKEN` (404 without it).
 */
export function applyRequestObservability(app: Hono<{ Bindings: Env }>) {
  app.use("*", async (c, next) => {
    const requestId = acceptableRequestId(c.req.header("x-request-id"));
    const startedAt = performance.now();
    c.header("X-Request-Id", requestId);
    try {
      await next();
    } finally {
      const durationMs = performance.now() - startedAt;
      const status = c.res.status;
      METRICS.observe(c.req.method, status, durationMs);
      log("info", "http_request", {
        requestId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status,
        durationMs: Math.round(durationMs),
      });
    }
  });
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

function acceptableRequestId(value: string | undefined): string {
  return value && REQUEST_ID_PATTERN.test(value) ? value : crypto.randomUUID();
}

const DURATION_BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

class RequestMetrics {
  private readonly requests = new Map<string, number>();
  private readonly buckets = DURATION_BUCKETS_MS.map(() => 0);
  private count = 0;
  private sumMs = 0;

  observe(method: string, status: number, durationMs: number) {
    const key = `${method}|${Math.floor(status / 100)}xx`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    this.count += 1;
    this.sumMs += durationMs;
    DURATION_BUCKETS_MS.forEach((bound, index) => {
      if (durationMs <= bound)
        this.buckets[index] = (this.buckets[index] ?? 0) + 1;
    });
  }

  render(): string[] {
    const lines = [
      "# HELP calibra_http_requests_total HTTP requests served, by method and status class.",
      "# TYPE calibra_http_requests_total counter",
    ];
    for (const [key, value] of [...this.requests].sort()) {
      const [method, status] = key.split("|");
      lines.push(
        `calibra_http_requests_total{method="${method}",status="${status}"} ${value}`,
      );
    }
    lines.push(
      "# HELP calibra_http_request_duration_seconds Request duration.",
      "# TYPE calibra_http_request_duration_seconds histogram",
    );
    DURATION_BUCKETS_MS.forEach((bound, index) => {
      lines.push(
        `calibra_http_request_duration_seconds_bucket{le="${bound / 1000}"} ${this.buckets[index] ?? 0}`,
      );
    });
    lines.push(
      `calibra_http_request_duration_seconds_bucket{le="+Inf"} ${this.count}`,
      `calibra_http_request_duration_seconds_sum ${(this.sumMs / 1000).toFixed(3)}`,
      `calibra_http_request_duration_seconds_count ${this.count}`,
    );
    return lines;
  }
}

const METRICS = new RequestMetrics();

export type CronAge = { job: string; lastSuccessAt: Date | null };

/** The Prometheus text of the API: request counters plus the queue and the crons. */
export function renderMetrics(input: {
  queue: { pending: number; processing: number; failed: number };
  crons: readonly CronAge[];
  now: Date;
  requests?: RequestMetrics;
}): string {
  const lines = [...(input.requests ?? METRICS).render()];
  lines.push(
    "# HELP calibra_queue_jobs Background jobs in the database queue, by status (failed: dead letters).",
    "# TYPE calibra_queue_jobs gauge",
    `calibra_queue_jobs{status="pending"} ${input.queue.pending}`,
    `calibra_queue_jobs{status="processing"} ${input.queue.processing}`,
    `calibra_queue_jobs{status="failed"} ${input.queue.failed}`,
    "# HELP calibra_cron_last_success_age_seconds Seconds since each scheduled job last succeeded.",
    "# TYPE calibra_cron_last_success_age_seconds gauge",
  );
  for (const cron of [...input.crons].sort((a, b) =>
    a.job.localeCompare(b.job),
  )) {
    if (!cron.lastSuccessAt) continue;
    const age = (input.now.getTime() - cron.lastSuccessAt.getTime()) / 1000;
    lines.push(
      `calibra_cron_last_success_age_seconds{job="${cron.job}"} ${Math.max(0, Math.round(age))}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export { RequestMetrics };

/** Whether the request carries `Authorization: Bearer <METRICS_TOKEN>`. */
export function metricsAuthorized(c: Context<{ Bindings: Env }>): boolean {
  const expected = readObservabilityConfig().metricsToken;
  if (!expected) return false;
  const header = c.req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return false;
  const given = Buffer.from(match[1].trim());
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export async function readQueueForMetrics() {
  return countQueueJobsByStatus();
}
