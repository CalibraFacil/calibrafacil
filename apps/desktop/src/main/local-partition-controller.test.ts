import { describe, expect, it, vi } from "vitest";
import type { LocalDatabasePartition } from "@calibra-facil/contracts";
import {
  LocalPartitionController,
  type LocalPartitionControllerDeps,
} from "./local-partition-controller";
import type { LocalServerManagerState } from "./local-server-manager";

const ana: LocalDatabasePartition = {
  userId: "user-ana",
  organizationId: "org-1",
};
const bruno: LocalDatabasePartition = {
  userId: "user-bruno",
  organizationId: "org-1",
};

function setup(
  options: {
    remembered?: LocalDatabasePartition | null;
    startFails?: boolean;
    syncingFor?: number;
  } = {},
) {
  const calls: string[] = [];
  let state: LocalServerManagerState = "stopped";
  let syncChecks = 0;

  const deps: LocalPartitionControllerDeps = {
    server: {
      get state() {
        return state;
      },
      start: vi.fn(async (startOptions) => {
        calls.push(`start:${startOptions.partition?.userId ?? "none"}`);
        if (options.startFails) throw new Error("boom");
        state = "ready";
      }),
      stop: vi.fn(() => {
        calls.push("stop");
        state = "stopped";
      }),
    },
    store: {
      load: vi.fn(async () =>
        options.remembered
          ? { partition: options.remembered, authorizedAt: "" }
          : null,
      ),
      remember: vi.fn(async (partition) => {
        calls.push(`remember:${partition.userId}`);
      }),
    },
    sync: {
      syncStatus: vi.fn(async () => {
        syncChecks += 1;
        return {
          scheduler: { syncing: syncChecks <= (options.syncingFor ?? 0) },
        };
      }),
      postSyncAction: vi.fn(async (pathname) => {
        calls.push(`post:${pathname}`);
      }),
    },
    publishSyncStatus: vi.fn(async () => {
      calls.push("publish");
    }),
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settlePollMs: 0,
  };

  return {
    controller: new LocalPartitionController(deps),
    deps,
    calls,
    setState: (next: LocalServerManagerState) => {
      state = next;
    },
  };
}

describe("LocalPartitionController at launch", () => {
  it("opens the remembered partition and records it as active", async () => {
    const { controller, calls } = setup({ remembered: ana });
    controller.useCloud({
      cloudApiUrl: "http://127.0.0.1:1",
      cloudProxyToken: "t",
    });

    await controller.startAtLaunch({ packaged: true });

    expect(calls).toEqual(["start:user-ana"]);
    expect(controller.active).toEqual(ana);
  });

  it("leaves a packaged build idle when no account was ever authorized", async () => {
    const { controller, deps } = setup({ remembered: null });

    await controller.startAtLaunch({ packaged: true });

    expect(deps.server.start).not.toHaveBeenCalled();
    expect(controller.active).toBeNull();
  });

  it("starts an unpartitioned server in development", async () => {
    const { controller, calls } = setup({ remembered: null });

    await controller.startAtLaunch({ packaged: false });

    expect(calls).toEqual(["start:none"]);
    expect(controller.active).toBeNull();
  });

  it("logs a failed start and carries on without an active partition", async () => {
    const { controller, deps } = setup({ remembered: ana, startFails: true });

    await controller.startAtLaunch({ packaged: true });

    expect(controller.active).toBeNull();
    expect(deps.log.error).toHaveBeenCalled();
  });
});

describe("LocalPartitionController.activate", () => {
  it("starts the verified partition and grants offline access", async () => {
    const { controller, calls } = setup();

    const result = await controller.activate({
      partition: ana,
      identityVerified: true,
    });

    expect(result).toEqual({
      status: "active",
      partition: ana,
      switched: false,
    });
    expect(calls).toEqual(["start:user-ana", "remember:user-ana", "publish"]);
  });

  it("pauses sync, waits for the run in flight and stops before it switches", async () => {
    const { controller, calls, deps } = setup({ syncingFor: 2 });
    await controller.activate({ partition: ana, identityVerified: true });
    calls.length = 0;

    const result = await controller.activate({
      partition: bruno,
      identityVerified: true,
    });

    expect(result).toEqual({
      status: "active",
      partition: bruno,
      switched: true,
    });
    expect(calls).toEqual([
      "post:/api/local/sync/pause",
      "stop",
      "start:user-bruno",
      "remember:user-bruno",
      "publish",
    ]);
    expect(deps.sync.syncStatus).toHaveBeenCalledTimes(3);
    expect(controller.active).toEqual(bruno);
  });

  it("tears down a server that is running without a partition before it starts one", async () => {
    const { controller, calls, setState } = setup();
    setState("ready");

    const result = await controller.activate({
      partition: ana,
      identityVerified: true,
    });

    expect(result).toMatchObject({ status: "active", switched: true });
    expect(calls.slice(0, 3)).toEqual([
      "post:/api/local/sync/pause",
      "stop",
      "start:user-ana",
    ]);
  });

  it("refuses an offline switch and leaves the open database alone", async () => {
    const { controller, calls } = setup({ remembered: ana });
    await controller.startAtLaunch({ packaged: true });
    calls.length = 0;

    const result = await controller.activate({
      partition: bruno,
      identityVerified: false,
    });

    expect(result).toMatchObject({
      status: "refused",
      reason: "offline-switch-requires-authentication",
    });
    expect(calls).toEqual([]);
    expect(controller.active).toEqual(ana);
  });

  it("stops everything and reports a failure when the partition cannot open", async () => {
    const { controller, calls } = setup({ startFails: true });

    const result = await controller.activate({
      partition: ana,
      identityVerified: true,
    });

    expect(result.status).toBe("failed");
    expect(calls).toEqual(["start:user-ana", "stop"]);
    expect(controller.active).toBeNull();
  });

  it("runs overlapping activations strictly one after the other", async () => {
    const { controller, calls } = setup();

    const [first, second] = await Promise.all([
      controller.activate({ partition: ana, identityVerified: true }),
      controller.activate({ partition: bruno, identityVerified: true }),
    ]);

    expect(first).toMatchObject({ partition: ana });
    expect(second).toMatchObject({ partition: bruno, switched: true });
    expect(calls.indexOf("start:user-bruno")).toBeGreaterThan(
      calls.indexOf("remember:user-ana"),
    );
  });
});
