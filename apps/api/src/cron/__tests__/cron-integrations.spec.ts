import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../dispatch";

// The integrations job runs three independent sweeps. A failing provider must not stop the
// others, and the run still answers each sweep's own result. The sweeps read every laboratory's
// connections (the system path), so the integration tier's tenant guard cannot attribute them
// to a request; the isolation is the dispatcher's own logic and is tested here with the three
// sweeps standing in.
const mocks = vi.hoisted(() => ({
  processScheduledIntegrationSyncs: vi.fn(),
  processScheduledContaAzulIntegrationSyncs: vi.fn(),
  processScheduledContaAzulPolls: vi.fn(),
}));

vi.mock("../../lib/runtime-env", () => ({
  createWorkerRuntimeEnv: () => ({ DATABASE_URL: "postgres://test" }),
}));
vi.mock("../../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn(),
}));
vi.mock("../../domains/finance/integrations", () => ({
  dispatchContaAzulSync: vi.fn(),
  processScheduledContaAzulIntegrationSyncs:
    mocks.processScheduledContaAzulIntegrationSyncs,
  processScheduledContaAzulPolls: mocks.processScheduledContaAzulPolls,
}));
vi.mock("@calibra-facil/jobs-core/integrations", () => ({
  processScheduledIntegrationSyncs: mocks.processScheduledIntegrationSyncs,
}));
// runCron's lease: a row from the UPDATE means "lease acquired".
vi.mock("@calibra-facil/db", () => ({
  db: { execute: vi.fn(async () => ({ rows: [{ job: "test" }] })) },
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv, CRON_SECRET: "secret-1" };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.processScheduledIntegrationSyncs.mockResolvedValue({
    scheduledRuns: 1,
  });
  mocks.processScheduledContaAzulIntegrationSyncs.mockResolvedValue({
    completedRuns: 0,
    queuedRuns: 1,
  });
  mocks.processScheduledContaAzulPolls.mockResolvedValue({
    processedCount: 0,
  });
});

function integrations() {
  return GET(
    new Request("https://api.example.test/api/cron/integrations", {
      headers: { authorization: "Bearer secret-1" },
    }),
  );
}

describe("integrations cron", () => {
  it("answers each sweep's own result", async () => {
    const response = await integrations();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      integrationSyncs: { ok: true, value: { scheduledRuns: 1 } },
      contaAzulSyncs: {
        ok: true,
        value: { completedRuns: 0, queuedRuns: 1 },
      },
      contaAzulPolling: { ok: true, value: { processedCount: 0 } },
    });
  });

  it("keeps the other sweeps and the 200 when Conta Azul polling fails, and answers the failure", async () => {
    mocks.processScheduledContaAzulPolls.mockRejectedValue(
      new Error("poll failed"),
    );

    const response = await integrations();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      integrationSyncs: { ok: true },
      contaAzulSyncs: { ok: true },
      contaAzulPolling: { ok: false, error: "poll failed" },
    });
  });
});
