import { describe, expect, it } from "vitest";

import {
  evaluateOperationAvailability,
  type RuntimeHealthSnapshot,
} from "./availability";

function health(
  overrides: Partial<RuntimeHealthSnapshot> = {},
): RuntimeHealthSnapshot {
  return {
    isDesktop: true,
    cloud: "reachable",
    localRuntime: "healthy",
    localCacheBootstrapped: true,
    pendingOutboxCount: 0,
    conflictCount: 0,
    ...overrides,
  };
}

describe("evaluateOperationAvailability", () => {
  it("allows a cloud command on connected desktop", () => {
    // The regression this whole module exists to prevent: `isDesktop` alone
    // used to deny jobs.approve outright.
    expect(
      evaluateOperationAvailability({
        namespace: "jobs",
        method: "approve",
        health: health(),
      }),
    ).toEqual({ available: true, source: "cloud", policy: "cloud-only" });
  });

  it("denies a cloud command only when the cloud is observed unreachable", () => {
    const result = evaluateOperationAvailability({
      namespace: "jobs",
      method: "approve",
      health: health({ cloud: "unreachable" }),
    });

    expect(result).toMatchObject({
      available: false,
      reason: "cloud-unreachable",
      resolvableBySync: false,
    });
  });

  it("treats unknown cloud reachability as available", () => {
    expect(
      evaluateOperationAvailability({
        namespace: "jobs",
        method: "approve",
        health: health({ cloud: "unknown" }),
      }),
    ).toMatchObject({ available: true, source: "cloud" });
  });

  it("blocks a cloud command against an entity that has no cloud identity yet", () => {
    const result = evaluateOperationAvailability({
      namespace: "serviceOrders",
      method: "deliver",
      health: health(),
      target: { synced: false },
    });

    expect(result).toMatchObject({
      available: false,
      reason: "entity-not-synced",
      resolvableBySync: true,
    });
  });

  it("blocks a cloud command while the entity still has unacknowledged local writes", () => {
    const result = evaluateOperationAvailability({
      namespace: "jobs",
      method: "approve",
      health: health({ pendingOutboxCount: 3 }),
      target: { synced: true, hasPendingLocalChanges: true },
    });

    expect(result).toMatchObject({
      available: false,
      reason: "entity-has-pending-changes",
      resolvableBySync: true,
    });
  });

  it("reports the connection, not the entity, when both are blocking", () => {
    const result = evaluateOperationAvailability({
      namespace: "jobs",
      method: "approve",
      health: health({ cloud: "unreachable" }),
      target: { synced: false },
    });

    expect(result).toMatchObject({ reason: "cloud-unreachable" });
  });

  it("serves a local-first read from the cache and flags it as possibly stale", () => {
    expect(
      evaluateOperationAvailability({
        namespace: "jobs",
        method: "get",
        health: health(),
      }),
    ).toEqual({
      available: true,
      source: "local-cache",
      policy: "local-first-read-through-sync",
      staleness: "local-cache-may-lag-cloud",
    });
  });

  it("falls a local-first read through to the cloud before the first bootstrap", () => {
    expect(
      evaluateOperationAvailability({
        namespace: "jobs",
        method: "get",
        health: health({ localCacheBootstrapped: false }),
      }),
    ).toMatchObject({ available: true, source: "cloud" });
  });

  it("denies a local-first read that has neither cache nor cloud", () => {
    const result = evaluateOperationAvailability({
      namespace: "jobs",
      method: "get",
      health: health({ localCacheBootstrapped: false, cloud: "unreachable" }),
    });

    expect(result).toMatchObject({
      available: false,
      reason: "initial-sync-required",
      resolvableBySync: true,
    });
  });

  it("blames the local runtime when it is down and the cloud is unreachable", () => {
    const result = evaluateOperationAvailability({
      namespace: "jobs",
      method: "get",
      health: health({
        localCacheBootstrapped: false,
        localRuntime: "unavailable",
        cloud: "unreachable",
      }),
    });

    expect(result).toMatchObject({ reason: "local-runtime-unavailable" });
  });

  it("queues a local command while offline", () => {
    expect(
      evaluateOperationAvailability({
        namespace: "jobs",
        method: "saveExecution",
        health: health({ cloud: "unreachable" }),
      }),
    ).toMatchObject({ available: true, source: "local-queue" });
  });

  it("denies a local command when the local process is down", () => {
    expect(
      evaluateOperationAvailability({
        namespace: "jobs",
        method: "saveExecution",
        health: health({ localRuntime: "unavailable" }),
      }),
    ).toMatchObject({
      available: false,
      reason: "local-runtime-unavailable",
      resolvableBySync: false,
    });
  });

  it("routes a local-only method through the local runtime", () => {
    expect(
      evaluateOperationAvailability({
        namespace: "sync",
        method: "listConflicts",
        health: health(),
      }),
    ).toMatchObject({ available: true, source: "local-runtime" });
  });

  it("keeps every method available in the browser", () => {
    expect(
      evaluateOperationAvailability({
        namespace: "jobs",
        method: "approve",
        health: health({ isDesktop: false, localCacheBootstrapped: false }),
      }),
    ).toMatchObject({ available: true, source: "cloud" });
  });

  it("does not apply desktop entity blockers in the browser", () => {
    // In the browser there is no outbox, so a caller passing a stale target
    // must not be able to lock the user out of a working action.
    expect(
      evaluateOperationAvailability({
        namespace: "jobs",
        method: "approve",
        health: health({ isDesktop: false }),
        target: { synced: false, hasPendingLocalChanges: true },
      }),
    ).toMatchObject({ available: true });
  });
});
