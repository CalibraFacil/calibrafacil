import { runGracefulShutdown } from "@calibra-facil/shared/graceful-shutdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInFlightRuns } from "../lib/cron-scheduler";
import { createApiShutdownPlan, type ApiShutdownParts } from "./shutdown";

const quiet = { info: () => {}, error: () => {} };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function parts(overrides: Partial<ApiShutdownParts>): ApiShutdownParts {
  return {
    stopServer: async () => {},
    stopCron: () => {},
    inFlightCron: createInFlightRuns(),
    closeDatabases: async () => {},
    flushErrors: async () => {},
    deadlineMs: 25_000,
    ...overrides,
  };
}

describe("API shutdown plan", () => {
  it("stops the listener and the schedule first, then closes the pools last", async () => {
    const order: string[] = [];
    const plan = createApiShutdownPlan(
      parts({
        stopServer: async () => void order.push("server.stop"),
        stopCron: () => void order.push("cron.stop"),
        flushErrors: async () => void order.push("flush"),
        closeDatabases: async () => void order.push("pools.close"),
      }),
    );

    const result = await runGracefulShutdown(plan, { logger: quiet });

    expect(result.clean).toBe(true);
    expect(order.slice(0, 2).toSorted()).toEqual(["cron.stop", "server.stop"]);
    expect(order.at(-1)).toBe("pools.close");
  });

  it("keeps the pools open while a request or a cron run is still in flight", async () => {
    let finishRequest: () => void = () => {};
    let finishCron: () => void = () => {};
    const closeDatabases = vi.fn(async () => {});
    const inFlightCron = createInFlightRuns();
    void inFlightCron.track(
      new Promise<void>((resolve) => {
        finishCron = resolve;
      }),
    );
    const plan = createApiShutdownPlan(
      parts({
        inFlightCron,
        closeDatabases,
        stopServer: () =>
          new Promise<void>((resolve) => {
            finishRequest = resolve;
          }),
      }),
    );

    const result = runGracefulShutdown(plan, { logger: quiet });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(closeDatabases).not.toHaveBeenCalled();

    finishRequest();
    await vi.advanceTimersByTimeAsync(1);
    expect(closeDatabases).not.toHaveBeenCalled();

    finishCron();
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ clean: true, failed: [] });
    expect(closeDatabases).toHaveBeenCalledTimes(1);
  });

  it("gives up on a request that outlives the deadline and still closes the pools", async () => {
    const closeDatabases = vi.fn(async () => {});
    const plan = createApiShutdownPlan(
      parts({
        closeDatabases,
        stopServer: () => new Promise<void>(() => {}),
        deadlineMs: 5_000,
      }),
    );

    const result = runGracefulShutdown(plan, { logger: quiet });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toEqual({
      clean: false,
      failed: ["in-flight requests"],
    });
    expect(closeDatabases).toHaveBeenCalledTimes(1);
  });
});

describe("createInFlightRuns", () => {
  it("is idle at once when nothing runs, and waits for runs started meanwhile", async () => {
    const runs = createInFlightRuns();
    await runs.idle();

    let finishSecond: () => void = () => {};
    const first = Promise.resolve();
    void runs.track(first);
    void first.then(() =>
      runs.track(
        new Promise<void>((resolve) => {
          finishSecond = resolve;
        }),
      ),
    );

    let idle = false;
    void runs.idle().then(() => {
      idle = true;
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(idle).toBe(false);

    finishSecond();
    await vi.advanceTimersByTimeAsync(1);
    expect(idle).toBe(true);
  });
});
