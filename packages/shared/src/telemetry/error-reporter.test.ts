import { describe, expect, it, vi } from "vitest";
import {
  buildErrorEvent,
  createErrorReporter,
  parseSentryDsn,
  parseStackFrames,
  sanitizeErrorMessage,
} from "./error-reporter";

const DSN = "https://publickey123@o123.ingest.us.sentry.io/456";

describe("parseSentryDsn", () => {
  it("extracts the envelope endpoint and public key", () => {
    expect(parseSentryDsn(DSN)).toEqual({
      endpoint: "https://o123.ingest.us.sentry.io/api/456/envelope/",
      publicKey: "publickey123",
    });
  });

  it("rejects malformed DSNs instead of throwing", () => {
    expect(parseSentryDsn("not a dsn")).toBeNull();
    expect(parseSentryDsn("https://host.example/123")).toBeNull(); // no key
    expect(parseSentryDsn("https://key@host.example/")).toBeNull(); // no project
  });
});

describe("sanitizeErrorMessage (redaction)", () => {
  it("scrubs credentials embedded in connection strings", () => {
    const sanitized = sanitizeErrorMessage(
      "connect failed: postgres://calibra:hunter2@ep-x.neon.tech/db",
    );
    expect(sanitized).not.toContain("hunter2");
    expect(sanitized).toContain("postgres://***@ep-x.neon.tech/db");
  });

  it("scrubs bearer tokens and secret-ish key=value pairs", () => {
    const sanitized = sanitizeErrorMessage(
      "401 with Authorization: Bearer abc.def.ghi and api_key=sk_live_123",
    );
    expect(sanitized).not.toContain("abc.def.ghi");
    expect(sanitized).not.toContain("sk_live_123");
  });

  it("scrubs JWTs and long opaque tokens", () => {
    const jwt = `eyJ${"a".repeat(12)}.eyJ${"b".repeat(12)}.${"c".repeat(12)}`;
    const opaque = "A".repeat(48);
    const sanitized = sanitizeErrorMessage(`token ${jwt} blob ${opaque}`);
    expect(sanitized).not.toContain(jwt);
    expect(sanitized).not.toContain(opaque);
  });

  it("keeps ordinary diagnostic text intact", () => {
    expect(sanitizeErrorMessage('relation "app_queue_job" does not exist')).toBe(
      'relation "app_queue_job" does not exist',
    );
  });
});

describe("parseStackFrames", () => {
  it("parses V8 frames oldest-first and flags in_app", () => {
    const stack = [
      "Error: boom",
      "    at renderCertificate (/var/task/apps/worker/src/index.ts:120:11)",
      "    at process (/var/task/node_modules/hono/dist/index.js:5:3)",
      "    at /var/task/apps/api/src/app.ts:9:1",
    ].join("\n");

    const frames = parseStackFrames(stack);
    expect(frames).toHaveLength(3);
    // Sentry wants oldest call first.
    expect(frames[2]).toMatchObject({
      function: "renderCertificate",
      filename: "/var/task/apps/worker/src/index.ts",
      lineno: 120,
      colno: 11,
      in_app: true,
    });
    expect(frames[1]?.in_app).toBe(false); // node_modules
    expect(frames[0]?.function).toBe("<anonymous>");
  });
});

describe("buildErrorEvent", () => {
  it("builds a redacted event with structural tags", () => {
    const event = buildErrorEvent(
      new Error("password=topsecret leaked"),
      {
        tags: { surface: "api", path: "/api/jobs" },
        environment: "production",
      },
    );

    expect(event.level).toBe("error");
    expect(event.tags).toEqual({ surface: "api", path: "/api/jobs" });
    expect(event.exception.values[0]?.type).toBe("Error");
    expect(event.exception.values[0]?.value).not.toContain("topsecret");
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("copes with non-Error throwables", () => {
    const event = buildErrorEvent("string failure");
    expect(event.exception.values[0]).toMatchObject({
      type: "Error",
      value: "string failure",
    });
  });
});

describe("createErrorReporter", () => {
  it("is a no-op without a DSN and never throws", async () => {
    const reporter = createErrorReporter({ dsn: undefined });
    reporter.captureException(new Error("x"));
    await reporter.flush();
  });

  it("POSTs an envelope with auth header and flush awaits delivery", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const reporter = createErrorReporter({
      dsn: DSN,
      environment: "test",
      fetchImpl,
    });

    reporter.captureException(new Error("boom"), {
      tags: { surface: "worker" },
    });
    await reporter.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://o123.ingest.us.sentry.io/api/456/envelope/");
    const headers = Object(init).headers;
    expect(headers["X-Sentry-Auth"]).toContain("sentry_key=publickey123");
    const body = String(Object(init).body);
    const [envelopeHeader, itemHeader, payload] = body.trim().split("\n");
    expect(JSON.parse(String(envelopeHeader)).dsn).toBe(DSN);
    expect(JSON.parse(String(itemHeader))).toEqual({ type: "event" });
    expect(JSON.parse(String(payload)).tags).toEqual({ surface: "worker" });
  });

  it("swallows transport failures (non-interfering)", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const reporter = createErrorReporter({
      dsn: DSN,
      fetchImpl: vi.fn(async () => {
        throw new Error("network down");
      }),
    });

    reporter.captureException(new Error("boom"));
    await reporter.flush();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("sheds captures beyond the in-flight cap instead of queueing unbounded", async () => {
    let resolveAll: () => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      resolveAll = () => resolve(new Response("{}"));
    });
    const fetchImpl = vi.fn(() => gate);
    const reporter = createErrorReporter({ dsn: DSN, fetchImpl });

    for (let i = 0; i < 30; i += 1) {
      reporter.captureException(new Error(`e${i}`));
    }
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(20);
    resolveAll();
    await reporter.flush();
  });
});
