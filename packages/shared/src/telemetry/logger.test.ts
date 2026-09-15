import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
});

function lastLine(spy: {
  mock: { calls: unknown[][] };
}): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  return JSON.parse(String(call?.[0]));
}

describe("createLogger", () => {
  it("emits single-line JSON with ts/level/tag/msg and fields", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    createLogger("Worker").error("job failed", { jobId: 42, attempts: 2 });

    const line = lastLine(spy);
    expect(line).toMatchObject({
      level: "error",
      tag: "Worker",
      msg: "job failed",
      jobId: 42,
      attempts: 2,
    });
    expect(typeof line.ts).toBe("string");
  });

  it("serializes Error fields to name+message instead of {}", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createLogger("Cron").warn("task failed", {
      error: new Error("gotenberg 502"),
    });

    expect(lastLine(spy).error).toEqual({
      name: "Error",
      message: "gotenberg 502",
    });
  });

  it("with() stamps base fields on every line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    createLogger("JOB").with({ jobId: 7 }).info("rendered");

    expect(lastLine(spy)).toMatchObject({ tag: "JOB", jobId: 7 });
  });

  it("never throws on circular fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      createLogger("API").info("odd payload", { circular }),
    ).not.toThrow();
    expect(lastLine(spy)).toMatchObject({ serialization: "failed" });
  });
});
