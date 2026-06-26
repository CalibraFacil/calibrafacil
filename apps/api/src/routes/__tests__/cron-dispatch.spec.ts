import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../vercel-src/cron/dispatch";

const mocks = vi.hoisted(() => ({
  cleanupExpiredAuthRecords: vi.fn(),
  createWorkerRuntimeEnv: vi.fn(() => ({ DATABASE_URL: "postgres://test" })),
  enqueueBackgroundJob: vi.fn(),
  processScheduledContaAzulIntegrationSyncs: vi.fn(),
  processScheduledContaAzulPolls: vi.fn(),
  processScheduledIntegrationSyncs: vi.fn(),
  recomputeOperatorAlerts: vi.fn(),
}));

vi.mock("../../lib/auth-maintenance", () => ({
  cleanupExpiredAuthRecords: mocks.cleanupExpiredAuthRecords,
}));

vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: mocks.enqueueBackgroundJob,
}));

vi.mock("../../lib/runtime-env", () => ({
  createWorkerRuntimeEnv: mocks.createWorkerRuntimeEnv,
}));

vi.mock("../../lib/integrations", () => ({
  processScheduledContaAzulIntegrationSyncs:
    mocks.processScheduledContaAzulIntegrationSyncs,
  processScheduledContaAzulPolls: mocks.processScheduledContaAzulPolls,
}));

vi.mock("@calibra-facil/worker/integrations", () => ({
  processScheduledIntegrationSyncs: mocks.processScheduledIntegrationSyncs,
}));

vi.mock("../../lib/operator-alerts", () => ({
  recomputeOperatorAlerts: mocks.recomputeOperatorAlerts,
}));

// The runCron wrapper leases + heartbeats via db.execute. A row from the lease
// UPDATE means "lease acquired" (run proceeds); the other calls are no-ops here.
vi.mock("@calibra-facil/db", () => ({
  db: { execute: vi.fn(async () => ({ rows: [{ job: "test" }] })) },
}));

const originalEnv = { ...process.env };

function request(path: string, headers: HeadersInit = {}) {
  return new Request(`https://api.example.test${path}`, { headers });
}

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.CRON_SECRET;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
  vi.clearAllMocks();
  mocks.cleanupExpiredAuthRecords.mockResolvedValue({
    deletedSessions: 0,
    deletedVerifications: 0,
  });
  mocks.createWorkerRuntimeEnv.mockReturnValue({
    DATABASE_URL: "postgres://test",
  });
  mocks.enqueueBackgroundJob.mockResolvedValue({ enqueued: true });
  mocks.recomputeOperatorAlerts.mockResolvedValue({ alerts: 0 });
  mocks.processScheduledIntegrationSyncs.mockResolvedValue({
    scheduledRuns: 1,
  });
  mocks.processScheduledContaAzulIntegrationSyncs.mockResolvedValue({
    completedRuns: 0,
    dueRuns: 1,
    failedRuns: 0,
    queuedRuns: 1,
    scannedIntegrations: 1,
  });
  mocks.processScheduledContaAzulPolls.mockResolvedValue({
    dueIntegrations: 0,
    failedPolls: 0,
    processedCount: 0,
    scannedIntegrations: 1,
    successfulPolls: 0,
    updatedCount: 0,
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("cron dispatch", () => {
  it("returns 404 for an unknown job", async () => {
    const response = await GET(request("/api/cron/bogus"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown cron job: bogus",
    });
    expect(mocks.enqueueBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.recomputeOperatorAlerts).not.toHaveBeenCalled();
  });
});

describe("integrations cron", () => {
  it("requires CRON_SECRET when running on Vercel", async () => {
    process.env.VERCEL = "1";

    const response = await GET(request("/api/cron/integrations"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "CRON_SECRET não configurado",
    });
    expect(mocks.processScheduledIntegrationSyncs).not.toHaveBeenCalled();
  });

  it("rejects invalid cron credentials", async () => {
    process.env.CRON_SECRET = "secret-1";

    const response = await GET(
      request("/api/cron/integrations", { authorization: "Bearer wrong" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("keeps generic and export syncs running when Conta Azul polling fails", async () => {
    process.env.CRON_SECRET = "secret-1";
    mocks.processScheduledContaAzulPolls.mockRejectedValue(
      new Error("poll failed"),
    );

    const response = await GET(
      request("/api/cron/integrations", { "x-cron-secret": "secret-1" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      contaAzulPolling: { error: "poll failed", ok: false },
      contaAzulSyncs: { ok: true },
    });
    expect(mocks.processScheduledContaAzulIntegrationSyncs).toHaveBeenCalled();
  });

  it("passes queue dispatch to the scheduled Conta Azul sync task", async () => {
    process.env.CRON_SECRET = "secret-1";

    const response = await GET(
      request("/api/cron/integrations", { authorization: "Bearer secret-1" }),
    );

    expect(response.status).toBe(200);
    expect(
      mocks.processScheduledContaAzulIntegrationSyncs,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { DATABASE_URL: "postgres://test" },
        dispatch: expect.any(Function),
      }),
    );

    const call =
      mocks.processScheduledContaAzulIntegrationSyncs.mock.calls[0]?.[0];
    await call.dispatch({
      type: "INTEGRATION_SYNC",
      provider: "conta_azul",
      integrationId: "int-1",
      organizationId: "org-1",
      runId: "run-1",
      target: "customer",
      limit: 50,
      trigger: "scheduled",
    });

    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "conta_azul", runId: "run-1" }),
      { idempotencyKey: "conta-azul-sync-run-1" },
    );
  });
});

describe("notifications cron", () => {
  it("enqueues the scheduled-notifications job with a day-scoped idempotency key", async () => {
    const response = await GET(request("/api/cron/notifications"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enqueued: true });
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith(
      { type: "SCHEDULED_NOTIFICATIONS" },
      {
        idempotencyKey: expect.stringMatching(
          /^scheduled-notifications-\d{4}-\d{2}-\d{2}$/,
        ),
      },
    );
  });

  it("rejects invalid cron credentials", async () => {
    process.env.CRON_SECRET = "secret-1";

    const response = await GET(
      request("/api/cron/notifications", { authorization: "Bearer wrong" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.enqueueBackgroundJob).not.toHaveBeenCalled();
  });

  it("fails closed without a CRON_SECRET on Vercel", async () => {
    process.env.VERCEL = "1";

    const response = await GET(request("/api/cron/notifications"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "CRON_SECRET não configurado",
    });
    expect(mocks.enqueueBackgroundJob).not.toHaveBeenCalled();
  });
});

describe("operator-alerts cron", () => {
  it("recomputes operator alerts and returns the result", async () => {
    mocks.recomputeOperatorAlerts.mockResolvedValue({ alerts: 3 });

    const response = await GET(request("/api/cron/operator-alerts"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ alerts: 3 });
    expect(mocks.recomputeOperatorAlerts).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid cron credentials", async () => {
    process.env.CRON_SECRET = "secret-1";

    const response = await GET(
      request("/api/cron/operator-alerts", { authorization: "Bearer wrong" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.recomputeOperatorAlerts).not.toHaveBeenCalled();
  });

  it("fails closed without a CRON_SECRET on Vercel", async () => {
    process.env.VERCEL = "1";

    const response = await GET(request("/api/cron/operator-alerts"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "CRON_SECRET não configurado",
    });
    expect(mocks.recomputeOperatorAlerts).not.toHaveBeenCalled();
  });
});

describe("auth-maintenance cron", () => {
  it("deletes expired auth records and returns the counts", async () => {
    process.env.CRON_SECRET = "secret-1";
    mocks.cleanupExpiredAuthRecords.mockResolvedValue({
      deletedSessions: 4,
      deletedVerifications: 7,
    });

    const response = await GET(
      request("/api/cron/auth-maintenance", {
        authorization: "Bearer secret-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deletedSessions: 4,
      deletedVerifications: 7,
    });
    expect(mocks.cleanupExpiredAuthRecords).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid cron credentials", async () => {
    process.env.CRON_SECRET = "secret-1";

    const response = await GET(
      request("/api/cron/auth-maintenance", { authorization: "Bearer wrong" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.cleanupExpiredAuthRecords).not.toHaveBeenCalled();
  });

  it("fails closed without a CRON_SECRET on Vercel", async () => {
    process.env.VERCEL = "1";

    const response = await GET(request("/api/cron/auth-maintenance"));

    expect(response.status).toBe(503);
    expect(mocks.cleanupExpiredAuthRecords).not.toHaveBeenCalled();
  });
});
