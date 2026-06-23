import { describe, expect, it, vi } from "vitest";
import { isTransientConnectionError, withDbWakeRetry } from "./db-retry";

describe("isTransientConnectionError", () => {
  it("matches transient connection errors by message", () => {
    expect(
      isTransientConnectionError(
        new Error("Connection terminated unexpectedly"),
      ),
    ).toBe(true);
    expect(
      isTransientConnectionError(
        new Error("the database system is starting up"),
      ),
    ).toBe(true);
    expect(isTransientConnectionError(new Error("fetch failed"))).toBe(true);
  });

  it("matches by postgres-style error code", () => {
    const error = Object.assign(new Error("write CONNECT_TIMEOUT"), {
      code: "CONNECT_TIMEOUT",
    });
    expect(isTransientConnectionError(error)).toBe(true);

    const reset = Object.assign(new Error("read"), { code: "ECONNRESET" });
    expect(isTransientConnectionError(reset)).toBe(true);
  });

  it("does NOT match deterministic application errors", () => {
    expect(
      isTransientConnectionError(
        new Error("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"),
      ),
    ).toBe(false);
    expect(
      isTransientConnectionError(new Error("Convite não encontrado")),
    ).toBe(false);
    expect(isTransientConnectionError(null)).toBe(false);
    expect(isTransientConnectionError(undefined)).toBe(false);
  });
});

describe("withDbWakeRetry", () => {
  it("returns the result when the operation succeeds first try", async () => {
    const op = vi.fn().mockResolvedValue("ok");
    await expect(withDbWakeRetry(op, { baseDelayMs: 0 })).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures then succeeds", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection terminated"))
      .mockRejectedValueOnce(new Error("the database system is starting up"))
      .mockResolvedValue("ok");

    await expect(
      withDbWakeRetry(op, { attempts: 3, baseDelayMs: 0 }),
    ).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("rethrows immediately on a non-transient error (no retry)", async () => {
    const op = vi.fn().mockRejectedValue(new Error("Convite não encontrado"));
    await expect(
      withDbWakeRetry(op, { attempts: 3, baseDelayMs: 0 }),
    ).rejects.toThrow("Convite não encontrado");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("rethrows the last error after exhausting attempts", async () => {
    const op = vi.fn().mockRejectedValue(new Error("Connection terminated"));
    await expect(
      withDbWakeRetry(op, { attempts: 2, baseDelayMs: 0 }),
    ).rejects.toThrow("Connection terminated");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("invokes onRetry for each retry", async () => {
    const onRetry = vi.fn();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("ok");

    await withDbWakeRetry(op, { baseDelayMs: 0, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });
});
