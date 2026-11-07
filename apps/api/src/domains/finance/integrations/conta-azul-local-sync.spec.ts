import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContaAzulSyncMessage } from "@calibra-facil/schemas";

const mocks = vi.hoisted(() => ({ runIntegrationSync: vi.fn() }));

vi.mock("./sync-run", () => ({ runIntegrationSync: mocks.runIntegrationSync }));
vi.mock("../../../lib/runtime-env", () => ({
  createWorkerRuntimeEnv: vi.fn(() => ({})),
}));

import { dispatchContaAzulSync } from "./conta-azul-local-sync";

const message: ContaAzulSyncMessage = {
  type: "CONTA_AZUL_SYNC",
  integrationId: "integration-1",
  organizationId: "org-1",
  runId: "run-1",
  target: "customer",
  limit: 50,
  trigger: "manual",
};

describe("dispatchContaAzulSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the sync in this process and returns a local id", async () => {
    mocks.runIntegrationSync.mockResolvedValue(undefined);

    const result = await dispatchContaAzulSync(message);

    expect(result.messageId).toMatch(/^local-/);
    await vi.waitFor(() =>
      expect(mocks.runIntegrationSync).toHaveBeenCalledWith(
        expect.objectContaining({
          integrationId: "integration-1",
          organizationId: "org-1",
          runId: "run-1",
          target: "customer",
          limit: 50,
        }),
      ),
    );
  });

  it("logs a failed sync instead of rejecting", async () => {
    mocks.runIntegrationSync.mockRejectedValue(new Error("boom"));

    await expect(dispatchContaAzulSync(message)).resolves.toBeDefined();

    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "[BackgroundJobs] Local Conta Azul job failed",
        expect.objectContaining({ runId: "run-1", error: "boom" }),
      ),
    );
  });

  it("rejects a malformed message", async () => {
    const malformed: ContaAzulSyncMessage = JSON.parse(
      JSON.stringify({ ...message, limit: "many" }),
    );

    await expect(dispatchContaAzulSync(malformed)).rejects.toThrow(
      "invalid Conta Azul sync",
    );
    expect(mocks.runIntegrationSync).not.toHaveBeenCalled();
  });
});
