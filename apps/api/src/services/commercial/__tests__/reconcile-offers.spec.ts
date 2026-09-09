import { describe, expect, it, vi } from "vitest";

vi.mock("@calibra-facil/db", () => ({
  db: { select: vi.fn(), update: vi.fn() },
}));

import { createAsaasOfferReconciliationPort } from "../reconcile-offers";
import { AsaasError } from "../../asaas/client";

vi.mock("../../asaas/payments", () => ({
  getPayment: vi.fn(),
}));

const { getPayment } = await import("../../asaas/payments");

describe("createAsaasOfferReconciliationPort", () => {
  it("treats a charge deleted at the provider as an answer, not a failure", async () => {
    vi.mocked(getPayment).mockRejectedValueOnce(
      new AsaasError({ errors: [{ code: "not_found", description: "x" }] }),
    );

    await expect(
      createAsaasOfferReconciliationPort().getPayment("pay_gone"),
    ).resolves.toBeNull();
  });

  it("lets a real provider failure surface", async () => {
    vi.mocked(getPayment).mockRejectedValueOnce(
      new AsaasError({ errors: [{ code: "internal", description: "boom" }] }),
    );

    await expect(
      createAsaasOfferReconciliationPort().getPayment("pay_1"),
    ).rejects.toThrow(AsaasError);
  });
});
