import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../vercel-src/cron/dispatch";

// Unit tier for the REL-03 `queue-backstop` cron handler. Same fail-closed auth
// contract as every other cron (503 without a CRON_SECRET on Vercel, 401 on a
// wrong secret), and on success it returns runStaleJobBackstop's summary verbatim
// so a broken run surfaces in the cron heartbeat. The backstop itself is mocked
// here (its DB + wake behavior is covered by the real-DB integration tier); this
// only asserts the cron wiring + auth.

const mocks = vi.hoisted(() => ({
  cleanupExpiredAuthRecords: vi.fn(),
  createWorkerRuntimeEnv: vi.fn(() => ({ DATABASE_URL: "postgres://test" })),
  enqueueBackgroundJob: vi.fn(),
  processScheduledContaAzulIntegrationSyncs: vi.fn(),
  processScheduledContaAzulPolls: vi.fn(),
  processScheduledIntegrationSyncs: vi.fn(),
  drainServiceOrderEmailOutbox: vi.fn(),
  runStaleJobBackstop: vi.fn(),
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

vi.mock("../../lib/service-order-email-drain", () => ({
  drainServiceOrderEmailOutbox: mocks.drainServiceOrderEmailOutbox,
}));

vi.mock("../../lib/stale-job-backstop", () => ({
  runStaleJobBackstop: mocks.runStaleJobBackstop,
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
  mocks.runStaleJobBackstop.mockResolvedValue({
    released: 0,
    pending: 0,
    woke: false,
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("queue-backstop cron (REQ-REL-PDF-001)", () => {
  it("REQ-REL-PDF-001 runs the periodic backstop and returns its summary", async () => {
    mocks.runStaleJobBackstop.mockResolvedValue({
      released: 2,
      pending: 3,
      woke: true,
    });

    const response = await GET(request("/api/cron/queue-backstop"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      released: 2,
      pending: 3,
      woke: true,
    });
    expect(mocks.runStaleJobBackstop).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid cron credentials", async () => {
    process.env.CRON_SECRET = "secret-1";

    const response = await GET(
      request("/api/cron/queue-backstop", { authorization: "Bearer wrong" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.runStaleJobBackstop).not.toHaveBeenCalled();
  });

  it("fails closed without a CRON_SECRET on Vercel", async () => {
    process.env.VERCEL = "1";

    const response = await GET(request("/api/cron/queue-backstop"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "CRON_SECRET não configurado",
    });
    expect(mocks.runStaleJobBackstop).not.toHaveBeenCalled();
  });
});
