import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPollLoop } from "./poll-loop";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createPollLoop", () => {
  it("runs the first tick at once, then one interval after each tick ends", async () => {
    const task = vi.fn(async () => {});
    const loop = createPollLoop({ intervalMs: 2_000, task, onError: vi.fn() });

    loop.start();
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);

    await loop.stop();
  });

  it("never overlaps ticks: a slow tick delays the next one instead of racing it", async () => {
    let running = 0;
    let maxRunning = 0;
    let ticks = 0;
    const task = async () => {
      ticks += 1;
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      // Slower than the interval: a setInterval would start two of these at once.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      running -= 1;
    };
    const loop = createPollLoop({ intervalMs: 1_000, task, onError: vi.fn() });

    loop.start();
    await vi.advanceTimersByTimeAsync(30_000);
    const stopping = loop.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;

    expect(maxRunning).toBe(1);
    expect(ticks).toBeGreaterThan(3);
    // 5 s of work + 1 s pause per tick, not one tick per second.
    expect(ticks).toBeLessThanOrEqual(6);
  });

  it("reports a failing tick and keeps polling", async () => {
    const onError = vi.fn();
    const task = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue(undefined);
    const loop = createPollLoop({ intervalMs: 1_000, task, onError });

    loop.start();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(task).toHaveBeenCalledTimes(2);
    await loop.stop();
  });

  it("stop() starts no further tick and waits for the one in progress", async () => {
    let finishTick: () => void = () => {};
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTick = resolve;
        }),
    );
    const loop = createPollLoop({ intervalMs: 1_000, task, onError: vi.fn() });
    loop.start();

    let stopped = false;
    const stopping = loop.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stopped).toBe(false);
    expect(loop.isStopping()).toBe(true);

    finishTick();
    await stopping;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(stopped).toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("tells the tick that a shutdown has begun", async () => {
    let seen: (() => boolean) | undefined;
    let finishTick: () => void = () => {};
    const loop = createPollLoop({
      intervalMs: 1_000,
      task: (isStopping) => {
        seen = isStopping;
        return new Promise<void>((resolve) => {
          finishTick = resolve;
        });
      },
      onError: vi.fn(),
    });
    loop.start();
    expect(seen?.()).toBe(false);

    const stopping = loop.stop();
    expect(seen?.()).toBe(true);
    finishTick();
    await stopping;
  });

  it("stop() before start() is a no-op that keeps the loop from starting", async () => {
    const task = vi.fn(async () => {});
    const loop = createPollLoop({ intervalMs: 1_000, task, onError: vi.fn() });

    await loop.stop();
    loop.start();

    expect(task).not.toHaveBeenCalled();
  });
});
