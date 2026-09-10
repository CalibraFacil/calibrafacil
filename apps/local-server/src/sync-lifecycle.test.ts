import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLocalDatabase } from "@calibra-facil/local-db";

import { createLocalServerRuntime } from "./server";
import type { LocalServerConfig } from "./bootstrap";

const tempDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "calibra-sync-lifecycle-"),
  );
  tempDirectories.push(directory);
  return path.join(directory, "calibra.sqlite");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createConfig(
  dbPath: string,
  overrides: Partial<LocalServerConfig> = {},
): LocalServerConfig {
  return {
    host: "127.0.0.1",
    port: 4317,
    appVersion: "test",
    localServerVersion: "test",
    dbPath,
    storageRoot: path.join(path.dirname(dbPath), "files"),
    deviceId: "device-test",
    tenantId: null,
    organizationId: "org-1",
    unitId: 1,
    userId: "user-1",
    syncEnabled: true,
    bootstrapToken: null,
    cloudApiUrl: "https://cloud.example.test",
    cloudAuthToken: "cloud-token",
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
    ...overrides,
  };
}

/**
 * A cloud that answers push and pull with empty deltas, and counts how many
 * times each leg was called. Enough to observe *when* the local server decides
 * to sync, which is what this suite is about.
 */
function createCloudStub() {
  const calls: string[] = [];

  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url.pathname);

    if (url.pathname === "/api/sync/push") {
      return Response.json({ accepted: [], rejected: [], conflicts: [] });
    }

    if (url.pathname === "/api/sync/bootstrap") {
      return Response.json({ error: "bootstrap not stubbed" }, { status: 500 });
    }

    if (url.pathname === "/api/sync/pull") {
      return Response.json({
        cursor: "cursor-1",
        hasMore: false,
        events: [],
      });
    }

    return Response.json(
      { error: `Unexpected call to ${url.pathname}` },
      { status: 500 },
    );
  };

  return {
    fetchImpl,
    calls,
    countOf(pathname: string) {
      return calls.filter((call) => call === pathname).length;
    },
  };
}

/**
 * A delta sync is only meaningful once the cache has been bootstrapped —
 * `runPushSync` now falls back to a full bootstrap when it has not been. These
 * tests are about *scheduling*, so they seed the snapshot directly and keep
 * the bootstrap leg out of the picture.
 */
function seedBootstrapSnapshot(database: ReturnType<typeof openLocalDatabase>) {
  database
    .prepare(
      `INSERT INTO tenant_snapshot (
         tenant_id, organization_id, active_unit_id, user_id,
         snapshot_json, pulled_at
       ) VALUES ('org-1', 'org-1', 1, 'user-1', '{}', '2026-01-01T00:00:00.000Z')`,
    )
    .run();
}

function createRuntime(overrides: Partial<LocalServerConfig> = {}) {
  const dbPath = createTempDatabasePath();
  const database = openLocalDatabase({ filePath: dbPath });
  seedBootstrapSnapshot(database);
  const cloud = createCloudStub();
  const runtime = createLocalServerRuntime(
    createConfig(dbPath, overrides),
    database,
    {
      fetch: cloud.fetchImpl,
      scheduler: {
        mutationDebounceMs: 20,
        pollIntervalMs: 10_000,
        backoffBaseMs: 50,
      },
    },
  );

  return { ...runtime, database, cloud };
}

describe("continuous sync lifecycle", () => {
  it("reports scheduler state on the sync status route", async () => {
    const { app, syncScheduler } = createRuntime();

    const before = await app.request("/api/local/sync/status");
    await expect(before.json()).resolves.toMatchObject({
      scheduler: { running: false, paused: false },
    });

    syncScheduler.start();
    const after = await app.request("/api/local/sync/status");
    await expect(after.json()).resolves.toMatchObject({
      scheduler: { running: true },
    });

    syncScheduler.stop();
  });

  it("pauses continuous sync instead of claiming it was never running", async () => {
    // The old endpoint answered "Continuous sync is not running." — literally
    // true then, and a lie the moment a scheduler exists.
    const { app, syncScheduler } = createRuntime();
    syncScheduler.start();

    const response = await app.request("/api/local/sync/pause", {
      method: "POST",
    });

    await expect(response.json()).resolves.toEqual({
      ok: true,
      message: "Continuous sync paused.",
    });
    expect(syncScheduler.getState()).toMatchObject({ paused: true });

    syncScheduler.stop();
  });

  it("resumes a paused scheduler", async () => {
    const { app, syncScheduler } = createRuntime();
    syncScheduler.start();
    syncScheduler.pause();

    await app.request("/api/local/sync/resume", { method: "POST" });

    expect(syncScheduler.getState()).toMatchObject({
      running: true,
      paused: false,
    });

    syncScheduler.stop();
  });

  it("does not start continuous sync when there is no cloud configured", async () => {
    const { app, syncScheduler } = createRuntime({ cloudApiUrl: null });

    await app.request("/api/local/sync/resume", { method: "POST" });

    expect(syncScheduler.getState()).toMatchObject({ running: false });
  });

  it("pushes and pulls before answering the reconcile route", async () => {
    const { app, cloud } = createRuntime();

    const response = await app.request("/api/local/sync/push", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    // The pull leg is what makes the local cache canonical again; without it
    // the caller would re-read its own pre-command snapshot.
    expect(cloud.countOf("/api/sync/pull")).toBe(1);
    // No bootstrap: this is a delta, not a first download.
    expect(cloud.countOf("/api/sync/bootstrap")).toBe(0);
  });

  it("bootstraps instead of a delta when the cache was never populated", async () => {
    // An authenticated desktop whose local data was reset, or newly created
    // while the cloud session persisted. A delta here cannot succeed — the
    // pull has no snapshot to apply against — so retries would loop forever.
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const cloud = createCloudStub();
    const { app } = createLocalServerRuntime(createConfig(dbPath), database, {
      fetch: cloud.fetchImpl,
    });

    await app.request("/api/local/sync/push", { method: "POST" });

    expect(cloud.countOf("/api/sync/bootstrap")).toBe(1);
  });

  it("reports a reconcile failure as 503 rather than pretending it synced", async () => {
    const dbPath = createTempDatabasePath();
    const database = openLocalDatabase({ filePath: dbPath });
    const { app } = createLocalServerRuntime(createConfig(dbPath), database, {
      fetch: async () => Response.json({ error: "boom" }, { status: 500 }),
    });

    const response = await app.request("/api/local/sync/push", {
      method: "POST",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("wakes the scheduler on a host reconnect signal", async () => {
    const { app, syncScheduler, cloud } = createRuntime();
    syncScheduler.start();
    await vi.waitFor(() => {
      expect(cloud.countOf("/api/sync/pull")).toBe(1);
    });

    const response = await app.request("/api/local/sync/wake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "reconnect" }),
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scheduler: { running: true },
    });

    await vi.waitFor(() => {
      expect(cloud.countOf("/api/sync/pull")).toBeGreaterThan(0);
    });

    syncScheduler.stop();
  });

  it("does not let a wake override an explicit pause", async () => {
    // Returning to the window, or the network coming back, is not consent to
    // upload work the operator deliberately paused.
    const { app, syncScheduler, cloud } = createRuntime();
    syncScheduler.start();
    await vi.waitFor(() => {
      expect(cloud.countOf("/api/sync/pull")).toBe(1);
    });

    await app.request("/api/local/sync/pause", { method: "POST" });

    await app.request("/api/local/sync/wake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "reconnect" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(syncScheduler.getState().paused).toBe(true);
    expect(cloud.countOf("/api/sync/pull")).toBe(1);

    syncScheduler.stop();
  });

  it("does not start a scheduler that was never running", async () => {
    // A wake nudges an active loop; it does not bring one to life.
    const { app, syncScheduler } = createRuntime();

    await app.request("/api/local/sync/wake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "reconnect" }),
    });

    expect(syncScheduler.getState().running).toBe(false);
  });

  it("stays dormant when the operator turned automatic sync off", async () => {
    const { app, syncScheduler } = createRuntime({ autoStartSync: false });

    await app.request("/api/local/sync/resume", { method: "POST" });

    expect(syncScheduler.getState().running).toBe(false);
  });

  it("defaults an unrecognized wake trigger to reconnect instead of failing", async () => {
    const { app, syncScheduler } = createRuntime();

    const response = await app.request("/api/local/sync/wake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "not-a-trigger" }),
    });

    expect(response.status).toBe(200);
    syncScheduler.stop();
  });

  it("schedules a sync after a durable local write, without a screen read", async () => {
    // The Phase 3 requirement: reconnecting and finishing work offline must
    // drain the outbox even if the technician never opens a list screen.
    const { app, syncScheduler, cloud } = createRuntime();
    syncScheduler.start();
    await vi.waitFor(() => {
      expect(cloud.countOf("/api/sync/pull")).toBe(1);
    });

    const created = await app.request("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Cliente Offline",
        document: "12345678000199",
      }),
    });
    expect(created.status).toBe(201);

    await vi.waitFor(() => {
      expect(cloud.countOf("/api/sync/push")).toBeGreaterThan(0);
    });

    syncScheduler.stop();
  });

  it("does not schedule a sync for a read", async () => {
    const { app, syncScheduler, cloud } = createRuntime();
    syncScheduler.start();
    await vi.waitFor(() => {
      expect(cloud.countOf("/api/sync/pull")).toBe(1);
    });

    await app.request("/api/customers");
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(cloud.countOf("/api/sync/pull")).toBe(1);
    syncScheduler.stop();
  });

  it("does not schedule a sync for a rejected write", async () => {
    const { app, syncScheduler, cloud } = createRuntime();
    syncScheduler.start();
    await vi.waitFor(() => {
      expect(cloud.countOf("/api/sync/pull")).toBe(1);
    });

    const rejected = await app.request("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(rejected.status).toBeGreaterThanOrEqual(400);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cloud.countOf("/api/sync/push")).toBe(0);

    syncScheduler.stop();
  });
});
