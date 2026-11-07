import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_RETRY_DELAY_MS, readSessionWithRetry } from "./session-retry";

describe("readSessionWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a first read that has a session without waiting", async () => {
    const read = vi.fn().mockResolvedValue({ data: { id: "s1" } });

    await expect(readSessionWithRetry(read)).resolves.toEqual({
      data: { id: "s1" },
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads once more after the retry delay when the first read has no session", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { id: "s2" } });

    const result = readSessionWithRetry(read);
    await vi.advanceTimersByTimeAsync(SESSION_RETRY_DELAY_MS - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ data: { id: "s2" } });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("retries after a thrown read and makes the second answer final", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: null });

    const result = readSessionWithRetry(read);
    await vi.advanceTimersByTimeAsync(SESSION_RETRY_DELAY_MS);

    await expect(result).resolves.toEqual({ data: null });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
