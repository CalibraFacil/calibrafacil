import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono, type Context, type Next } from "hono";
import { portalServiceOrdersRouter } from "../service-orders";

const mocks = vi.hoisted(() => ({
  getPortalCustomerForAuthOrganization: vi.fn(),
  getServiceOrderDetail: vi.fn(),
  buildPortalServiceOrderFinancialSummary: vi.fn(),
  r2Client: { send: vi.fn() },
  createR2Client: vi.fn(),
  generatePresignedUrl: vi.fn(),
}));

vi.mock("../../middleware/permission", () => {
  const requirePortalSession = async (c: Context, next: Next) => {
    if (c.req.header("x-portal-session") !== "ok") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set(
      "authSource",
      c.req.header("x-auth-source") === "lab" ? "lab" : "portal",
    );
    c.set("session", {
      user: { id: "portal-user-1" },
      session: { activeOrganizationId: "client-org-1" },
    });
    await next();
  };

  const requirePortalOrganization = async (c: Context, next: Next) => {
    c.set("member", {
      id: "member-1",
      role: "client_user",
      organizationId: "client-org-1",
      organizationType: "CLIENT",
      userId: "portal-user-1",
      activeUnitId: null,
      activeUnitName: null,
      accessibleUnitIds: [],
      accessibleUnits: [],
      selectedUnitScope: "unit",
      canAccessAllUnits: false,
      unitRole: null,
    });
    await next();
  };

  return {
    requirePortalProtected: [
      requirePortalSession,
      requirePortalOrganization,
      async (_c: Context, next: Next) => next(),
    ],
    requirePermission: () => async (_c: Context, next: Next) => next(),
    withLabPermission: () => [async (_c: Context, next: Next) => next()],
  };
});

vi.mock("../../modules/service-orders/service-order.list-queries", () => ({
  getPortalCustomerForAuthOrganization:
    mocks.getPortalCustomerForAuthOrganization,
  getServiceOrderSummaryReport: vi.fn(),
  listServiceOrdersForLab: vi.fn(),
  listServiceOrdersForPortalCustomer: vi.fn(),
}));

vi.mock("../../modules/service-orders/service-order.read-model", () => ({
  getServiceOrderDetail: mocks.getServiceOrderDetail,
  toClientVisibleServiceOrderDetail: vi.fn(),
}));

vi.mock("../../lib/portal-financial-summary", () => ({
  buildPortalServiceOrderFinancialSummary:
    mocks.buildPortalServiceOrderFinancialSummary,
}));

vi.mock("../../lib/storage", () => ({
  createR2Client: mocks.createR2Client,
  generatePresignedUrl: mocks.generatePresignedUrl,
}));

function createTestApp() {
  return new Hono().route(
    "/api/portal/service-orders",
    portalServiceOrdersRouter,
  );
}

const visibleSummary = {
  state: "PAYMENT_PENDING",
  visible: true,
  dueDate: "2026-06-10T00:00:00.000Z",
  paidAt: null,
  openAmountCents: 10000,
  overdueAmountCents: 0,
  lastUpdatedAt: "2026-05-02T12:00:00.000Z",
  freshness: "fresh",
  documents: [
    {
      kind: "invoice",
      label: "Fatura",
      availableAt: "2026-05-01T12:00:00.000Z",
      href: null,
    },
  ],
};

describe("portal service-order financial summary route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPortalCustomerForAuthOrganization.mockResolvedValue({
      id: 10,
      labOrganizationId: "lab-org-1",
    });
    mocks.getServiceOrderDetail.mockResolvedValue({
      id: 42,
      customerId: 10,
      unitId: 7,
    });
    mocks.buildPortalServiceOrderFinancialSummary.mockResolvedValue(
      visibleSummary,
    );
    mocks.createR2Client.mockReturnValue(mocks.r2Client);
    mocks.generatePresignedUrl.mockResolvedValue(
      "https://downloads.example.test/finance%2Finvoice-7.pdf",
    );
  });

  it("rejects requests without a portal session", async () => {
    const response = await createTestApp().request(
      "/api/portal/service-orders/42/financial-summary",
    );

    expect(response.status).toBe(401);
    expect(
      mocks.buildPortalServiceOrderFinancialSummary,
    ).not.toHaveBeenCalled();
  });

  it("returns the customer-safe summary for the linked portal customer", async () => {
    const response = await createTestApp().request(
      "/api/portal/service-orders/42/financial-summary",
      { headers: { "x-portal-session": "ok" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: visibleSummary });
    expect(mocks.getPortalCustomerForAuthOrganization).toHaveBeenCalledWith(
      "client-org-1",
    );
    expect(mocks.buildPortalServiceOrderFinancialSummary).toHaveBeenCalledWith({
      organizationId: "lab-org-1",
      serviceOrderId: 42,
      scope: {
        activeUnitId: 7,
        accessibleUnitIds: [7],
        selectedUnitScope: "unit",
      },
      documentHrefSigner: expect.any(Function),
    });
  });

  it("passes a signer that delegates to the portal R2 presigned URL helper", async () => {
    mocks.buildPortalServiceOrderFinancialSummary.mockImplementationOnce(
      async (params) => ({
        ...visibleSummary,
        documents: [
          {
            kind: "invoice",
            label: "Fatura",
            availableAt: "2026-05-01T12:00:00.000Z",
            href: await params.documentHrefSigner("finance/invoice-7.pdf"),
          },
        ],
      }),
    );

    const response = await createTestApp().request(
      "/api/portal/service-orders/42/financial-summary",
      { headers: { "x-portal-session": "ok" } },
      { R2_BUCKET_NAME: "portal-documents" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        ...visibleSummary,
        documents: [
          {
            kind: "invoice",
            label: "Fatura",
            availableAt: "2026-05-01T12:00:00.000Z",
            href: "https://downloads.example.test/finance%2Finvoice-7.pdf",
          },
        ],
      },
    });
    expect(mocks.createR2Client).toHaveBeenCalledTimes(1);
    expect(mocks.generatePresignedUrl).toHaveBeenCalledWith(
      mocks.r2Client,
      "portal-documents",
      "finance/invoice-7.pdf",
    );
  });

  it("returns 404 for a service order linked to another customer", async () => {
    mocks.getServiceOrderDetail.mockResolvedValue({
      id: 42,
      customerId: 99,
      unitId: 7,
    });

    const response = await createTestApp().request(
      "/api/portal/service-orders/42/financial-summary",
      { headers: { "x-portal-session": "ok" } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "OS nao encontrada",
    });
    expect(
      mocks.buildPortalServiceOrderFinancialSummary,
    ).not.toHaveBeenCalled();
  });

  it("returns 404 if the protected chain did not mark the request as portal auth", async () => {
    const response = await createTestApp().request(
      "/api/portal/service-orders/42/financial-summary",
      { headers: { "x-portal-session": "ok", "x-auth-source": "lab" } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "OS nao encontrada",
    });
    expect(mocks.getPortalCustomerForAuthOrganization).not.toHaveBeenCalled();
    expect(
      mocks.buildPortalServiceOrderFinancialSummary,
    ).not.toHaveBeenCalled();
  });

  it("returns visible false when the financial provider is not configured", async () => {
    const hiddenSummary = {
      ...visibleSummary,
      state: null,
      visible: false,
      dueDate: null,
      openAmountCents: 0,
      documents: [],
      freshness: "unknown",
    };
    mocks.buildPortalServiceOrderFinancialSummary.mockResolvedValue(
      hiddenSummary,
    );

    const response = await createTestApp().request(
      "/api/portal/service-orders/42/financial-summary",
      { headers: { "x-portal-session": "ok" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: hiddenSummary });
  });

  it("returns 404 for malformed service orders without a unit", async () => {
    mocks.getServiceOrderDetail.mockResolvedValue({
      id: 42,
      customerId: 10,
      unitId: null,
    });

    const response = await createTestApp().request(
      "/api/portal/service-orders/42/financial-summary",
      { headers: { "x-portal-session": "ok" } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "OS nao encontrada",
    });
    expect(
      mocks.buildPortalServiceOrderFinancialSummary,
    ).not.toHaveBeenCalled();
  });

  it("does not leak provider or ERP wording in the response", async () => {
    const response = await createTestApp().request(
      "/api/portal/service-orders/42/financial-summary",
      { headers: { "x-portal-session": "ok" } },
    );

    const body = await response.text();
    // This route returns the already-sanitized DTO. Provider stripping is
    // covered directly in the portal-financial-summary lib tests.
    expect(body).not.toContain("Conta Azul");
    expect(body).not.toContain("ERP");
    expect(body).not.toContain("saleRemoteId");
    expect(body).not.toContain("pessoa");
    expect(body).not.toContain("cobrança");
    expect(body).not.toContain("baixa");
    expect(body).not.toContain("NF-e");
    expect(body).not.toContain("NFS-e");
    expect(body).not.toContain("https://api.contaazul");
  });
});
