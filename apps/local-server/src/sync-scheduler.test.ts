import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncStatusSnapshot } from "@calibra-facil/contracts";

import { createLocalSyncScheduler } from "./sync-scheduler";
import type { LocalSyncRuntime } from "./sync";

function snapshot(
  overrides: Partial<SyncStatusSnapshot> = {},
): SyncStatusSnapshot {
  return {
    state: "idle",
    pendingOutboxCount: 0,
    conflictCount: 0,
    lastSyncedAt: null,
    activeRunId: null,
    lastRunId: null,
    lastError: null,
    ...overrides,
  };
}

/**
 * A runtime whose runs we control: each `runPushSync()` hands back a deferred
 * so a test can hold a run open and observe what the scheduler does mid-run.
 */
function createControllableRuntime() {
  const calls: Array<{
    resolve(value?: SyncStatusSnapshot): void;
    reject(error: unknown): void;
  }> = [];

  const runtime: LocalSyncRuntime = {
    getStatus: () => snapshot(),
    runInitialSync: async () => snapshot(),
    runPushSync: () =>
      new Promise<SyncStatusSnapshot>((resolve, reject) => {
        calls.push({
          resolve: (value) => resolve(value ?? snapshot()),
          reject,
        });
      }),
  };

  return {
    runtime,
    calls,
    async settleLast(value?: SyncStatusSnapshot) {
      calls[calls.length - 1]?.resolve(value);
      await vi.advanceTimersByTimeAsync(0);
    },
    async failLast(error: Error) {
      calls[calls.length - 1]?.reject(error);
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

describe("scheduling from the run's own result", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps draining while the outbox still has queued events", async () => {
    // The push leg drains a bounded batch, so a real offline burst needs more
    // than one run. Waiting a full poll between batches leaves a technician's
    // reconnect half-drained, with every remaining record's cloud actions
    // still blocked.
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      pollIntervalMs: 120_000,
      drainIntervalMs: 1_000,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.settleLast(snapshot({ pendingOutboxCount: 40 }));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.calls).toHaveLength(2);

    // Queue drained: back to the idle poll.
    await controller.settleLast(snapshot({ pendingOutboxCount: 0 }));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(controller.calls).toHaveLength(2);

    scheduler.stop();
  });

  it("treats a run the cloud rejected events in as a failure", async () => {
    // `runPushSync` resolves with state "error" when the request succeeded but
    // events inside it were rejected. Counting that as success would retry a
    // permanent validation failure at full poll rate forever.
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      backoffBaseMs: 1_000,
      random: () => 0,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.settleLast(
      snapshot({
        state: "error",
        lastError: "INVALID_EVENT",
        pendingOutboxCount: 1,
      }),
    );

    expect(scheduler.getState()).toMatchObject({
      consecutiveFailures: 1,
      lastError: "INVALID_EVENT",
    });

    // Backoff, not the 2s drain interval.
    await vi.advanceTimersByTimeAsync(999);
    expect(controller.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.calls).toHaveLength(2);

    scheduler.stop();
  });

  it("does not let a local mutation collapse an active failure backoff", async () => {
    // A technician saving every few seconds through an outage would otherwise
    // reduce a five-minute backoff to the debounce, repeatedly, and hammer an
    // endpoint that is already failing.
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      mutationDebounceMs: 100,
      backoffBaseMs: 60_000,
      random: () => 0,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.failLast(new Error("offline"));

    for (let save = 0; save < 5; save += 1) {
      void scheduler.request("local-mutation").catch(() => undefined);
      await vi.advanceTimersByTimeAsync(200);
    }

    expect(controller.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(controller.calls).toHaveLength(2);

    scheduler.stop();
  });

  it("still lets a reconnect cut the backoff short", async () => {
    // A reconnect carries information that the failing condition changed;
    // a local save does not.
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      backoffBaseMs: 60_000,
      random: () => 0,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.failLast(new Error("offline"));

    void scheduler.request("reconnect").catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.calls).toHaveLength(2);
    scheduler.stop();
  });
});

describe("createLocalSyncScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("syncs once on start", async () => {
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.calls).toHaveLength(1);
    expect(scheduler.getState()).toMatchObject({
      running: true,
      syncing: true,
      lastTrigger: "startup",
    });

    scheduler.stop();
  });

  it("debounces a burst of local mutations into one run", async () => {
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      mutationDebounceMs: 1_000,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.settleLast();
    expect(controller.calls).toHaveLength(1);

    const requests = [
      scheduler.request("local-mutation"),
      scheduler.request("local-mutation"),
      scheduler.request("local-mutation"),
    ];

    await vi.advanceTimersByTimeAsync(999);
    expect(controller.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(controller.calls).toHaveLength(2);

    await controller.settleLast();
    await expect(Promise.all(requests)).resolves.toHaveLength(3);

    scheduler.stop();
  });

  it("pulls the run forward when a reconnect lands during a mutation debounce", async () => {
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      mutationDebounceMs: 60_000,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.settleLast();

    void scheduler.request("local-mutation").catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10);
    expect(controller.calls).toHaveLength(1);

    void scheduler.request("reconnect").catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.calls).toHaveLength(2);
    expect(scheduler.getState().lastTrigger).toBe("reconnect");

    scheduler.stop();
  });

  it("never overlaps runs and coalesces mid-run requests into exactly one follow-up", async () => {
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      mutationDebounceMs: 0,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.calls).toHaveLength(1);

    // Five requests arrive while run #1 is still in flight.
    const pending = [
      scheduler.request("local-mutation"),
      scheduler.request("local-mutation"),
      scheduler.request("reconnect"),
      scheduler.request("manual"),
      scheduler.request("local-mutation"),
    ];
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.calls).toHaveLength(1);

    await controller.settleLast();
    // Exactly one follow-up run, not five.
    expect(controller.calls).toHaveLength(2);

    await controller.settleLast();
    await expect(Promise.all(pending)).resolves.toHaveLength(5);
    expect(controller.calls).toHaveLength(2);

    scheduler.stop();
  });

  it("backs off exponentially with downward jitter after failures", async () => {
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      backoffBaseMs: 1_000,
      backoffMaxMs: 10_000,
      backoffJitter: 0.5,
      random: () => 0, // no jitter subtracted: the delay is the ceiling value
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.failLast(new Error("offline"));
    expect(scheduler.getState()).toMatchObject({
      consecutiveFailures: 1,
      lastError: "offline",
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(controller.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.calls).toHaveLength(2);

    await controller.failLast(new Error("offline"));
    // Second failure doubles the wait.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(controller.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.calls).toHaveLength(3);

    scheduler.stop();
  });

  it("caps backoff at the ceiling", async () => {
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      backoffBaseMs: 1_000,
      backoffMaxMs: 4_000,
      backoffJitter: 0,
      random: () => 0,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await controller.failLast(new Error("offline"));
      await vi.advanceTimersByTimeAsync(4_000);
    }

    expect(scheduler.getState().consecutiveFailures).toBeGreaterThanOrEqual(6);
    // Never waited longer than the ceiling: each 4s advance produced a run.
    expect(controller.calls).toHaveLength(7);

    scheduler.stop();
  });

  it("resets backoff after a success and falls back to bounded polling", async () => {
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      backoffBaseMs: 1_000,
      pollIntervalMs: 30_000,
      random: () => 0,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.failLast(new Error("offline"));
    expect(scheduler.getState().consecutiveFailures).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await controller.settleLast();
    expect(scheduler.getState()).toMatchObject({
      consecutiveFailures: 0,
      lastError: null,
    });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(controller.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.calls).toHaveLength(3);

    scheduler.stop();
  });

  it("stops polling while paused and resumes on demand", async () => {
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      pollIntervalMs: 10_000,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.settleLast();

    scheduler.pause();
    expect(scheduler.getState()).toMatchObject({
      paused: true,
      nextRunAt: null,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(controller.calls).toHaveLength(1);

    await expect(scheduler.request("manual")).rejects.toThrow(/pausada/);

    scheduler.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.calls).toHaveLength(2);

    scheduler.stop();
  });

  it("rejects in-flight waiters on stop instead of hanging them", async () => {
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      mutationDebounceMs: 5_000,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.settleLast();

    const pending = scheduler.request("local-mutation");
    scheduler.stop();

    await expect(pending).rejects.toThrow(/encerrada/);
    expect(scheduler.getState()).toMatchObject({
      running: false,
      nextRunAt: null,
    });
  });

  it("schedules nothing after stop", async () => {
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime, {
      pollIntervalMs: 1_000,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.settleLast();
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(controller.calls).toHaveLength(1);
  });

  it("is idempotent on repeated start", async () => {
    const controller = createControllableRuntime();
    const scheduler = createLocalSyncScheduler(controller.runtime);

    scheduler.start();
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.calls).toHaveLength(1);
    scheduler.stop();
  });
});
