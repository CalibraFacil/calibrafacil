import { beforeEach, describe, expect, it, vi } from "vitest";
import { isServiceOrderBillable } from "@calibra-facil/shared";

const mocks = vi.hoisted(() => {
  const state: {
    results: unknown[][];
  } = {
    results: [],
  };

  class FakeQuery implements PromiseLike<unknown[]> {
    constructor(private readonly result: unknown[]) {}

    from(_table?: unknown) {
      return this;
    }

    innerJoin(_table?: unknown, _condition?: unknown) {
      return this;
    }

    where(_condition?: unknown) {
      return this;
    }

    orderBy(..._columns: unknown[]) {
      return this;
    }

    groupBy(..._columns: unknown[]) {
      return this;
    }

    limit(_count: number) {
      return this;
    }

    // oxlint-disable-next-line unicorn/no-thenable -- FakeQuery intentionally emulates Drizzle's awaitable query builder; `then` is required so `await db.select()...` resolves in the test.
    then<TResult1 = unknown[], TResult2 = never>(
      onfulfilled?:
        | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ) {
      return Promise.resolve(this.result).then(onfulfilled, onrejected);
    }
  }

  return {
    db: {
      select: vi.fn(() => new FakeQuery(state.results.shift() ?? [])),
    },
    state,
  };
});

vi.mock("@calibra-facil/db", () => ({
  db: mocks.db,
}));

import {
  computeBillingReadinessQueue,
  evaluateOrderBlockers,
} from "../billing-readiness";

const completeCustomer = {
  taxId: "12345678000190",
  email: "financeiro@cliente.com",
  address: { city: "São Paulo", state: "SP" },
};

function useDbResults(...results: unknown[][]) {
  mocks.state.results = [...results];
}

beforeEach(() => {
  vi.clearAllMocks();
  useDbResults();
});

describe("evaluateOrderBlockers", () => {
  it("returns no blockers for a clean billable order", () => {
    expect(
      evaluateOrderBlockers({
        customer: completeCustomer,
        certificateJobStatuses: ["APPROVED"],
        amountCents: 25000,
      }),
    ).toEqual([]);
  });

  it("blocks on missing customer tax id", () => {
    const blockers = evaluateOrderBlockers({
      customer: { ...completeCustomer, taxId: null },
      certificateJobStatuses: ["APPROVED"],
      amountCents: 25000,
    });
    expect(blockers.map((b) => b.code)).toContain("BLOCKED_BY_CUSTOMER_DATA");
    expect(blockers[0]?.owner).toBe("finance");
    expect(blockers[0]?.scope).toBe("customer");
  });

  it("blocks on missing email", () => {
    const blockers = evaluateOrderBlockers({
      customer: { ...completeCustomer, email: "  " },
      certificateJobStatuses: ["SUPERSEDED"],
      amountCents: 25000,
    });
    expect(blockers.map((b) => b.code)).toContain("BLOCKED_BY_CUSTOMER_DATA");
  });

  it("blocks on incomplete address", () => {
    const blockers = evaluateOrderBlockers({
      customer: { ...completeCustomer, address: { city: "São Paulo" } },
      certificateJobStatuses: ["APPROVED"],
      amountCents: 25000,
    });
    expect(blockers.map((b) => b.code)).toContain("BLOCKED_BY_CUSTOMER_DATA");
  });

  it("blocks when linked certificates are not approved", () => {
    const blockers = evaluateOrderBlockers({
      customer: completeCustomer,
      certificateJobStatuses: ["REVIEW", "DRAFT"],
      amountCents: 25000,
    });
    expect(blockers.map((b) => b.code)).toContain(
      "BLOCKED_BY_CERTIFICATE_STATUS",
    );
    expect(
      blockers.find((b) => b.code === "BLOCKED_BY_CERTIFICATE_STATUS")?.owner,
    ).toBe("lab_ops");
  });

  it("does not require a certificate when none are linked", () => {
    const blockers = evaluateOrderBlockers({
      customer: completeCustomer,
      certificateJobStatuses: [],
      amountCents: 25000,
    });
    expect(blockers.map((b) => b.code)).not.toContain(
      "BLOCKED_BY_CERTIFICATE_STATUS",
    );
  });

  it("blocks when the order has no resolvable amount", () => {
    const blockers = evaluateOrderBlockers({
      customer: completeCustomer,
      certificateJobStatuses: ["APPROVED"],
      amountCents: 0,
    });
    expect(blockers.map((b) => b.code)).toContain(
      "BLOCKED_BY_UNMAPPED_SERVICE",
    );
    expect(
      blockers.find((b) => b.code === "BLOCKED_BY_UNMAPPED_SERVICE")?.scope,
    ).toBe("all_future");
  });

  it("accumulates multiple blockers", () => {
    const blockers = evaluateOrderBlockers({
      customer: { taxId: null, email: null, address: null },
      certificateJobStatuses: ["REVIEW"],
      amountCents: 0,
    });
    const codes = new Set(blockers.map((b) => b.code));
    expect(codes.has("BLOCKED_BY_CERTIFICATE_STATUS")).toBe(true);
    expect(codes.has("BLOCKED_BY_CUSTOMER_DATA")).toBe(true);
    expect(codes.has("BLOCKED_BY_UNMAPPED_SERVICE")).toBe(true);
  });

  it("emits granular payer-readiness rows (Phase 2 slice 5)", () => {
    const blockers = evaluateOrderBlockers({
      customer: { taxId: null, email: null, address: null },
      certificateJobStatuses: [],
      amountCents: 1_000,
    });
    const labels = blockers.map((b) => b.label);
    expect(labels).toContain("CPF/CNPJ do cliente ausente");
    expect(labels).toContain("E-mail do cliente ausente");
    expect(labels).toContain("Endereço do cliente incompleto");
  });

  it("does not emit payer rows when payer fields are complete", () => {
    const blockers = evaluateOrderBlockers({
      customer: {
        taxId: "12345678900",
        email: "cliente@example.com",
        address: { city: "São Paulo", state: "SP" },
      },
      certificateJobStatuses: ["APPROVED"],
      amountCents: 1_000,
    });
    expect(blockers).toHaveLength(0);
  });
});

describe("isServiceOrderBillable", () => {
  it("accepts completed operational statuses", () => {
    expect(isServiceOrderBillable("ready_for_pickup", null)).toBe(true);
    expect(isServiceOrderBillable("delivered", null)).toBe(true);
    expect(isServiceOrderBillable("closed", "completed_calibrated")).toBe(true);
  });

  it("rejects in-progress and non-billable closing reasons", () => {
    expect(isServiceOrderBillable("opened", null)).toBe(false);
    expect(isServiceOrderBillable("calibration_in_progress", null)).toBe(false);
    expect(isServiceOrderBillable("closed", "quote_rejected_returned")).toBe(
      false,
    );
    expect(isServiceOrderBillable("closed", "canceled_before_execution")).toBe(
      false,
    );
  });
});

describe("computeBillingReadinessQueue", () => {
  it("carries the resolved billing document id into readiness items", async () => {
    useDbResults(
      [{ status: "ACTIVE" }],
      [
        {
          id: 42,
          number: "OS-42",
          status: "delivered",
          closingReason: null,
          customerId: 10,
          customerName: "Cliente A",
          taxId: "12345678000190",
          email: "financeiro@cliente.test",
          address: { city: "Sao Paulo", state: "SP" },
          unitId: 7,
          unitName: "Matriz",
          amountApprovedCents: 120_00,
          amountQuotedCents: 0,
          readyAt: null,
          deliveredAt: new Date("2026-05-20T00:00:00.000Z"),
          closedAt: null,
          billingDocumentId: 55,
        },
      ],
      [],
      // isSaleExportModeActive: no Conta Azul sale-mode connection
      [],
      [],
      [{ id: 55, status: "ISSUED", exportStatus: "EXPORTED" }],
    );

    const queue = await computeBillingReadinessQueue({
      organizationId: "org-1",
      scope: {
        activeUnitId: 7,
        accessibleUnitIds: [7],
        selectedUnitScope: "unit",
      },
    });

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      serviceOrderId: 42,
      readinessStatus: "SENT",
      existingBillingDocumentId: 55,
    });
    expect(queue.summary).toMatchObject({ sent: 1 });
  });

  it("blocks orders with unmapped catalog parts when the ERP exports sales", async () => {
    useDbResults(
      [{ status: "ACTIVE" }],
      [
        {
          id: 42,
          number: "OS-42",
          status: "delivered",
          closingReason: null,
          customerId: 10,
          customerName: "Cliente A",
          taxId: "12345678000190",
          email: "financeiro@cliente.test",
          address: { city: "Sao Paulo", state: "SP" },
          unitId: 7,
          unitName: "Matriz",
          amountApprovedCents: 120_00,
          amountQuotedCents: 0,
          readyAt: null,
          deliveredAt: new Date("2026-05-20T00:00:00.000Z"),
          closedAt: null,
          billingDocumentId: null,
        },
      ],
      [],
      // isSaleExportModeActive: active Conta Azul connection in sale mode
      [{ config: { exportMode: "sale" } }],
      // unmapped part items on the approved quote
      [{ serviceOrderId: 42, total: 2 }],
      [],
    );

    const queue = await computeBillingReadinessQueue({
      organizationId: "org-1",
      scope: {
        activeUnitId: 7,
        accessibleUnitIds: [7],
        selectedUnitScope: "unit",
      },
    });

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.readinessStatus).toBe("BLOCKED");
    expect(queue.items[0]?.blockers).toContainEqual(
      expect.objectContaining({
        code: "BLOCKED_BY_UNMAPPED_SERVICE",
        label: "2 peças sem material do catálogo vinculado",
        owner: "commercial",
        scope: "order",
      }),
    );
  });
});
