import { describe, expect, it } from "vitest";
import type { BillingBlocker } from "@calibra-facil/shared";

import {
  classifyServiceOrder,
  summarizeOperationsToCash,
  type ClassifiedServiceOrderItem,
} from "../operations-to-cash";

const NO_BLOCKERS: BillingBlocker[] = [];
const ONE_BLOCKER: BillingBlocker[] = [
  {
    code: "BLOCKED_BY_CUSTOMER_DATA",
    label: "CPF/CNPJ ausente",
    owner: "finance",
    fixAction: "Informe o CPF ou CNPJ do cliente",
    scope: "customer",
  },
];

describe("classifyServiceOrder", () => {
  it("classifies SOs without a billing document as READY_TO_BILL", () => {
    expect(
      classifyServiceOrder({
        hasBillingDocument: false,
        billingDocumentStatus: null,
        billingDocumentExportStatus: null,
        installmentStatuses: [],
        blockers: NO_BLOCKERS,
      }),
    ).toEqual({ stage: "READY_TO_BILL", isOverdue: false, isBlocked: false });
  });

  it("flags blocked READY_TO_BILL SOs without changing the stage", () => {
    const result = classifyServiceOrder({
      hasBillingDocument: false,
      billingDocumentStatus: null,
      billingDocumentExportStatus: null,
      installmentStatuses: [],
      blockers: ONE_BLOCKER,
    });
    expect(result.stage).toBe("READY_TO_BILL");
    expect(result.isBlocked).toBe(true);
  });

  it("classifies DRAFT billing documents as SENT_TO_FINANCE", () => {
    expect(
      classifyServiceOrder({
        hasBillingDocument: true,
        billingDocumentStatus: "DRAFT",
        billingDocumentExportStatus: "PENDING",
        installmentStatuses: ["OPEN"],
        blockers: NO_BLOCKERS,
      }).stage,
    ).toBe("SENT_TO_FINANCE");
  });

  it("classifies ISSUED billing documents as INVOICED", () => {
    expect(
      classifyServiceOrder({
        hasBillingDocument: true,
        billingDocumentStatus: "ISSUED",
        billingDocumentExportStatus: "EXPORTED",
        installmentStatuses: ["OPEN", "OPEN"],
        blockers: NO_BLOCKERS,
      }).stage,
    ).toBe("INVOICED");
  });

  it("flags OVERDUE billing documents while keeping the INVOICED stage", () => {
    const result = classifyServiceOrder({
      hasBillingDocument: true,
      billingDocumentStatus: "OVERDUE",
      billingDocumentExportStatus: "EXPORTED",
      installmentStatuses: ["OVERDUE"],
      blockers: NO_BLOCKERS,
    });
    expect(result.stage).toBe("INVOICED");
    expect(result.isOverdue).toBe(true);
  });

  it("classifies partial payment as PARTIALLY_COLLECTED", () => {
    expect(
      classifyServiceOrder({
        hasBillingDocument: true,
        billingDocumentStatus: "ISSUED",
        billingDocumentExportStatus: "EXPORTED",
        installmentStatuses: ["PAID", "OPEN"],
        blockers: NO_BLOCKERS,
      }).stage,
    ).toBe("PARTIALLY_COLLECTED");
  });

  it("classifies fully-paid SOs as COLLECTED via billing-document status", () => {
    expect(
      classifyServiceOrder({
        hasBillingDocument: true,
        billingDocumentStatus: "PAID",
        billingDocumentExportStatus: "EXPORTED",
        installmentStatuses: ["PAID"],
        blockers: NO_BLOCKERS,
      }).stage,
    ).toBe("COLLECTED");
  });

  it("classifies fully-paid SOs as COLLECTED when every active installment is PAID", () => {
    expect(
      classifyServiceOrder({
        hasBillingDocument: true,
        billingDocumentStatus: "ISSUED",
        billingDocumentExportStatus: "EXPORTED",
        installmentStatuses: ["PAID", "PAID", "VOID"],
        blockers: NO_BLOCKERS,
      }).stage,
    ).toBe("COLLECTED");
  });

  it("flags OVERDUE installments even when the billing document is still ISSUED", () => {
    const result = classifyServiceOrder({
      hasBillingDocument: true,
      billingDocumentStatus: "ISSUED",
      billingDocumentExportStatus: "EXPORTED",
      installmentStatuses: ["OVERDUE", "OPEN"],
      blockers: NO_BLOCKERS,
    });
    expect(result.stage).toBe("INVOICED");
    expect(result.isOverdue).toBe(true);
  });
});

describe("summarizeOperationsToCash", () => {
  function makeItem(
    overrides: Partial<ClassifiedServiceOrderItem>,
  ): ClassifiedServiceOrderItem {
    return {
      serviceOrderId: 1,
      serviceOrderNumber: "OS-1",
      customer: { id: 10, name: "Cliente A" },
      unit: { id: 1, name: "Sede" },
      amountCents: 10_000,
      currency: "BRL",
      stage: "READY_TO_BILL",
      isOverdue: false,
      isBlocked: false,
      ...overrides,
    };
  }

  it("returns zero buckets for every stage when input is empty", () => {
    const summary = summarizeOperationsToCash([]);
    for (const stage of [
      "READY_TO_BILL",
      "SENT_TO_FINANCE",
      "INVOICED",
      "PARTIALLY_COLLECTED",
      "COLLECTED",
    ] as const) {
      expect(summary.stages[stage]).toEqual({ count: 0, totalCents: 0 });
    }
    expect(summary.needsAttention).toEqual({
      overdueCount: 0,
      blockedCount: 0,
      overdueCents: 0,
      blockedCents: 0,
    });
  });

  it("aggregates counts + cents per stage", () => {
    const summary = summarizeOperationsToCash([
      makeItem({
        serviceOrderId: 1,
        stage: "READY_TO_BILL",
        amountCents: 10_000,
      }),
      makeItem({
        serviceOrderId: 2,
        stage: "READY_TO_BILL",
        amountCents: 25_000,
      }),
      makeItem({
        serviceOrderId: 3,
        stage: "INVOICED",
        amountCents: 50_000,
      }),
    ]);
    expect(summary.stages.READY_TO_BILL).toEqual({
      count: 2,
      totalCents: 35_000,
    });
    expect(summary.stages.INVOICED).toEqual({
      count: 1,
      totalCents: 50_000,
    });
    expect(summary.stages.COLLECTED).toEqual({ count: 0, totalCents: 0 });
  });

  it("counts overdue + blocked overlays separately from stages", () => {
    const summary = summarizeOperationsToCash([
      makeItem({
        serviceOrderId: 1,
        stage: "INVOICED",
        amountCents: 30_000,
        isOverdue: true,
      }),
      makeItem({
        serviceOrderId: 2,
        stage: "READY_TO_BILL",
        amountCents: 12_000,
        isBlocked: true,
      }),
      makeItem({
        serviceOrderId: 3,
        stage: "INVOICED",
        amountCents: 8_000,
        isOverdue: true,
        isBlocked: true,
      }),
    ]);
    expect(summary.needsAttention).toEqual({
      overdueCount: 2,
      blockedCount: 2,
      overdueCents: 38_000,
      blockedCents: 20_000,
    });
  });
});
