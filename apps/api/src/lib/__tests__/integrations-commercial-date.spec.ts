import { afterEach, describe, expect, it, vi } from "vitest";
import { mapServiceOrderToSalePayload } from "../integrations";

const baseOrder = {
  externalId: "service_order:10",
  organizationId: "org-1",
  unitId: 2,
  unitName: "Laboratório massa",
  jobId: "1001",
  status: "APPROVED",
  customerExternalId: "customer:1",
  customerName: "Cliente Exemplo",
  serviceExternalId: "service:5",
  assetName: "Balança",
  assetTag: "BAL-1",
  serviceName: "Calibração",
  servicePriceCents: 15000,
  currency: "BRL",
  performedAt: null,
  approvedAt: null,
  updatedAt: null,
};

describe("service order commercial date (REQ-DATE-008)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dates a sale approved at 23:30 in Sao Paulo on the day it was approved, not the UTC day", () => {
    // 23:30-03:00 on 2026-05-20 is 02:30Z on 2026-05-21.
    const sale = mapServiceOrderToSalePayload({
      ...baseOrder,
      approvedAt: "2026-05-21T02:30:00.000Z",
    });

    expect(sale.saleDate).toBe("2026-05-20");
    expect(sale.paymentTerms?.dueDate).toBe("2026-05-20");
  });

  it("falls back to performedAt and updatedAt on the Sao Paulo day too", () => {
    expect(
      mapServiceOrderToSalePayload({
        ...baseOrder,
        performedAt: "2026-05-21T02:30:00.000Z",
        updatedAt: "2026-05-25T12:00:00.000Z",
      }).saleDate,
    ).toBe("2026-05-20");
    expect(
      mapServiceOrderToSalePayload({
        ...baseOrder,
        updatedAt: "2026-05-21T02:30:00.000Z",
      }).saleDate,
    ).toBe("2026-05-20");
  });

  it("uses today in Sao Paulo when the order has no date at all", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T23:30:00-03:00"));

    expect(mapServiceOrderToSalePayload(baseOrder).saleDate).toBe("2026-05-20");
  });
});
