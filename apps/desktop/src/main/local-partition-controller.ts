import type {
  LocalDatabasePartition,
  LocalPartitionActivationRequest,
  LocalPartitionActivationResult,
} from "@calibra-facil/contracts";
import {
  describeLocalPartitionRefusal,
  resolveLocalPartitionActivation,
} from "./local-partition-activation";
import type { LocalServerManagerState } from "./local-server-manager";

/** The cloud endpoint the local server is started against. */
export type LocalServerCloudOptions = {
  cloudApiUrl: string | null;
  cloudProxyToken: string | null;
  autoStartSync?: boolean;
};

export type LocalPartitionControllerDeps = {
  server: {
    readonly state: LocalServerManagerState;
    start(
      options: LocalServerCloudOptions & {
        partition: LocalDatabasePartition | null;
      },
    ): Promise<unknown>;
    stop(): void;
  };
  store: {
    load(): Promise<{ partition: LocalDatabasePartition } | null>;
    remember(partition: LocalDatabasePartition): Promise<unknown>;
  };
  sync: {
    syncStatus(): Promise<{
      scheduler?: { syncing?: boolean } | null | undefined;
    }>;
    postSyncAction(pathname: string): Promise<unknown>;
  };
  /** Tell the renderers the sync status changed (a new database is open). */
  publishSyncStatus(): Promise<void>;
  log: Pick<Console, "log" | "warn" | "error">;
  /** Pause between sync-settled checks; a test passes zero. */
  settlePollMs?: number;
};

const SETTLE_ATTEMPTS = 40;

/**
 * Which local database the running local server has open, and the only door
 * through which that changes.
 *
 * Owns the state that used to be module globals of the main process: the
 * partition in service, the cloud endpoint the server was started against
 * (captured once, so a switch restarts it against the same proxy rather than
 * a recomputed URL that may have moved), and the queue that serialises
 * activations.
 */
export class LocalPartitionController {
  #active: LocalDatabasePartition | null = null;
  #cloudOptions: LocalServerCloudOptions = {
    cloudApiUrl: null,
    cloudProxyToken: null,
  };
  #queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: LocalPartitionControllerDeps) {}

  /** The account and organization the running local server serves, if any. */
  get active() {
    return this.#active;
  }

  /** Remember where the server syncs; later starts and switches reuse it. */
  useCloud(options: LocalServerCloudOptions) {
    this.#cloudOptions = options;
  }

  /**
   * Offline start: open the partition this device last authorized, and only
   * that one. A different account has to sign in online first.
   */
  async startAtLaunch(options: { packaged: boolean }) {
    const remembered = (await this.deps.store.load())?.partition ?? null;

    if (options.packaged && !remembered) {
      // Nothing to open until someone signs in. Spawning an unpartitioned
      // server here would create a database belonging to nobody, and the
      // restart logic would retry a configuration that cannot succeed.
      this.deps.log.log(
        "[desktop-startup] no authorized partition; local server idle",
      );
      return;
    }

    try {
      await this.deps.server.start({
        ...this.#cloudOptions,
        partition: remembered,
      });
      this.#active = remembered;
    } catch (error) {
      this.deps.log.error("[desktop-startup] local server failed to start", {
        error: errorMessage(error),
      });
    }
  }

  /**
   * Open the local database belonging to a verified identity, closing whatever
   * was open before.
   *
   * The order is the point, and it is the order a switch has to happen in:
   *
   * 1. decide, from the activation policy — never from the caller's assertion;
   * 2. pause continuous sync and let the run in flight finish, so no push lands
   *    under the outgoing account's credentials after the switch begins;
   * 3. stop the local server, which closes its database;
   * 4. start it on the incoming partition, which derives its own path and
   *    verifies the ownership record inside the file before serving a route;
   * 5. remember the grant, so this identity — and only this one — can open
   *    offline next time.
   *
   * The outgoing account's database is left exactly as it was. Its queued field
   * work is not deleted, not migrated, and never uploaded under the incoming
   * account's credentials; it waits for its owner to authenticate again.
   */
  activate(
    input: LocalPartitionActivationRequest,
  ): Promise<LocalPartitionActivationResult> {
    // Strictly one at a time. Two activations overlapping — switching
    // organization while the gate is still pending is enough — would race over
    // which database is open and which partition is recorded as active.
    const queued = this.#queue
      .catch(() => undefined)
      .then(() => this.#activateOnce(input));

    this.#queue = queued.then(
      () => undefined,
      () => undefined,
    );

    return queued;
  }

  async #activateOnce(
    input: LocalPartitionActivationRequest,
  ): Promise<LocalPartitionActivationResult> {
    const { server, store, log } = this.deps;
    const decision = resolveLocalPartitionActivation({
      requested: input.partition,
      identityVerified: input.identityVerified,
      running: this.#active,
      remembered: (await store.load())?.partition ?? null,
    });

    if (decision.action === "idle") {
      return { status: "idle" };
    }

    if (decision.action === "refuse") {
      log.warn("[desktop-partition] refused", { reason: decision.reason });
      return {
        status: "refused",
        reason: decision.reason,
        message: describeLocalPartitionRefusal(decision.reason),
      };
    }

    if (decision.action === "reuse") {
      return {
        status: "active",
        partition: decision.partition,
        switched: false,
      };
    }

    const target =
      decision.action === "switch" ? decision.to : decision.partition;

    // A `start` decision does not mean nothing is running. On first launch — or
    // after an upgrade, when no grant exists yet — startup may already have
    // opened the *unpartitioned* database while the active partition stayed
    // null. `LocalServerManager.start()` short-circuits on a ready server, so
    // without stopping it first the host would report the target as active
    // while still serving the shared file: the original cross-account
    // exposure, preserved exactly where it is least expected.
    // Anything other than fully stopped has to be torn down, not just "ready".
    // A start already in flight is the dangerous case: `LocalServerManager.start`
    // returns its cached promise and ignores the new options, so the host would
    // record the incoming partition as active while the server finishes opening
    // the previous one's database.
    const serverNeedsRestart = server.state !== "stopped";
    const switched = decision.action === "switch" || serverNeedsRestart;

    if (switched) {
      await this.#quiesceSync();
      server.stop();
    }

    try {
      await server.start({ ...this.#cloudOptions, partition: target });
    } catch (error) {
      this.#active = null;
      // Leave nothing running. Without this the manager keeps respawning a
      // configuration that cannot start, and its restart timer can later abort
      // an otherwise healthy activation.
      server.stop();
      log.error("[desktop-partition] failed to open partition", {
        error: errorMessage(error),
      });

      return {
        status: "failed",
        message:
          "Não foi possível abrir os dados locais desta conta neste computador.",
      };
    }

    this.#active = target;

    // Only an online-verified activation grants offline access. An offline start
    // is *using* a grant, not issuing one.
    if (decision.action === "switch" || !decision.offline) {
      await store.remember(target);
    }

    await this.deps.publishSyncStatus();

    return { status: "active", partition: target, switched };
  }

  /**
   * Stop the sync loop and wait for the run in flight. Pausing alone would let
   * an in-progress push finish *after* the database it was reading has been
   * closed and replaced.
   */
  async #quiesceSync() {
    const { sync, log } = this.deps;
    await sync.postSyncAction("/api/local/sync/pause");

    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
      const status = await sync.syncStatus();
      if (status.scheduler?.syncing !== true) return;

      await new Promise((resolve) =>
        setTimeout(resolve, this.deps.settlePollMs ?? 250),
      );
    }

    log.warn("[desktop-partition] sync did not settle before switching");
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
