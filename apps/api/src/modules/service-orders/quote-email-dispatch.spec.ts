/**
 * Unit tests for quote-email-dispatch.ts — the thin wiring helpers that
 * bridge the four quote-action commands to sendServiceOrderEmailOnce +
 * dispatchOrcamento{Aprovado,Recusado}Email.
 *
 * Layer 1 of 2: isolation tests — mock both `./service-order-email-once` and
 * the underlying dispatch helpers. Assert correct eventKey, correct dispatch
 * callback mapping, and best-effort (no throw on failure).
 *
 * These tests FAIL if any of the four extracted functions is deleted or if the
 * wrong eventKey / args are passed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that use them.
// ---------------------------------------------------------------------------

const {
  mockSendServiceOrderEmailOnce,
  mockDispatchOrcamentoAprovadoEmail,
  mockDispatchOrcamentoRecusadoEmail,
  mockDbSelect,
} = vi.hoisted(() => ({
  mockSendServiceOrderEmailOnce: vi.fn().mockResolvedValue(undefined),
  mockDispatchOrcamentoAprovadoEmail: vi.fn().mockResolvedValue({ sent: true }),
  mockDispatchOrcamentoRecusadoEmail: vi.fn().mockResolvedValue({ sent: true }),
  // DB mock: returns a customer row by default
  mockDbSelect: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi
          .fn()
          .mockResolvedValue([
            { name: "Empresa Teste SA", email: "empresa@example.com" },
          ]),
      }),
    }),
  }),
}));

vi.mock("./service-order-email-once", () => ({
  sendServiceOrderEmailOnce: mockSendServiceOrderEmailOnce,
}));

vi.mock("./orcamento-aprovado-email-dispatch", () => ({
  dispatchOrcamentoAprovadoEmail: mockDispatchOrcamentoAprovadoEmail,
}));

vi.mock("./orcamento-recusado-email-dispatch", () => ({
  dispatchOrcamentoRecusadoEmail: mockDispatchOrcamentoRecusadoEmail,
}));

vi.mock("@calibra-facil/db", () => ({
  db: {
    select: mockDbSelect,
  },
}));

// Mock drizzle-orm operators (used in WHERE clauses)
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

// Mock db schema (just placeholders — the mock db ignores them)
vi.mock("@calibra-facil/db/schema", () => ({
  customer: {
    name: "customer.name",
    email: "customer.email",
    labOrganizationId: "customer.labOrganizationId",
    id: "customer.id",
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  dispatchApprovedQuoteEmailOnce,
  dispatchApprovedQuoteEmailOncePortal,
  dispatchRejectedQuoteEmailOnce,
  dispatchRejectedQuoteEmailOncePortal,
} from "./quote-email-dispatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_ORDER = {
  organizationId: "org-1",
  serviceOrderNumber: "OS-2026-042",
  publicId: "pub-abc-123",
  customerId: 101,
  clientContactSnapshot: { email: "cliente@example.com" } satisfies Record<
    string,
    unknown
  >,
} satisfies import("./quote-email-dispatch").QuoteEmailOrderContext;

/** Flush microtasks so the void(async()) iife completes */
async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// dispatchApprovedQuoteEmailOnce (manual path)
// ---------------------------------------------------------------------------

describe("dispatchApprovedQuoteEmailOnce (manual path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi
            .fn()
            .mockResolvedValue([
              { name: "Empresa Teste SA", email: "empresa@example.com" },
            ]),
        }),
      }),
    });
    mockSendServiceOrderEmailOnce.mockResolvedValue(undefined);
    mockDispatchOrcamentoAprovadoEmail.mockResolvedValue({ sent: true });
  });

  it("calls sendServiceOrderEmailOnce with eventKey orcamento_approved:<quoteId>", async () => {
    dispatchApprovedQuoteEmailOnce({
      serviceOrderId: 1,
      quoteId: 42,
      totalApprovedCents: 146000,
      order: BASE_ORDER,
    });
    await flushAsync();
    expect(mockSendServiceOrderEmailOnce).toHaveBeenCalledTimes(1);
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    expect(call?.eventKey).toBe("orcamento_approved:42");
    expect(call?.serviceOrderId).toBe(1);
  });

  it("dispatch callback calls dispatchOrcamentoAprovadoEmail with totalApprovedCents", async () => {
    dispatchApprovedQuoteEmailOnce({
      serviceOrderId: 1,
      quoteId: 42,
      totalApprovedCents: 146000,
      order: BASE_ORDER,
    });
    await flushAsync();
    // Invoke the dispatch callback captured by sendServiceOrderEmailOnce
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    await call.dispatch();
    expect(mockDispatchOrcamentoAprovadoEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        totalApprovedCents: 146000,
        serviceOrderId: 1,
        quoteId: 42,
        serviceOrderNumber: "OS-2026-042",
        organizationId: "org-1",
      }),
    );
  });

  it("dispatch callback maps customer name/email from DB lookup", async () => {
    dispatchApprovedQuoteEmailOnce({
      serviceOrderId: 1,
      quoteId: 42,
      totalApprovedCents: 5000,
      order: BASE_ORDER,
    });
    await flushAsync();
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    await call.dispatch();
    expect(mockDispatchOrcamentoAprovadoEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: "Empresa Teste SA",
        customerEmail: "empresa@example.com",
      }),
    );
  });

  it("falls back to empty string customerName when DB returns no row", async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    dispatchApprovedQuoteEmailOnce({
      serviceOrderId: 1,
      quoteId: 42,
      totalApprovedCents: 5000,
      order: BASE_ORDER,
    });
    await flushAsync();
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    await call.dispatch();
    expect(mockDispatchOrcamentoAprovadoEmail).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: "", customerEmail: null }),
    );
  });

  it("is best-effort: a throwing sendServiceOrderEmailOnce does not propagate", async () => {
    mockSendServiceOrderEmailOnce.mockRejectedValueOnce(new Error("DB crash"));
    // Should not throw — the void(async)() swallows
    expect(() => {
      dispatchApprovedQuoteEmailOnce({
        serviceOrderId: 1,
        quoteId: 99,
        totalApprovedCents: 0,
        order: BASE_ORDER,
      });
    }).not.toThrow();
    // Waiting for async: no unhandled rejection
    await flushAsync();
  });
});

// ---------------------------------------------------------------------------
// dispatchApprovedQuoteEmailOncePortal (portal path)
// ---------------------------------------------------------------------------

describe("dispatchApprovedQuoteEmailOncePortal (portal path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendServiceOrderEmailOnce.mockResolvedValue(undefined);
    mockDispatchOrcamentoAprovadoEmail.mockResolvedValue({ sent: true });
  });

  it("calls sendServiceOrderEmailOnce with eventKey orcamento_approved:<quoteId>", async () => {
    dispatchApprovedQuoteEmailOncePortal({
      serviceOrderId: 5,
      quoteId: 77,
      totalApprovedCents: 25000,
      order: BASE_ORDER,
      customerName: "Portal Cliente SA",
      customerEmail: "portal@cliente.com",
    });
    await flushAsync();
    expect(mockSendServiceOrderEmailOnce).toHaveBeenCalledTimes(1);
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    expect(call?.eventKey).toBe("orcamento_approved:77");
    expect(call?.serviceOrderId).toBe(5);
  });

  it("dispatch callback passes customerName/customerEmail from input (no DB lookup)", async () => {
    dispatchApprovedQuoteEmailOncePortal({
      serviceOrderId: 5,
      quoteId: 77,
      totalApprovedCents: 25000,
      order: BASE_ORDER,
      customerName: "Portal Cliente SA",
      customerEmail: "portal@cliente.com",
    });
    await flushAsync();
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    await call.dispatch();
    expect(mockDispatchOrcamentoAprovadoEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: "Portal Cliente SA",
        customerEmail: "portal@cliente.com",
        totalApprovedCents: 25000,
      }),
    );
    // No DB lookup for portal path
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dispatchRejectedQuoteEmailOnce (manual path)
// ---------------------------------------------------------------------------

describe("dispatchRejectedQuoteEmailOnce (manual path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi
            .fn()
            .mockResolvedValue([
              { name: "Empresa Teste SA", email: "empresa@example.com" },
            ]),
        }),
      }),
    });
    mockSendServiceOrderEmailOnce.mockResolvedValue(undefined);
    mockDispatchOrcamentoRecusadoEmail.mockResolvedValue({ sent: true });
  });

  it("calls sendServiceOrderEmailOnce with eventKey orcamento_rejected:<quoteId>", async () => {
    dispatchRejectedQuoteEmailOnce({
      serviceOrderId: 2,
      quoteId: 55,
      rejectionReason: "Preço elevado",
      order: BASE_ORDER,
    });
    await flushAsync();
    expect(mockSendServiceOrderEmailOnce).toHaveBeenCalledTimes(1);
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    expect(call?.eventKey).toBe("orcamento_rejected:55");
    expect(call?.serviceOrderId).toBe(2);
  });

  it("dispatch callback passes rejectionReason when present", async () => {
    dispatchRejectedQuoteEmailOnce({
      serviceOrderId: 2,
      quoteId: 55,
      rejectionReason: "Preço elevado",
      order: BASE_ORDER,
    });
    await flushAsync();
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    await call.dispatch();
    expect(mockDispatchOrcamentoRecusadoEmail).toHaveBeenCalledWith(
      expect.objectContaining({ rejectionReason: "Preço elevado" }),
    );
  });

  it("dispatch callback passes null rejectionReason when absent", async () => {
    dispatchRejectedQuoteEmailOnce({
      serviceOrderId: 2,
      quoteId: 55,
      rejectionReason: null,
      order: BASE_ORDER,
    });
    await flushAsync();
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    await call.dispatch();
    expect(mockDispatchOrcamentoRecusadoEmail).toHaveBeenCalledWith(
      expect.objectContaining({ rejectionReason: null }),
    );
  });

  it("dispatch callback maps customer name/email from DB lookup", async () => {
    dispatchRejectedQuoteEmailOnce({
      serviceOrderId: 2,
      quoteId: 55,
      rejectionReason: null,
      order: BASE_ORDER,
    });
    await flushAsync();
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    await call.dispatch();
    expect(mockDispatchOrcamentoRecusadoEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: "Empresa Teste SA",
        customerEmail: "empresa@example.com",
      }),
    );
  });

  it("is best-effort: a throwing sendServiceOrderEmailOnce does not propagate", async () => {
    mockSendServiceOrderEmailOnce.mockRejectedValueOnce(new Error("crash"));
    expect(() => {
      dispatchRejectedQuoteEmailOnce({
        serviceOrderId: 2,
        quoteId: 55,
        rejectionReason: null,
        order: BASE_ORDER,
      });
    }).not.toThrow();
    await flushAsync();
  });
});

// ---------------------------------------------------------------------------
// dispatchRejectedQuoteEmailOncePortal (portal path)
// ---------------------------------------------------------------------------

describe("dispatchRejectedQuoteEmailOncePortal (portal path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendServiceOrderEmailOnce.mockResolvedValue(undefined);
    mockDispatchOrcamentoRecusadoEmail.mockResolvedValue({ sent: true });
  });

  it("calls sendServiceOrderEmailOnce with eventKey orcamento_rejected:<quoteId>", async () => {
    dispatchRejectedQuoteEmailOncePortal({
      serviceOrderId: 7,
      quoteId: 88,
      rejectionReason: null,
      order: BASE_ORDER,
      customerName: "Portal Recusa SA",
      customerEmail: "recusa@portal.com",
    });
    await flushAsync();
    expect(mockSendServiceOrderEmailOnce).toHaveBeenCalledTimes(1);
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    expect(call?.eventKey).toBe("orcamento_rejected:88");
  });

  it("dispatch callback passes customerName/customerEmail from input (no DB lookup)", async () => {
    dispatchRejectedQuoteEmailOncePortal({
      serviceOrderId: 7,
      quoteId: 88,
      rejectionReason: "Fora do orçamento previsto",
      order: BASE_ORDER,
      customerName: "Portal Recusa SA",
      customerEmail: "recusa@portal.com",
    });
    await flushAsync();
    const call = mockSendServiceOrderEmailOnce.mock.calls[0]?.[0];
    await call.dispatch();
    expect(mockDispatchOrcamentoRecusadoEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: "Portal Recusa SA",
        customerEmail: "recusa@portal.com",
        rejectionReason: "Fora do orçamento previsto",
      }),
    );
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});
