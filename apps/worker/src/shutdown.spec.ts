import { runGracefulShutdown } from "@calibra-facil/shared/graceful-shutdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPollLoop } from "./poll-loop";
import { createWorkerShutdownPlan } from "./shutdown";

const quiet = { info: () => {}, error: () => {} };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("worker shutdown plan", () => {
  it("lets the job in hand finish, claims nothing more, then closes the pools", async () => {
    const closeDatabases = vi.fn(async () => {});
    let finishJob: () => void = () => {};
    let claimedAfterStop = 0;
    const loop = createPollLoop({
      intervalMs: 1_000,
      task: async (isStopping) => {
        await new Promise<void>((resolve) => {
          finishJob = resolve;
        });
        // The batch loop checks this before claiming the next row.
        if (!isStopping()) claimedAfterStop += 1;
      },
      onError: vi.fn(),
    });
    loop.start();

    const plan = createWorkerShutdownPlan({
      stopWork: () => loop.stop(),
      closeDatabases,
      deadlineMs: 25_000,
    });
    const result = runGracefulShutdown(plan, { logger: quiet });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(closeDatabases).not.toHaveBeenCalled();

    finishJob();
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ clean: true, failed: [] });
    expect(closeDatabases).toHaveBeenCalledTimes(1);
    expect(claimedAfterStop).toBe(0);
  });

  it("gives up on a job that outlives the deadline (its lease expires and another worker takes it)", async () => {
    const closeDatabases = vi.fn(async () => {});
    const loop = createPollLoop({
      intervalMs: 1_000,
      task: () => new Promise<void>(() => {}),
      onError: vi.fn(),
    });
    loop.start();

    const result = runGracefulShutdown(
      createWorkerShutdownPlan({
        stopWork: () => loop.stop(),
        closeDatabases,
        deadlineMs: 25_000,
      }),
      { logger: quiet },
    );
    await vi.advanceTimersByTimeAsync(25_000);

    await expect(result).resolves.toEqual({
      clean: false,
      failed: ["job in progress"],
    });
    expect(closeDatabases).toHaveBeenCalledTimes(1);
  });

  it("closes the listener of the HTTP drain server when there is one", async () => {
    const stopListening = vi.fn();

    await runGracefulShutdown(
      createWorkerShutdownPlan({
        stopWork: async () => {},
        stopListening,
        closeDatabases: async () => {},
        deadlineMs: 1_000,
      }),
      { logger: quiet },
    );

    expect(stopListening).toHaveBeenCalledTimes(1);
  });
});
