import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    results: unknown[][];
    selectCalls: unknown[];
    whereCalls: unknown[];
  } = {
    results: [],
    selectCalls: [],
    whereCalls: [],
  };

  class FakeQuery implements PromiseLike<unknown[]> {
    constructor(private readonly result: unknown[]) {}

    from(_table?: unknown) {
      return this;
    }

    innerJoin(_table?: unknown, _condition?: unknown) {
      return this;
    }

    leftJoin(_table?: unknown, _condition?: unknown) {
      return this;
    }

    where(condition?: unknown) {
      state.whereCalls.push(condition);
      return this;
    }

    orderBy(..._columns: unknown[]) {
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
      select: vi.fn((selection?: unknown) => {
        state.selectCalls.push(selection);
        return new FakeQuery(state.results.shift() ?? []);
      }),
    },
    getFinancialIntegrationState: vi.fn(),
    buildUnitScopeCondition: vi.fn(() => undefined),
    resolveServiceOrderBillingDocumentLinks: vi.fn(),
    state,
  };
});

vi.mock("@calibra-facil/db", () => ({
  db: mocks.db,
}));

vi.mock("../billing-readiness", () => ({
  getFinancialIntegrationState: mocks.getFinancialIntegrationState,
}));

vi.mock("../finance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../finance")>();
  return {
    ...actual,
    resolveServiceOrderBillingDocumentLinks:
      mocks.resolveServiceOrderBillingDocumentLinks,
  };
});

vi.mock("../units", () => ({
  buildUnitScopeCondition: mocks.buildUnitScopeCondition,
}));

import {
  buildCustomerFinancialTimeline,
  buildServiceOrderFinancialStatus,
} from "../financial-timeline";

function useDbResults(...results: unknown[][]) {
  mocks.state.results = [...results];
  mocks.state.selectCalls = [];
  mocks.state.whereCalls = [];
}

const unitScope = {
  activeUnitId: 7,
  accessibleUnitIds: [7],
  selectedUnitScope: "unit" as const,
  canAccessAllUnits: false,
};

function billingDocumentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    documentNumber: "FIN-50",
    status: "ISSUED",
    exportStatus: "EXPORTED",
    issueDate: new Date("2026-05-20T00:00:00.000Z"),
    dueDate: new Date("2026-06-20T00:00:00.000Z"),
    totalCents: 120_00,
    currency: "BRL",
    createdAt: new Date("2026-05-20T00:00:00.000Z"),
    ...overrides,
  };
}

function renderSqlCondition(value: unknown): string {
  const chunks: string[] = [];
  const visit = (chunk: unknown): void => {
    if (!chunk) return;
    if (Array.isArray(chunk)) {
      for (const nested of chunk) visit(nested);
      return;
    }
    if (typeof chunk === "object") {
      if ("queryChunks" in chunk && Array.isArray(chunk.queryChunks)) {
        for (const nested of chunk.queryChunks) visit(nested);
        return;
      }
      if ("value" in chunk && Array.isArray(chunk.value)) {
        chunks.push(...chunk.value.map(String));
        return;
      }
      if ("name" in chunk && typeof chunk.name === "string") {
        chunks.push(`[${chunk.name}]`);
        return;
      }
      if ("value" in chunk) {
        chunks.push(`{${String(chunk.value)}}`);
      }
    }
  };

  visit(value);
  return chunks.join("");
}

describe("financial timeline read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDbResults();
    mocks.buildUnitScopeCondition.mockReturnValue(undefined);
    mocks.getFinancialIntegrationState.mockResolvedValue("connected");
    mocks.resolveServiceOrderBillingDocumentLinks.mockResolvedValue(new Map());
  });

  it("returns null for a service order outside the organization or unit scope", async () => {
    useDbResults([]);

    await expect(
      buildServiceOrderFinancialStatus({
        organizationId: "org-1",
        scope: unitScope,
        serviceOrderId: 42,
        includeProviderEvidence: false,
      }),
    ).resolves.toBeNull();

    expect(
      mocks.resolveServiceOrderBillingDocumentLinks,
    ).not.toHaveBeenCalled();
    expect(mocks.buildUnitScopeCondition).toHaveBeenCalledWith(
      expect.anything(),
      unitScope,
    );
  });

  it("keeps a resolved cross-unit billing document from becoming a ready-to-bill contradiction", async () => {
    mocks.resolveServiceOrderBillingDocumentLinks.mockResolvedValue(
      new Map([
        [
          42,
          {
            documentId: 50,
            status: "ISSUED",
            exportStatus: "EXPORTED",
          },
        ],
      ]),
    );
    useDbResults(
      [
        {
          id: 42,
          number: "OS-42",
          customerId: 10,
          customerName: "Cliente A",
          taxId: "12345678000190",
          email: "financeiro@cliente.test",
          address: { city: "Sao Paulo", state: "SP" },
          unitId: 7,
          amountApprovedCents: 120_00,
          amountQuotedCents: 0,
          billingDocumentId: 50,
        },
      ],
      [],
      [billingDocumentRow({ unitId: 9 })],
      [
        {
          id: 70,
          documentId: 50,
          installmentNumber: 1,
          status: "OPEN",
          amountCents: 120_00,
          currency: "BRL",
          dueDate: new Date("2026-06-20T00:00:00.000Z"),
          paidAt: null,
          paymentMethod: null,
        },
      ],
      [],
    );

    const result = await buildServiceOrderFinancialStatus({
      organizationId: "org-1",
      scope: unitScope,
      serviceOrderId: 42,
      includeProviderEvidence: false,
    });

    expect(result).toMatchObject({
      serviceOrderId: 42,
      status: "AWAITING_PAYMENT",
      readinessStatus: "SENT",
      billingDocument: {
        id: 50,
      },
    });
    expect(result?.description).toBe("Aguardando confirmação de pagamento.");
  });

  it("marks exported service-order status unavailable when provider polling is stale", async () => {
    mocks.resolveServiceOrderBillingDocumentLinks.mockResolvedValue(
      new Map([
        [
          42,
          {
            documentId: 50,
            status: "ISSUED",
            exportStatus: "EXPORTED",
          },
        ],
      ]),
    );
    useDbResults(
      [
        {
          id: 42,
          number: "OS-42",
          customerId: 10,
          customerName: "Cliente A",
          taxId: "12345678000190",
          email: "financeiro@cliente.test",
          address: { city: "Sao Paulo", state: "SP" },
          unitId: 7,
          amountApprovedCents: 120_00,
          amountQuotedCents: 0,
          billingDocumentId: 50,
        },
      ],
      [],
      [billingDocumentRow()],
      [
        {
          id: 70,
          documentId: 50,
          installmentNumber: 1,
          status: "OPEN",
          amountCents: 120_00,
          currency: "BRL",
          dueDate: new Date("2026-06-20T00:00:00.000Z"),
          paidAt: null,
          paymentMethod: null,
        },
      ],
      [],
      [
        { id: "integration-old", provider: "conta_azul", status: "DISABLED" },
        { id: "integration-1", provider: "conta_azul", status: "ACTIVE" },
      ],
      [
        {
          integrationId: "integration-old",
          lastSuccessfulPollAt: new Date("2100-01-01T00:00:00.000Z"),
        },
        {
          integrationId: "integration-1",
          lastSuccessfulPollAt: new Date("2026-05-20T00:00:00.000Z"),
        },
      ],
      [
        {
          target: "billing_document",
          localEntityId: "billing_document:50",
          remoteEntityId: "sale-50",
          metadata: null,
          lastSyncedAt: new Date("2026-05-20T00:00:00.000Z"),
        },
      ],
    );

    const result = await buildServiceOrderFinancialStatus({
      organizationId: "org-1",
      scope: unitScope,
      serviceOrderId: 42,
      includeProviderEvidence: true,
    });

    expect(result).toMatchObject({
      status: "STATUS_UNAVAILABLE",
      label: "Status indisponível",
      freshness: { status: "stale" },
      providerEvidence: { label: "Conta Azul sem atualização recente" },
    });
    expect(result?.description).toMatch(
      /^Status indisponível - última sincronização em 19\/05\/2026, 21:00/,
    );
    expect(result?.description).not.toContain("UTC");
  });

  it("passes direct and certificate-job linkage inputs into the shared resolver", async () => {
    useDbResults(
      [
        {
          id: 42,
          number: "OS-42",
          customerId: 10,
          customerName: "Cliente A",
          taxId: "12345678000190",
          email: "financeiro@cliente.test",
          address: { city: "Sao Paulo", state: "SP" },
          unitId: 7,
          amountApprovedCents: 120_00,
          amountQuotedCents: 0,
          billingDocumentId: 50,
        },
      ],
      [
        { jobId: 700, jobStatus: "APPROVED" },
        { jobId: 701, jobStatus: "APPROVED" },
      ],
      [],
      [],
      [],
    );

    await buildServiceOrderFinancialStatus({
      organizationId: "org-1",
      scope: unitScope,
      serviceOrderId: 42,
      includeProviderEvidence: false,
    });

    expect(mocks.resolveServiceOrderBillingDocumentLinks).toHaveBeenCalledWith(
      [
        {
          serviceOrderId: 42,
          directBillingDocumentId: 50,
          certificateJobIds: [700, 701],
        },
      ],
      "org-1",
    );
  });

  it("returns local-only customer timeline data without integration evidence", async () => {
    useDbResults(
      [{ id: 10, name: "Cliente A" }],
      [
        {
          ...billingDocumentRow(),
          unitId: 7,
          unitName: "Matriz",
        },
      ],
      [
        {
          id: 70,
          documentId: 50,
          installmentNumber: 1,
          status: "PAID",
          amountCents: 120_00,
          currency: "BRL",
          dueDate: new Date("2026-06-20T00:00:00.000Z"),
          paidAt: new Date("2026-06-19T00:00:00.000Z"),
          paymentMethod: "PIX",
        },
      ],
      [
        {
          id: 80,
          installmentId: 70,
          receivedAt: new Date("2026-06-19T00:00:00.000Z"),
          amountCents: 120_00,
          paymentMethod: "PIX",
          reference: "pix-1",
        },
      ],
    );

    const result = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: unitScope,
      customerId: 10,
      includeProviderEvidence: false,
    });

    expect(result).toMatchObject({
      customerId: 10,
      freshness: { status: "local_only", label: "Status local" },
      summary: {
        scopeLabel: "Unidade ativa",
        documents: 1,
        totalDocuments: 1,
        openCents: 0,
        overdueCents: 0,
        receivedCents: 120_00,
      },
      data: [
        {
          id: 50,
          continuityStatus: "PAID",
          label: "Pago",
          providerEvidence: null,
          fiscalDocuments: [],
          freshness: { status: "local_only" },
        },
      ],
    });
    expect(mocks.buildUnitScopeCondition).toHaveBeenCalledWith(
      expect.anything(),
      unitScope,
    );
  });

  it("fetches one extra customer document to report the timeline truncation flag honestly", async () => {
    const twentyDocuments = Array.from({ length: 20 }, (_, index) => ({
      ...billingDocumentRow({
        id: 50 + index,
        documentNumber: `FIN-${50 + index}`,
      }),
      unitId: 7,
      unitName: "Matriz",
    }));
    useDbResults([{ id: 10, name: "Cliente A" }], twentyDocuments, []);

    const exactLimit = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: unitScope,
      customerId: 10,
      includeProviderEvidence: false,
    });

    expect(exactLimit?.summary).toMatchObject({
      documents: 20,
      totalDocuments: 20,
      limit: 20,
      isTruncated: false,
    });
    expect(exactLimit?.data).toHaveLength(20);

    const twentyOneDocuments = Array.from({ length: 21 }, (_, index) => ({
      ...billingDocumentRow({
        id: 100 + index,
        documentNumber: `FIN-${100 + index}`,
      }),
      unitId: 7,
      unitName: "Matriz",
    }));
    useDbResults(
      [{ id: 10, name: "Cliente A" }],
      twentyOneDocuments,
      [],
      [
        {
          totalDocuments: 21,
          openCents: 0,
          overdueCents: 0,
          receivedCents: 0,
        },
      ],
    );

    const overLimit = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: unitScope,
      customerId: 10,
      includeProviderEvidence: false,
    });

    expect(overLimit?.summary).toMatchObject({
      documents: 20,
      totalDocuments: 21,
      limit: 20,
      isTruncated: true,
    });
    expect(overLimit?.data).toHaveLength(20);
  });

  it("computes customer summary balances across documents hidden by timeline truncation", async () => {
    const twentyOneDocuments = Array.from({ length: 21 }, (_, index) => ({
      ...billingDocumentRow({
        id: 100 + index,
        documentNumber: `FIN-${100 + index}`,
      }),
      unitId: 7,
      unitName: "Matriz",
    }));
    const tailDocumentId = 120;
    useDbResults(
      [{ id: 10, name: "Cliente A" }],
      twentyOneDocuments,
      [],
      [
        {
          totalDocuments: 21,
          openCents: 50_00,
          overdueCents: 60_00,
          receivedCents: 70_00,
        },
      ],
    );

    const result = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: unitScope,
      customerId: 10,
      includeProviderEvidence: false,
    });

    expect(result?.summary).toMatchObject({
      documents: 20,
      totalDocuments: 21,
      limit: 20,
      isTruncated: true,
      openCents: 50_00,
      overdueCents: 60_00,
      receivedCents: 70_00,
    });
    expect(result?.data).toHaveLength(20);
    expect(
      result?.data.some((document) => document.id === tailDocumentId),
    ).toBe(false);
    expect(mocks.db.select).toHaveBeenCalledTimes(4);
  });

  it("caps explicit customer timeline limits at the maximum window", async () => {
    const fiftyOneDocuments = Array.from({ length: 51 }, (_, index) => ({
      ...billingDocumentRow({
        id: 200 + index,
        documentNumber: `FIN-${200 + index}`,
      }),
      unitId: 7,
      unitName: "Matriz",
    }));
    useDbResults(
      [{ id: 10, name: "Cliente A" }],
      fiftyOneDocuments,
      [],
      [
        {
          totalDocuments: 51,
          openCents: 0,
          overdueCents: 0,
          receivedCents: 0,
        },
      ],
    );

    const result = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: unitScope,
      customerId: 10,
      includeProviderEvidence: false,
      limit: 200,
    });

    expect(result?.summary).toMatchObject({
      documents: 50,
      totalDocuments: 51,
      limit: 50,
      isTruncated: true,
    });
    expect(result?.data).toHaveLength(50);
  });

  it("keeps customer timelines unit-scoped while still resolving the org-level customer", async () => {
    useDbResults([{ id: 10, name: "Cliente A" }], [], [], []);

    const result = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: {
        ...unitScope,
        activeUnitName: "Matriz",
      },
      customerId: 10,
      includeProviderEvidence: false,
    });

    expect(result).toMatchObject({
      customerId: 10,
      freshness: { status: "local_only", label: "Status local" },
      summary: {
        scopeLabel: "Unidade Matriz",
        documents: 0,
        totalDocuments: 0,
        openCents: 0,
        overdueCents: 0,
      },
      data: [],
    });
    expect(mocks.buildUnitScopeCondition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        selectedUnitScope: "unit",
        activeUnitName: "Matriz",
      }),
    );
  });

  it("does not duplicate a customer-name fiscal fallback onto timeline documents", async () => {
    useDbResults(
      [{ id: 10, name: "Cliente A" }],
      [
        {
          ...billingDocumentRow(),
          unitId: 7,
          unitName: "Matriz",
        },
        {
          ...billingDocumentRow({
            id: 51,
            documentNumber: "FIN-51",
            totalCents: 90_00,
          }),
          unitId: 7,
          unitName: "Matriz",
        },
      ],
      [],
      [{ id: "integration-1", provider: "conta_azul", status: "ACTIVE" }],
      [
        {
          integrationId: "integration-1",
          lastSuccessfulPollAt: new Date("2100-01-01T00:00:00.000Z"),
        },
      ],
      [],
    );

    const result = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: unitScope,
      customerId: 10,
      includeProviderEvidence: true,
    });

    expect(result?.data).toHaveLength(2);
    expect(result?.data[0]?.fiscalDocuments).toEqual([]);
    expect(result?.data[1]?.fiscalDocuments).toEqual([]);
    expect(result?.data[0]?.providerEvidence).toBeNull();
  });

  it("marks stale customer-timeline provider evidence as needing an update", async () => {
    useDbResults(
      [{ id: 10, name: "Cliente A" }],
      [
        {
          ...billingDocumentRow(),
          unitId: 7,
          unitName: "Matriz",
        },
      ],
      [
        {
          id: 70,
          documentId: 50,
          installmentNumber: 1,
          status: "OPEN",
          amountCents: 120_00,
          currency: "BRL",
          dueDate: new Date("2026-06-20T00:00:00.000Z"),
          paidAt: null,
          paymentMethod: null,
        },
      ],
      [],
      [
        { id: "integration-old", provider: "conta_azul", status: "DISABLED" },
        { id: "integration-1", provider: "conta_azul", status: "ACTIVE" },
      ],
      [
        {
          integrationId: "integration-old",
          lastSuccessfulPollAt: new Date("2100-01-01T00:00:00.000Z"),
        },
        {
          integrationId: "integration-1",
          lastSuccessfulPollAt: new Date("2000-01-01T00:00:00.000Z"),
        },
      ],
      [
        {
          target: "billing_document",
          localEntityId: "billing_document:50",
          remoteEntityId: "sale-50",
          metadata: null,
          lastSyncedAt: new Date("2000-01-01T00:00:00.000Z"),
        },
      ],
    );

    const result = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: unitScope,
      customerId: 10,
      includeProviderEvidence: true,
    });

    expect(result?.data[0]).toMatchObject({
      continuityStatus: "STATUS_UNAVAILABLE",
      label: "Status indisponível",
      freshness: { status: "stale" },
      providerEvidence: { label: "Conta Azul sem atualização recente" },
    });
  });

  it("keeps entitled customer timeline local-only when no financial provider is configured", async () => {
    useDbResults(
      [{ id: 10, name: "Cliente A" }],
      [
        {
          ...billingDocumentRow(),
          unitId: 7,
          unitName: "Matriz",
        },
      ],
      [
        {
          id: 70,
          documentId: 50,
          installmentNumber: 1,
          status: "PAID",
          amountCents: 120_00,
          currency: "BRL",
          dueDate: new Date("2026-06-20T00:00:00.000Z"),
          paidAt: new Date("2026-06-19T00:00:00.000Z"),
          paymentMethod: "PIX",
        },
      ],
      [],
      [],
    );

    const result = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: unitScope,
      customerId: 10,
      includeProviderEvidence: true,
    });

    expect(result?.data[0]).toMatchObject({
      continuityStatus: "PAID",
      label: "Pago",
      freshness: { status: "local_only", label: "Status local" },
      providerEvidence: null,
    });
  });

  it("ignores disabled provider cursors when no financial provider is active", async () => {
    useDbResults(
      [{ id: 10, name: "Cliente A" }],
      [
        {
          ...billingDocumentRow(),
          unitId: 7,
          unitName: "Matriz",
        },
      ],
      [
        {
          id: 70,
          documentId: 50,
          installmentNumber: 1,
          status: "OPEN",
          amountCents: 120_00,
          currency: "BRL",
          dueDate: new Date("2026-06-20T00:00:00.000Z"),
          paidAt: null,
          paymentMethod: null,
        },
      ],
      [],
      [{ id: "integration-old", provider: "conta_azul", status: "DISABLED" }],
    );

    const result = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: unitScope,
      customerId: 10,
      includeProviderEvidence: true,
    });

    expect(result?.freshness).toMatchObject({
      status: "local_only",
      label: "Status local",
    });
    expect(result?.data[0]).toMatchObject({
      continuityStatus: "AWAITING_PAYMENT",
      freshness: { status: "local_only" },
      providerEvidence: null,
    });
  });

  it("attaches fiscal evidence only to the document with an exact remote sale match", async () => {
    useDbResults(
      [{ id: 10, name: "Cliente A" }],
      [
        {
          ...billingDocumentRow(),
          unitId: 7,
          unitName: "Matriz",
        },
        {
          ...billingDocumentRow({
            id: 51,
            documentNumber: "FIN-51",
            totalCents: 90_00,
          }),
          unitId: 7,
          unitName: "Matriz",
        },
      ],
      [],
      [{ id: "integration-1", provider: "conta_azul", status: "ACTIVE" }],
      [
        {
          integrationId: "integration-1",
          lastSuccessfulPollAt: new Date("2100-01-01T00:00:00.000Z"),
        },
      ],
      [
        {
          target: "billing_document",
          localEntityId: "billing_document:50",
          remoteEntityId: "sale-50",
          metadata: null,
          lastSyncedAt: new Date("2100-01-01T00:00:00.000Z"),
        },
      ],
      [
        {
          target: "fiscal_document",
          localEntityId: "remote:fiscal-1",
          remoteEntityId: "fiscal-1",
          metadata: {
            fiscal: {
              saleRemoteId: "sale-50",
              customerName: "Cliente A",
              number: "NF-1",
              issuedAt: "2026-05-21T00:00:00.000Z",
              accessKey: "access-key-1",
              xmlAvailable: true,
              consultationOnly: true,
            },
          },
          lastSyncedAt: new Date("2100-01-01T00:00:00.000Z"),
        },
      ],
    );

    const result = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: unitScope,
      customerId: 10,
      includeProviderEvidence: true,
    });

    expect(result?.data[0]?.fiscalDocuments).toEqual([
      expect.objectContaining({
        availability: "AVAILABLE",
        number: "NF-1",
      }),
    ]);
    expect(result?.data[1]?.fiscalDocuments).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(
      /pessoa|cobrança|baixa|saleRemoteId|contractRemoteId|providerStatus/,
    );
    const fiscalLinkWhere = mocks.state.whereCalls
      .map(renderSqlCondition)
      .find((condition) => condition.includes("[target] = {fiscal_document}"));
    expect(fiscalLinkWhere).toContain("[integration_id] = {integration-1}");
    expect(fiscalLinkWhere).not.toContain("[integration_id] in ");
  });

  it("marks fiscal evidence with warnings when provider freshness is unknown", async () => {
    useDbResults(
      [{ id: 10, name: "Cliente A" }],
      [
        {
          ...billingDocumentRow(),
          unitId: 7,
          unitName: "Matriz",
        },
      ],
      [],
      [{ id: "integration-1", provider: "conta_azul", status: "ACTIVE" }],
      [{ integrationId: "integration-1", lastSuccessfulPollAt: null }],
      [
        {
          target: "billing_document",
          localEntityId: "billing_document:50",
          remoteEntityId: "sale-50",
          metadata: null,
          lastSyncedAt: null,
        },
      ],
      [
        {
          target: "fiscal_document",
          localEntityId: "remote:fiscal-1",
          remoteEntityId: "fiscal-1",
          metadata: {
            fiscal: {
              saleRemoteId: "sale-50",
              number: "NF-1",
              issuedAt: "2026-05-21T00:00:00.000Z",
              accessKey: "access-key-1",
              xmlAvailable: true,
              consultationOnly: true,
            },
          },
          lastSyncedAt: null,
        },
      ],
    );

    const result = await buildCustomerFinancialTimeline({
      organizationId: "org-1",
      scope: unitScope,
      customerId: 10,
      includeProviderEvidence: true,
    });

    expect(result?.freshness).toMatchObject({ status: "unknown" });
    expect(result?.data[0]?.fiscalDocuments).toEqual([
      expect.objectContaining({
        availability: "WARNINGS",
        number: "NF-1",
      }),
    ]);
  });
});
