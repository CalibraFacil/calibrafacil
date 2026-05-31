import { describe, expect, it } from "vitest";
import type { BillingReadinessItem } from "@calibra-facil/shared";

import { aggregateBlockerClasses } from "../blocker-repair";

function makeItem(
  overrides: Partial<BillingReadinessItem> & {
    blockers: BillingReadinessItem["blockers"];
  },
): BillingReadinessItem {
  return {
    serviceOrderId: overrides.serviceOrderId ?? 1,
    serviceOrderNumber: "OS-1",
    customer: overrides.customer ?? { id: 10, name: "Cliente A" },
    unit: { id: 1, name: "Sede" },
    amountCents: 10_000,
    currency: "BRL",
    completedAt: null,
    certificateRefs: [],
    readinessStatus: "BLOCKED",
    blockers: overrides.blockers,
    existingBillingDocumentId: null,
  };
}

describe("aggregateBlockerClasses", () => {
  it("returns an empty list when there are no items", () => {
    expect(aggregateBlockerClasses([])).toEqual([]);
  });

  it("groups customer-data blockers per customer id", () => {
    const result = aggregateBlockerClasses([
      makeItem({
        serviceOrderId: 1,
        customer: { id: 10, name: "Cliente A" },
        blockers: [
          {
            code: "BLOCKED_BY_CUSTOMER_DATA",
            label: "CPF/CNPJ ausente",
            owner: "finance",
            fixAction: "Informe o CPF ou CNPJ do cliente",
            scope: "customer",
          },
        ],
      }),
      makeItem({
        serviceOrderId: 2,
        customer: { id: 10, name: "Cliente A" },
        blockers: [
          {
            code: "BLOCKED_BY_CUSTOMER_DATA",
            label: "CPF/CNPJ ausente",
            owner: "finance",
            fixAction: "Informe o CPF ou CNPJ do cliente",
            scope: "customer",
          },
        ],
      }),
      makeItem({
        serviceOrderId: 3,
        customer: { id: 11, name: "Cliente B" },
        blockers: [
          {
            code: "BLOCKED_BY_CUSTOMER_DATA",
            label: "Endereço incompleto",
            owner: "finance",
            fixAction: "Complete cidade e estado",
            scope: "customer",
          },
        ],
      }),
    ]);

    expect(result).toHaveLength(2);
    const customerA = result.find((row) => row.groupKey === "customer:10");
    const customerB = result.find((row) => row.groupKey === "customer:11");
    expect(customerA?.count).toBe(2);
    expect(customerA?.affectedServiceOrderIds).toEqual([1, 2]);
    expect(customerB?.count).toBe(1);
  });

  it("collapses non-customer blockers under a global key", () => {
    const result = aggregateBlockerClasses([
      makeItem({
        serviceOrderId: 1,
        customer: { id: 10, name: "Cliente A" },
        blockers: [
          {
            code: "BLOCKED_BY_UNMAPPED_SERVICE",
            label: "Sem valor aprovado",
            owner: "admin",
            fixAction: "Defina o valor ou mapeamento",
            scope: "all_future",
          },
        ],
      }),
      makeItem({
        serviceOrderId: 2,
        customer: { id: 11, name: "Cliente B" },
        blockers: [
          {
            code: "BLOCKED_BY_UNMAPPED_SERVICE",
            label: "Sem valor aprovado",
            owner: "admin",
            fixAction: "Defina o valor ou mapeamento",
            scope: "all_future",
          },
        ],
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.groupKey).toBe("global");
    expect(result[0]?.count).toBe(2);
    expect(result[0]?.customerNames).toEqual(["Cliente A", "Cliente B"]);
  });

  it("sorts aggregates by count descending", () => {
    const result = aggregateBlockerClasses([
      makeItem({
        serviceOrderId: 1,
        blockers: [
          {
            code: "BLOCKED_BY_CERTIFICATE_STATUS",
            label: "Certificado não aprovado",
            owner: "lab_ops",
            fixAction: "Conclua a aprovação técnica",
            scope: "order",
          },
        ],
      }),
      makeItem({
        serviceOrderId: 2,
        blockers: [
          {
            code: "BLOCKED_BY_UNMAPPED_SERVICE",
            label: "Sem valor aprovado",
            owner: "admin",
            fixAction: "Defina o valor",
            scope: "all_future",
          },
        ],
      }),
      makeItem({
        serviceOrderId: 3,
        blockers: [
          {
            code: "BLOCKED_BY_UNMAPPED_SERVICE",
            label: "Sem valor aprovado",
            owner: "admin",
            fixAction: "Defina o valor",
            scope: "all_future",
          },
        ],
      }),
    ]);
    expect(result[0]?.code).toBe("BLOCKED_BY_UNMAPPED_SERVICE");
    expect(result[0]?.count).toBe(2);
  });
});
