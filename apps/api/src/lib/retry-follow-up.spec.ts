import { describe, expect, it, vi } from "vitest";
import { retryFollowUp } from "./retry-follow-up";

describe("retryFollowUp", () => {
  it("returns the first success without retrying", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    await expect(retryFollowUp(run, [1, 1])).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries a failing attempt and returns the success", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("ok");
    await expect(retryFollowUp(run, [1, 1])).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("makes 3 attempts by default and rethrows the last failure", async () => {
    const run = vi.fn().mockRejectedValue(new Error("down"));
    await expect(retryFollowUp(run)).rejects.toThrow("down");
    expect(run).toHaveBeenCalledTimes(3);
  });
});
