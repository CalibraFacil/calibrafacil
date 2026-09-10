import type {
  SyncSchedulerState as SyncSchedulerWireState,
  SyncStatusSnapshot,
  SyncTrigger,
} from "@calibra-facil/contracts";

import type { LocalSyncRuntime } from "./sync";

/**
 * Continuous sync lifecycle.
 *
 * Before this existed, the only way local changes reached the cloud was a user
 * opening a screen that happened to issue a local-first read (which fired a
 * throttled background request) or pressing "sincronizar". A technician who
 * finished work offline, closed the laptop, and reopened it connected would
 * keep pending writes indefinitely.
 *
 * The scheduler owns *when* to sync; `LocalSyncRuntime` still owns *how*.
 * Invariants:
 *
 * - **Never overlapping.** One run at a time; requests that arrive mid-run
 *   coalesce into exactly one follow-up run, never a queue of N.
 * - **Debounced writes.** A burst of local mutations produces one push.
 * - **Backoff with jitter.** Failures back off exponentially up to a ceiling,
 *   so a laptop in a Faraday cage does not hammer a dead endpoint.
 * - **Bounded polling.** Idle polling is a safety net, not the mechanism.
 */
export type { SyncTrigger };

export type SyncSchedulerState = {
  running: boolean;
  paused: boolean;
  /** A run is in flight right now. */
  syncing: boolean;
  /** Consecutive failures; drives the backoff delay. */
  consecutiveFailures: number;
  lastTrigger: SyncTrigger | null;
  lastRunStartedAt: string | null;
  lastError: string | null;
  /** Epoch ms of the next planned run, or null when nothing is scheduled. */
  nextRunAt: number | null;
};

export type LocalSyncSchedulerOptions = {
  /** Debounce applied to `local-mutation` so a write burst pushes once. */
  mutationDebounceMs?: number;
  /** Idle safety-net polling interval. */
  pollIntervalMs?: number;
  /**
   * Gap between runs while the outbox still has queued events. Short, because
   * the push leg drains a bounded batch and the remaining records stay blocked
   * until they land.
   */
  drainIntervalMs?: number;
  /** First backoff step after a failure. */
  backoffBaseMs?: number;
  /** Backoff ceiling. */
  backoffMaxMs?: number;
  /** Jitter fraction applied to backoff, in [0, 1). */
  backoffJitter?: number;
  /** Injected for deterministic tests. */
  random?: () => number;
};

export type LocalSyncScheduler = {
  start(trigger?: SyncTrigger): void;
  stop(): void;
  pause(): void;
  resume(): void;
  /**
   * Ask for a sync. Coalesces with any in-flight or already-scheduled run and
   * resolves with the snapshot of the run that covered this request.
   */
  request(trigger: SyncTrigger): Promise<SyncStatusSnapshot>;
  getState(): SyncSchedulerState;
};

const DEFAULTS = {
  mutationDebounceMs: 1_500,
  pollIntervalMs: 120_000,
  drainIntervalMs: 2_000,
  backoffBaseMs: 5_000,
  backoffMaxMs: 300_000,
  backoffJitter: 0.2,
} as const;

export function createLocalSyncScheduler(
  runtime: LocalSyncRuntime,
  options: LocalSyncSchedulerOptions = {},
): LocalSyncScheduler {
  const mutationDebounceMs =
    options.mutationDebounceMs ?? DEFAULTS.mutationDebounceMs;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
  const drainIntervalMs = options.drainIntervalMs ?? DEFAULTS.drainIntervalMs;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
  const backoffMaxMs = options.backoffMaxMs ?? DEFAULTS.backoffMaxMs;
  const backoffJitter = options.backoffJitter ?? DEFAULTS.backoffJitter;
  const random = options.random ?? Math.random;

  let running = false;
  let paused = false;
  let syncing = false;
  let consecutiveFailures = 0;
  let lastTrigger: SyncTrigger | null = null;
  let lastRunStartedAt: string | null = null;
  let lastError: string | null = null;
  let nextRunAt: number | null = null;
  /** The last run's snapshot, used to decide whether the queue is drained. */
  let lastSnapshot: SyncStatusSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** A request landed mid-run and needs a follow-up run to cover it. */
  let pendingRerun = false;

  /**
   * Requests waiting for a run to cover them. A request that lands while a run
   * is already in flight is *not* satisfied by that run — the run may have
   * already read the outbox — so it waits for the next one.
   */
  let waiters: Array<{
    resolve(snapshot: SyncStatusSnapshot): void;
    reject(error: unknown): void;
  }> = [];

  return {
    start(trigger = "startup") {
      if (running) return;
      running = true;
      paused = false;
      schedule(0, trigger);
    },
    stop() {
      running = false;
      clearTimer();
      nextRunAt = null;
      // Anyone awaiting a run they will never get should not hang forever.
      settleWaiters(new Error("Sincronização contínua foi encerrada."));
    },
    pause() {
      paused = true;
      clearTimer();
      nextRunAt = null;
      settleWaiters(new Error("Sincronização contínua está pausada."));
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (!running) return;
      schedule(0, "manual");
    },
    request(trigger) {
      return new Promise<SyncStatusSnapshot>((resolve, reject) => {
        if (!running || paused) {
          reject(
            new Error(
              paused
                ? "Sincronização contínua está pausada."
                : "Sincronização contínua não está ativa.",
            ),
          );
          return;
        }

        waiters.push({ resolve, reject });
        schedule(delayForTrigger(trigger), trigger);
      });
    },
    getState() {
      return {
        running,
        paused,
        syncing,
        consecutiveFailures,
        lastTrigger,
        lastRunStartedAt,
        lastError,
        nextRunAt,
      };
    },
  };

  function delayForTrigger(trigger: SyncTrigger) {
    // A mutation burst debounces; everything else is a deliberate signal that
    // now is the moment (reconnect, user press, process start).
    return trigger === "local-mutation" ? mutationDebounceMs : 0;
  }

  /**
   * Plan the next run. Coalescing rule: the *earliest* requested time wins, so
   * a reconnect arriving during a mutation debounce pulls the run forward
   * instead of appending a second one.
   *
   * With one exception. While a failure backoff is pending, a
   * `local-mutation` request must not pull the run forward: a technician
   * saving every few seconds through an outage would otherwise collapse a
   * five-minute backoff to the 1.5-second debounce, over and over, and hammer
   * an endpoint that is already failing. Deliberate signals — reconnect, a
   * user pressing sync — still cut the wait, because those carry information
   * that the failing condition may have changed.
   */
  function schedule(delayMs: number, trigger: SyncTrigger) {
    if (!running || paused) return;

    lastTrigger = trigger;

    if (syncing) {
      // A follow-up run is implied by `waiters`/`pendingRerun`; the run's
      // completion handler schedules it. Recording the trigger is enough.
      pendingRerun = true;
      return;
    }

    if (
      trigger === "local-mutation" &&
      consecutiveFailures > 0 &&
      timer !== null
    ) {
      return;
    }

    const targetAt = Date.now() + Math.max(0, delayMs);
    if (timer !== null && nextRunAt !== null && nextRunAt <= targetAt) {
      // Something sooner is already planned.
      return;
    }

    clearTimer();
    nextRunAt = targetAt;
    timer = setTimeoutUnref(
      () => {
        timer = null;
        nextRunAt = null;
        void runOnce();
      },
      Math.max(0, delayMs),
    );
  }

  async function runOnce() {
    if (!running || paused || syncing) return;

    syncing = true;
    pendingRerun = false;
    lastRunStartedAt = new Date().toISOString();
    const claimed = waiters;
    waiters = [];

    try {
      const snapshot = await runtime.runPushSync();

      // A resolved run is not necessarily a successful one. `runPushSync`
      // resolves with `state: "error"` when the cloud accepted the request but
      // rejected events inside it — a permanent validation failure would
      // otherwise be retried at full poll rate forever, reporting zero
      // scheduler failures while resending the same invalid event.
      if (snapshot.state === "error") {
        consecutiveFailures += 1;
        lastError = snapshot.lastError ?? "Sync completed with rejections";
      } else {
        consecutiveFailures = 0;
        lastError = null;
      }

      lastSnapshot = snapshot;
      for (const waiter of claimed) waiter.resolve(snapshot);
    } catch (error) {
      consecutiveFailures += 1;
      lastError = error instanceof Error ? error.message : "Sync failed";
      lastSnapshot = null;
      for (const waiter of claimed) waiter.reject(error);
    } finally {
      syncing = false;
      scheduleNextAfterRun();
    }
  }

  function scheduleNextAfterRun() {
    if (!running || paused) return;

    if (pendingRerun || waiters.length > 0) {
      pendingRerun = false;
      schedule(0, lastTrigger ?? "manual");
      return;
    }

    if (consecutiveFailures > 0) {
      schedule(backoffDelay(), "poll");
      return;
    }

    // The push leg drains a bounded batch, so a real offline burst needs more
    // than one run. Waiting a full poll interval between batches would leave a
    // technician's reconnect only partly drained — and every record still in
    // the queue keeps its cloud actions blocked.
    if ((lastSnapshot?.pendingOutboxCount ?? 0) > 0) {
      schedule(drainIntervalMs, "poll");
      return;
    }

    schedule(pollIntervalMs, "poll");
  }

  function backoffDelay() {
    const exponential = Math.min(
      backoffMaxMs,
      backoffBaseMs * 2 ** (consecutiveFailures - 1),
    );
    // Jitter is one-sided downward so the ceiling stays a true ceiling.
    return Math.round(exponential * (1 - backoffJitter * random()));
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function settleWaiters(error: Error) {
    const claimed = waiters;
    waiters = [];
    for (const waiter of claimed) waiter.reject(error);
  }
}

/**
 * A pending sync timer must never be the reason the process stays alive —
 * Electron quits the local server by ending the process. `unref` is
 * Node-only and absent under fake timers, hence the structural check.
 */
function setTimeoutUnref(callback: () => void, delayMs: number) {
  const handle = setTimeout(callback, delayMs);

  if (
    typeof handle === "object" &&
    handle !== null &&
    "unref" in handle &&
    typeof handle.unref === "function"
  ) {
    handle.unref();
  }

  return handle;
}

/**
 * Project the scheduler's internal state onto the wire contract the renderer
 * consumes. `nextRunAt` becomes an ISO instant so it survives IPC and can be
 * rendered as "próxima tentativa" without the UI knowing about epoch ms.
 */
export function toSyncSchedulerWireState(
  state: SyncSchedulerState,
): SyncSchedulerWireState {
  return {
    running: state.running,
    paused: state.paused,
    syncing: state.syncing,
    consecutiveFailures: state.consecutiveFailures,
    lastTrigger: state.lastTrigger,
    nextRunAt:
      state.nextRunAt === null ? null : new Date(state.nextRunAt).toISOString(),
  };
}
