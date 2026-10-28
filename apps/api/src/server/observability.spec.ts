import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyRequestObservability,
  metricsAuthorized,
  renderMetrics,
  RequestMetrics,
} from "./observability";
import type { Env } from "./env";

describe("request observability (roadmap 2 G2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function app() {
    const hono = new Hono<{ Bindings: Env }>();
    applyRequestObservability(hono);
    hono.get("/api/x", (c) => c.json({ ok: true }));
    hono.get("/api/metrics-probe", (c) =>
      c.json({ authorized: metricsAuthorized(c) }),
    );
    return hono;
  }

  it("answers a request id (the caller's plain token, else a new one) and logs one access line without the query", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });

    const given = await app().request("/api/x?token=secret", {
      headers: { "x-request-id": "req-1234abcd" },
    });
    const forged = await app().request("/api/x", {
      headers: { "x-request-id": "<script>" },
    });

    expect(given.headers.get("x-request-id")).toBe("req-1234abcd");
    expect(forged.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const first = JSON.parse(lines[0] ?? "{}");
    expect(first).toMatchObject({
      level: "info",
      event: "http_request",
      requestId: "req-1234abcd",
      method: "GET",
      path: "/api/x",
      status: 200,
    });
    expect(lines[0]).not.toContain("secret");
  });

  it("serves /api/metrics only to the METRICS_TOKEN bearer", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const probe = async (headers: Record<string, string>) =>
      (await (await app().request("/api/metrics-probe", { headers })).json())
        .authorized;

    expect(await probe({ authorization: "Bearer t0k3n-long-enough" })).toBe(
      false,
    );
    vi.stubEnv("METRICS_TOKEN", "t0k3n-long-enough");
    expect(await probe({ authorization: "Bearer t0k3n-long-enough" })).toBe(
      true,
    );
    expect(await probe({ authorization: "Bearer wrong" })).toBe(false);
    expect(await probe({})).toBe(false);
  });

  it("renders requests, latency, queue and cron age in the Prometheus text format", () => {
    const requests = new RequestMetrics();
    requests.observe("GET", 200, 30);
    requests.observe("POST", 503, 1200);
    const text = renderMetrics({
      requests,
      queue: { pending: 2, processing: 1, failed: 4 },
      crons: [
        {
          job: "queue-backstop",
          lastSuccessAt: new Date("2026-10-27T11:59:00Z"),
        },
        { job: "records-purge", lastSuccessAt: null },
      ],
      now: new Date("2026-10-27T12:00:00Z"),
    });

    expect(text).toContain(
      'calibra_http_requests_total{method="GET",status="2xx"} 1',
    );
    expect(text).toContain(
      'calibra_http_requests_total{method="POST",status="5xx"} 1',
    );
    expect(text).toContain(
      'calibra_http_request_duration_seconds_bucket{le="0.05"} 1',
    );
    expect(text).toContain(
      'calibra_http_request_duration_seconds_bucket{le="+Inf"} 2',
    );
    expect(text).toContain('calibra_queue_jobs{status="failed"} 4');
    expect(text).toContain(
      'calibra_cron_last_success_age_seconds{job="queue-backstop"} 60',
    );
    expect(text).not.toContain('job="records-purge"');
  });
});
