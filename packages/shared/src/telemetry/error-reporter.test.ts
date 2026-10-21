import { describe, expect, it, vi } from "vitest";
import {
  buildErrorLogRecord,
  createLogErrorReporter,
  sanitizeErrorMessage,
  sanitizeErrorStack,
} from "./error-reporter";

function capture(
  error: unknown,
  tags?: Record<string, string>,
  options: Parameters<typeof createLogErrorReporter>[0] = {},
): Record<string, unknown> {
  const lines: string[] = [];
  const reporter = createLogErrorReporter({
    ...options,
    write: (line) => lines.push(line),
  });
  reporter.captureException(error, tags ? { tags } : undefined);
  expect(lines).toHaveLength(1);
  return JSON.parse(String(lines[0]));
}

describe("sanitizeErrorMessage (redaction)", () => {
  it("scrubs credentials embedded in connection strings", () => {
    const sanitized = sanitizeErrorMessage(
      "connect failed: postgres://calibra:hunter2@db.internal/app",
    );
    expect(sanitized).not.toContain("hunter2");
    expect(sanitized).toContain("postgres://***@db.internal/app");
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
    expect(
      sanitizeErrorMessage('relation "app_queue_job" does not exist'),
    ).toBe('relation "app_queue_job" does not exist');
  });

  it("scrubs the stack, whose first line repeats the message", () => {
    const sanitized = sanitizeErrorStack(
      "Error: password=topsecret leaked\n    at run (/app/src/index.ts:1:1)",
    );
    expect(sanitized).not.toContain("topsecret");
    expect(sanitized).toContain("at run (/app/src/index.ts:1:1)");
  });
});

describe("createLogErrorReporter", () => {
  it("REQ-NS-2 writes one JSON line with level, message, name, stack, tags, service, environment, release and timestamp", () => {
    const record = capture(
      new TypeError("boom"),
      { surface: "api" },
      { service: "api", environment: "production", release: "abc123" },
    );

    expect(record).toMatchObject({
      level: "error",
      message: "boom",
      name: "TypeError",
      tags: { surface: "api" },
      service: "api",
      environment: "production",
      release: "abc123",
    });
    expect(String(record.stack)).toContain("TypeError: boom");
    expect(new Date(String(record.timestamp)).toISOString()).toBe(
      record.timestamp,
    );
  });

  it("REQ-NS-2 defaults tags to an empty object and omits unset metadata", () => {
    const record = capture(new Error("x"));
    expect(record.tags).toEqual({});
    expect(record).not.toHaveProperty("service");
    expect(record).not.toHaveProperty("environment");
    expect(record).not.toHaveProperty("release");
  });

  it("REQ-NS-2 redacts secrets from the message and the stack", () => {
    const record = capture(new Error("password=topsecret leaked"));
    expect(JSON.stringify(record)).not.toContain("topsecret");
    expect(record.message).toBe("password=*** leaked");
  });

  it("REQ-NS-2 emits only the documented fields (no bodies, headers, cookies or env)", () => {
    const error = Object.assign(new Error("boom"), {
      body: { cpf: "123" },
      headers: { cookie: "session=1" },
      env: { DATABASE_URL: "postgres://u:p@h/d" },
    });
    const record = capture(error);
    expect(Object.keys(record).toSorted()).toEqual(
      ["level", "message", "name", "stack", "tags", "timestamp"].toSorted(),
    );
    expect(JSON.stringify(record)).not.toContain("session=1");
    expect(JSON.stringify(record)).not.toContain("DATABASE_URL");
  });

  it("REQ-NS-2 copes with non-Error throwables", () => {
    expect(capture("string failure")).toMatchObject({
      name: "Error",
      message: "string failure",
    });
    expect(capture({ toString: () => "object failure" })).toMatchObject({
      message: "object failure",
    });
  });

  it("REQ-NS-2 never throws, even when the throwable or the sink misbehave", async () => {
    const hostile = {
      toString() {
        throw new Error("nope");
      },
    };
    const lines: string[] = [];
    const reporter = createLogErrorReporter({ write: (l) => lines.push(l) });
    expect(() => reporter.captureException(hostile)).not.toThrow();
    expect(JSON.parse(String(lines[0])).message).toBe(
      "unserializable throwable",
    );

    const broken = createLogErrorReporter({
      write: () => {
        throw new Error("stderr closed");
      },
    });
    expect(() => broken.captureException(new Error("x"))).not.toThrow();
    await broken.flush();
  });

  it("REQ-NS-2 flush resolves immediately", async () => {
    const reporter = createLogErrorReporter({ write: () => {} });
    await expect(reporter.flush(5_000)).resolves.toBeUndefined();
  });

  it("REQ-NS-2 writes to stderr via console.error by default", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    createLogErrorReporter({ service: "worker" }).captureException(
      new Error("boom"),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({
      service: "worker",
      message: "boom",
    });
    spy.mockRestore();
  });
});

describe("buildErrorLogRecord", () => {
  it("falls back to the name Error for anonymous error names", () => {
    const error = new Error("x");
    error.name = "";
    expect(buildErrorLogRecord(error).name).toBe("Error");
  });
});
