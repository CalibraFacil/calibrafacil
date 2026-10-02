import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { financeTimelineRouter } from "../finance/timeline";
import type { AuthVariables } from "../../middleware/permission";

const mocks = vi.hoisted(() => ({
  buildCustomerFinancialTimeline: vi.fn(),
  buildServiceOrderFinancialStatus: vi.fn(),
  resolveCustomerRouteId: vi.fn(),
  passMiddleware: vi.fn(async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock("../../lib/financial-timeline", () => ({
  buildCustomerFinancialTimeline: mocks.buildCustomerFinancialTimeline,
  buildServiceOrderFinancialStatus: mocks.buildServiceOrderFinancialStatus,
}));

vi.mock("../../lib/customer-route-id", () => ({
  resolveCustomerRouteId: mocks.resolveCustomerRouteId,
}));

vi.mock("../../middleware/permission", () => ({
  withLabPermission: () => [mocks.passMiddleware],
}));

function createTestApp() {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.use("*", async (c, next) => {
    c.set("member", {
      id: "member-1",
      role: "admin",
      organizationId: "org-1",
      organizationType: "LAB",
      userId: "user-1",
      activeUnitId: 7,
      activeUnitName: "Matriz",
      accessibleUnitIds: [7],
      accessibleUnits: [],
      selectedUnitScope: "unit",
      canAccessAllUnits: false,
      unitRole: "unit_admin",
    });
    await next();
  });
  app.route("/api/finance", financeTimelineRouter);

  return app;
}

describe("finance timeline routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCustomerRouteId.mockImplementation(
      async (identifier: string) =>
        /^\d+$/.test(identifier) ? Number(identifier) : null,
    );
  });

  it("returns service-order financial status with integration evidence when entitled", async () => {
    mocks.buildServiceOrderFinancialStatus.mockResolvedValue({
      serviceOrderId: 42,
      label: "Pago",
      fiscalDocument: {
        availability: "AVAILABLE",
        label: "Documento fiscal disponível",
        number: "NF-1",
        issuedAt: "2026-05-21T00:00:00.000Z",
        accessKey: "access-key-1",
        xmlAvailable: true,
        consultationOnly: true,
        lastSyncedAt: "2026-05-21T00:00:00.000Z",
      },
      providerEvidence: {
        label: "Sincronizado via Conta Azul",
        integrationState: "connected",
        reconnectPath: null,
      },
    });

    const response = await createTestApp().request(
      "/api/finance/service-orders/42/status",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      data: {
        serviceOrderId: 42,
        label: "Pago",
        fiscalDocument: {
          availability: "AVAILABLE",
          label: "Documento fiscal disponível",
          number: "NF-1",
          issuedAt: "2026-05-21T00:00:00.000Z",
          accessKey: "access-key-1",
          xmlAvailable: true,
          consultationOnly: true,
          lastSyncedAt: "2026-05-21T00:00:00.000Z",
        },
        providerEvidence: {
          label: "Sincronizado via Conta Azul",
          integrationState: "connected",
          reconnectPath: null,
        },
      },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /pessoa|cobrança|baixa|saleRemoteId|contractRemoteId|providerStatus/,
    );
    expect(mocks.buildServiceOrderFinancialStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        serviceOrderId: 42,
        includeProviderEvidence: true,
      }),
    );
  });

  it("resolves digit-prefixed customer route slugs before building the timeline", async () => {
    mocks.resolveCustomerRouteId.mockResolvedValue(17);
    mocks.buildCustomerFinancialTimeline.mockResolvedValue({
      customerId: 17,
      freshness: {
        status: "fresh",
        lastSyncedAt: "2026-05-20T00:00:00.000Z",
        label: "Sincronizado",
      },
      summary: {
        scope: "recent_documents",
        scopeLabel: "Unidade Matriz",
        limit: 20,
        isTruncated: false,
        documents: 0,
        totalDocuments: 0,
        openCents: 0,
        overdueCents: 0,
        receivedCents: 0,
      },
      data: [],
    });

    const response = await createTestApp().request(
      "/api/finance/customers/5-cliente-a/timeline",
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveCustomerRouteId).toHaveBeenCalledWith(
      "5-cliente-a",
      "org-1",
    );
    expect(mocks.buildCustomerFinancialTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 17,
        includeProviderEvidence: true,
      }),
    );
  });

  it("returns 404 when the service order is not visible in scope", async () => {
    mocks.buildServiceOrderFinancialStatus.mockResolvedValue(null);

    const response = await createTestApp().request(
      "/api/finance/service-orders/42/status",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Ordem de serviço não encontrada",
    });
  });

  it("returns 404 when the customer is not visible in scope", async () => {
    mocks.buildCustomerFinancialTimeline.mockResolvedValue(null);

    const response = await createTestApp().request(
      "/api/finance/customers/5/timeline",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Cliente não encontrado",
    });
  });

  it("returns 404 when a customer route slug is not visible in scope", async () => {
    mocks.resolveCustomerRouteId.mockResolvedValue(null);

    const response = await createTestApp().request(
      "/api/finance/customers/cliente-fora/timeline",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Cliente não encontrado",
    });
    expect(mocks.buildCustomerFinancialTimeline).not.toHaveBeenCalled();
  });

  it("rejects invalid route identifiers", async () => {
    const response = await createTestApp().request(
      "/api/finance/service-orders/42abc/status",
    );

    expect(response.status).toBe(400);
    expect(mocks.buildServiceOrderFinancialStatus).not.toHaveBeenCalled();
  });

  it("rejects loosely parsed customer timeline limits", async () => {
    const response = await createTestApp().request(
      "/api/finance/customers/5/timeline?limit=30bad",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Limite inválido",
    });
    expect(mocks.buildCustomerFinancialTimeline).not.toHaveBeenCalled();
  });

  it("clamps customer timeline limits before building the read model", async () => {
    mocks.buildCustomerFinancialTimeline.mockResolvedValue({
      customerId: 5,
      freshness: {
        status: "fresh",
        lastSyncedAt: "2026-05-20T00:00:00.000Z",
        label: "Sincronizado",
      },
      summary: {
        scope: "recent_documents",
        scopeLabel: "Unidade Matriz",
        limit: 50,
        isTruncated: false,
        documents: 0,
        totalDocuments: 0,
        openCents: 0,
        overdueCents: 0,
        receivedCents: 0,
      },
      data: [],
    });

    const response = await createTestApp().request(
      "/api/finance/customers/5/timeline?limit=200",
    );

    expect(response.status).toBe(200);
    expect(mocks.buildCustomerFinancialTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 5,
        limit: 50,
        includeProviderEvidence: true,
      }),
    );
  });

  it("returns a provider-neutral customer timeline envelope", async () => {
    mocks.buildCustomerFinancialTimeline.mockResolvedValue({
      customerId: 5,
      freshness: {
        status: "fresh",
        lastSyncedAt: "2026-05-20T00:00:00.000Z",
        label: "Sincronizado",
      },
      summary: {
        scope: "recent_documents",
        scopeLabel: "Unidade Matriz",
        limit: 20,
        isTruncated: false,
        documents: 1,
        totalDocuments: 1,
        openCents: 0,
        overdueCents: 0,
        receivedCents: 120_00,
      },
      data: [
        {
          id: 50,
          documentNumber: "FIN-50",
          status: "PAID",
          exportStatus: "EXPORTED",
          continuityStatus: "PAID",
          label: "Pago",
          issueDate: "2026-05-20T00:00:00.000Z",
          dueDate: "2026-06-20T00:00:00.000Z",
          totalCents: 120_00,
          currency: "BRL",
          unit: { id: 7, name: "Matriz" },
          installments: [],
          receipts: [],
          fiscalDocuments: [
            {
              availability: "AVAILABLE",
              label: "Documento fiscal disponível",
              number: "NF-1",
              issuedAt: "2026-05-21T00:00:00.000Z",
              accessKey: "access-key-1",
              xmlAvailable: true,
              consultationOnly: true,
              lastSyncedAt: "2026-05-21T00:00:00.000Z",
            },
          ],
          freshness: {
            status: "fresh",
            lastSyncedAt: "2026-05-21T00:00:00.000Z",
            label: "Sincronizado",
          },
          providerEvidence: null,
        },
      ],
    });

    const response = await createTestApp().request(
      "/api/finance/customers/5/timeline",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(
      /pessoa|cobrança|baixa|saleRemoteId|contractRemoteId|providerStatus/,
    );
  });
});
