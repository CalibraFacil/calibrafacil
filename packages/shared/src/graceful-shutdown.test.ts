import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installGracefulShutdown,
  runGracefulShutdown,
  type ShutdownLogger,
  type ShutdownPlan,
} from "./graceful-shutdown";

function silentLogger(): ShutdownLogger & {
  errors: string[];
  infos: string[];
} {
  const errors: string[] = [];
  const infos: string[] = [];
  return {
    errors,
    infos,
    info: (message) => infos.push(message),
    error: (message) => errors.push(message),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runGracefulShutdown", () => {
  it("stops, drains, then closes, in that order", async () => {
    const order: string[] = [];
    const plan: ShutdownPlan = {
      stop: [{ name: "server", run: () => void order.push("stop") }],
      drain: [
        {
          name: "jobs",
          run: async () => {
            await Promise.resolve();
            order.push("drain");
          },
        },
      ],
      close: [{ name: "pool", run: () => void order.push("close") }],
      deadlineMs: 1_000,
    };

    const result = await runGracefulShutdown(plan, {
      logger: silentLogger(),
    });

    expect(order).toEqual(["stop", "drain", "close"]);
    expect(result).toEqual({ clean: true, failed: [] });
  });

  it("waits for in-flight work that finishes before the deadline", async () => {
    let finished = false;
    const closed = vi.fn();
    const result = runGracefulShutdown(
      {
        stop: [],
        drain: [
          {
            name: "render",
            run: () =>
              new Promise<void>((resolve) =>
                setTimeout(() => {
                  finished = true;
                  resolve();
                }, 4_000),
              ),
          },
        ],
        close: [{ name: "pool", run: closed }],
        deadlineMs: 25_000,
      },
      { logger: silentLogger() },
    );

    await vi.advanceTimersByTimeAsync(3_999);
    expect(closed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(finished).toBe(true);
    await expect(result).resolves.toEqual({ clean: true, failed: [] });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("gives up at the deadline, names the work still running, and still closes", async () => {
    const logger = silentLogger();
    const closed = vi.fn();
    const result = runGracefulShutdown(
      {
        stop: [],
        drain: [{ name: "render", run: () => new Promise<void>(() => {}) }],
        close: [{ name: "pool", run: closed }],
        deadlineMs: 25_000,
      },
      { logger },
    );

    await vi.advanceTimersByTimeAsync(24_999);
    expect(closed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ clean: false, failed: ["render"] });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(logger.errors.join("\n")).toContain("render");
  });

  it("does not let a stuck close step hang the exit", async () => {
    const result = runGracefulShutdown(
      {
        stop: [],
        drain: [],
        close: [{ name: "pool", run: () => new Promise<void>(() => {}) }],
        deadlineMs: 25_000,
      },
      { logger: silentLogger() },
    );

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toMatchObject({ failed: ["pool"] });
  });

  it("keeps going when a step throws, and reports it", async () => {
    const closed = vi.fn();
    const logger = silentLogger();
    const result = await runGracefulShutdown(
      {
        stop: [
          {
            name: "server",
            run: () => {
              throw new Error("already closed");
            },
          },
        ],
        drain: [],
        close: [{ name: "pool", run: closed }],
        deadlineMs: 1_000,
      },
      { logger },
    );

    expect(closed).toHaveBeenCalledTimes(1);
    expect(result.failed).toEqual(["server"]);
    expect(logger.errors[0]).toContain("server");
  });
});

describe("installGracefulShutdown", () => {
  function install(plan: Partial<ShutdownPlan> = {}) {
    const handlers = new Map<string, () => void>();
    const exit = vi.fn();
    const handle = installGracefulShutdown(
      { stop: [], drain: [], close: [], deadlineMs: 1_000, ...plan },
      {
        logger: silentLogger(),
        onSignal: (signal, handler) => handlers.set(signal, handler),
        exit,
      },
    );
    return { handlers, exit, handle };
  }

  it("listens for SIGTERM and SIGINT", () => {
    const { handlers } = install();

    expect([...handlers.keys()].toSorted()).toEqual(["SIGINT", "SIGTERM"]);
  });

  it("exits 0 after a clean shutdown", async () => {
    const stop = vi.fn();
    const { handlers, exit } = install({ stop: [{ name: "s", run: stop }] });

    handlers.get("SIGTERM")?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("exits 1 when the deadline passed", async () => {
    const { handlers, exit } = install({
      drain: [{ name: "render", run: () => new Promise<void>(() => {}) }],
    });

    handlers.get("SIGTERM")?.();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("runs the plan once, and a second signal exits at once", async () => {
    const stop = vi.fn();
    const { handlers, exit } = install({
      stop: [{ name: "s", run: stop }],
      drain: [{ name: "render", run: () => new Promise<void>(() => {}) }],
    });

    handlers.get("SIGTERM")?.();
    await vi.advanceTimersByTimeAsync(10);
    handlers.get("SIGINT")?.();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
