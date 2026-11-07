import { describe, expect, it } from "vitest";

import { evaluateBillingGroupCompatibility } from "../billing-group";

describe("evaluateBillingGroupCompatibility", () => {
  it("rejects an empty input", () => {
    expect(evaluateBillingGroupCompatibility([])).toEqual({
      compatible: false,
      reasons: ["Nenhuma OS informada"],
    });
  });

  it("accepts a single SO trivially", () => {
    expect(
      evaluateBillingGroupCompatibility([
        {
          serviceOrderId: 1,
          customerId: 10,
          paymentTermDays: 28,
          currency: "BRL",
          billingReferenceDate: "2026-05-01T00:00:00.000Z",
        },
      ]),
    ).toEqual({ compatible: true, reasons: [] });
  });

  it("accepts multiple compatible SOs", () => {
    expect(
      evaluateBillingGroupCompatibility([
        {
          serviceOrderId: 1,
          customerId: 10,
          paymentTermDays: 28,
          currency: "BRL",
          billingReferenceDate: "2026-05-01T00:00:00.000Z",
        },
        {
          serviceOrderId: 2,
          customerId: 10,
          paymentTermDays: 28,
          currency: "BRL",
          billingReferenceDate: "2026-05-15T00:00:00.000Z",
        },
      ]),
    ).toEqual({ compatible: true, reasons: [] });
  });

  it("rejects when customers differ", () => {
    const result = evaluateBillingGroupCompatibility([
      {
        serviceOrderId: 1,
        customerId: 10,
        paymentTermDays: 28,
        currency: "BRL",
        billingReferenceDate: "2026-05-01T00:00:00.000Z",
      },
      {
        serviceOrderId: 2,
        customerId: 11,
        paymentTermDays: 28,
        currency: "BRL",
        billingReferenceDate: "2026-05-01T00:00:00.000Z",
      },
    ]);
    expect(result.compatible).toBe(false);
    expect(result.reasons).toContain("As OS pertencem a clientes diferentes");
  });

  it("rejects when payment terms differ", () => {
    const result = evaluateBillingGroupCompatibility([
      {
        serviceOrderId: 1,
        customerId: 10,
        paymentTermDays: 28,
        currency: "BRL",
        billingReferenceDate: "2026-05-01T00:00:00.000Z",
      },
      {
        serviceOrderId: 2,
        customerId: 10,
        paymentTermDays: 14,
        currency: "BRL",
        billingReferenceDate: "2026-05-01T00:00:00.000Z",
      },
    ]);
    expect(result.compatible).toBe(false);
    expect(result.reasons).toContain(
      "As OS têm prazos de pagamento diferentes",
    );
  });

  it("rejects when currencies differ", () => {
    const result = evaluateBillingGroupCompatibility([
      {
        serviceOrderId: 1,
        customerId: 10,
        paymentTermDays: 28,
        currency: "BRL",
        billingReferenceDate: "2026-05-01T00:00:00.000Z",
      },
      {
        serviceOrderId: 2,
        customerId: 10,
        paymentTermDays: 28,
        currency: "USD",
        billingReferenceDate: "2026-05-01T00:00:00.000Z",
      },
    ]);
    expect(result.compatible).toBe(false);
    expect(result.reasons).toContain("As OS têm moedas diferentes");
  });

  it("rejects when billing dates span more than 31 days", () => {
    const result = evaluateBillingGroupCompatibility([
      {
        serviceOrderId: 1,
        customerId: 10,
        paymentTermDays: 28,
        currency: "BRL",
        billingReferenceDate: "2026-04-01T00:00:00.000Z",
      },
      {
        serviceOrderId: 2,
        customerId: 10,
        paymentTermDays: 28,
        currency: "BRL",
        billingReferenceDate: "2026-05-15T00:00:00.000Z",
      },
    ]);
    expect(result.compatible).toBe(false);
    expect(result.reasons[0]).toMatch(/período de faturamento/);
  });

  it("accumulates multiple reasons", () => {
    const result = evaluateBillingGroupCompatibility([
      {
        serviceOrderId: 1,
        customerId: 10,
        paymentTermDays: 28,
        currency: "BRL",
        billingReferenceDate: "2026-04-01T00:00:00.000Z",
      },
      {
        serviceOrderId: 2,
        customerId: 11,
        paymentTermDays: 14,
        currency: "USD",
        billingReferenceDate: "2026-05-15T00:00:00.000Z",
      },
    ]);
    expect(result.compatible).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
