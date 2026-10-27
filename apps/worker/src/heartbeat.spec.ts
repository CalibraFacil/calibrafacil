import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { touchHeartbeat } from "./heartbeat.js";

describe("worker heartbeat", () => {
  const scratch: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("writes the current time, and again on the next call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "heartbeat-"));
    scratch.push(dir);
    const path = join(dir, "beat");
    await touchHeartbeat(path, () => 1_000);
    expect(await readFile(path, "utf8")).toBe("1000\n");
    await touchHeartbeat(path, () => 2_000);
    expect(await readFile(path, "utf8")).toBe("2000\n");
  });

  it("does not throw when the file cannot be written", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      touchHeartbeat("/nonexistent-directory/beat"),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });
});
