import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../vercel-src/cron/integrations";

const mocks = vi.hoisted(() => ({
  createWorkerRuntimeEnv: vi.fn(() => ({ DATABASE_URL: "postgres://test" })),
  enqueueBackgroundJob: vi.fn(),
  processScheduledContaAzulIntegrationSyncs: vi.fn(),
  processScheduledContaAzulPolls: vi.fn(),
  processScheduledIntegrationSyncs: vi.fn(),
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

const originalEnv = { ...process.env };

function request(headers: HeadersInit = {}) {
  return new Request("https://api.example.test/api/cron/integrations", {
    headers,
  });
}

describe("integrations cron", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CRON_SECRET;
    delete process.env.VERCEL;
    delete process.env.NODE_ENV;
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

  it("requires CRON_SECRET when running on Vercel", async () => {
    process.env.VERCEL = "1";

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "CRON_SECRET não configurado",
    });
    expect(mocks.processScheduledIntegrationSyncs).not.toHaveBeenCalled();
  });

  it("rejects invalid cron credentials", async () => {
    process.env.CRON_SECRET = "secret-1";

    const response = await GET(request({ authorization: "Bearer wrong" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("keeps generic and export syncs running when Conta Azul polling fails", async () => {
    process.env.CRON_SECRET = "secret-1";
    mocks.processScheduledContaAzulPolls.mockRejectedValue(
      new Error("poll failed"),
    );

    const response = await GET(
      request({
        "x-cron-secret": "secret-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      contaAzulPolling: {
        error: "poll failed",
        ok: false,
      },
      contaAzulSyncs: {
        ok: true,
      },
    });
    expect(mocks.processScheduledContaAzulIntegrationSyncs).toHaveBeenCalled();
  });

  it("passes queue dispatch to the scheduled Conta Azul sync task", async () => {
    process.env.CRON_SECRET = "secret-1";

    const response = await GET(
      request({
        authorization: "Bearer secret-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(
      mocks.processScheduledContaAzulIntegrationSyncs,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        env: {
          DATABASE_URL: "postgres://test",
        },
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
      expect.objectContaining({
        provider: "conta_azul",
        runId: "run-1",
      }),
      {
        idempotencyKey: "conta-azul-sync-run-1",
      },
    );
  });
});
