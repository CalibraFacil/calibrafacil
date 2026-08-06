/**
 * Command-level wiring tests — Layer 2 of 2. (Updated for mini-spec I Part 2)
 *
 * Verifies that EACH of the four quote-action commands calls
 * enqueueServiceOrderEmail (outbox enqueue) instead of the old fire-and-forget
 * dispatch helpers.
 *
 * EQUIVALENT-OR-STRONGER REPLACEMENT for the old assertions
 * (old: asserted dispatchApprovedQuoteEmailOnce / etc. are called):
 *
 *   OLD                                               NEW (stronger)
 *   ─────────────────────────────────────────         ─────────────────────────────────────────────────
 *   dispatchApprovedQuoteEmailOnce called             enqueueServiceOrderEmail called with
 *   with { serviceOrderId, quoteId,                   { eventKey: "quote_approved:<quoteId>",
 *     totalApprovedCents }                              payload: { serviceOrderId, quoteId, totalApprovedCents, ... } }
 *
 *   dispatchRejectedQuoteEmailOnce called             enqueueServiceOrderEmail called with
 *   with { serviceOrderId, quoteId,                   { eventKey: "quote_rejected:<quoteId>",
 *     rejectionReason }                                 payload: { serviceOrderId, quoteId, rejectionReason, ... } }
 *
 *   dispatchApprovedQuoteEmailOncePortal              enqueueServiceOrderEmail called with
 *   called with { serviceOrderId, quoteId,            { eventKey: "quote_approved:<quoteId>",
 *     totalApprovedCents, customerName,                payload: { ..., customerName, customerEmail, totalApprovedCents } }
 *     customerEmail }
 *
 *   dispatchRejectedQuoteEmailOncePortal              enqueueServiceOrderEmail called with
 *   called with { ..., rejectionReason,               { eventKey: "quote_rejected:<quoteId>",
 *     customerName, customerEmail }                    payload: { ..., rejectionReason, customerName, customerEmail } }
 *
 * The new assertions pin EVERY behavior the old tests pinned (right email type
 * triggered for right SO/quote, tenant-scoped, dedup key present) now at the
 * enqueue boundary — which is stronger because:
 *  1. The eventKey is checked exactly (wrong key → RED).
 *  2. The payload fields are checked (dropped field → RED).
 *  3. The old tests relied on best-effort fire-and-forget helpers that could be
 *     silently skipped on serverless; the new path is durably persisted.
 *
 * REQ-072 atomicity: the D commands pass tx to enqueueServiceOrderEmail.
 * Assertion: capturedTxExecutors[0] === mockTxProxy (not module db).
 *
 * Deleting or neutralizing the enqueue call in any command turns at least
 * one test here RED.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const dbQueue: Array<unknown[]> = [];

const { mockEnqueueServiceOrderEmail, capturedTxExecutors, mockTxProxy } =
  vi.hoisted(() => {
    const captured: Array<unknown> = [];
    const txProxy = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      select: vi.fn(),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi
            .fn()
            .mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
        }),
      }),
      delete: vi.fn(),
    };

    interface EnqueueParams {
      organizationId: string;
      unitId?: number | null;
      serviceOrderId: number;
      eventKey: string;
      targetStatus: string;
      payload: Record<string, unknown>;
    }

    const enqueue = vi.fn(
      async (_params: EnqueueParams, executor?: unknown) => {
        captured.push(executor);
      },
    );

    return {
      mockEnqueueServiceOrderEmail: enqueue,
      capturedTxExecutors: captured,
      mockTxProxy: txProxy,
    };
  });

// ---------------------------------------------------------------------------
// DB mock — FIFO queue + transaction
// ---------------------------------------------------------------------------

vi.mock("@calibra-facil/db", () => {
  function makeBuilder(): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    for (const method of ["from", "where", "innerJoin", "leftJoin"]) {
      b[method] = () => b;
    }
    b.select = () => b;
    b.orderBy = () => b;
    b.limit = async () => (dbQueue.length ? dbQueue.shift() : []);
    b.update = () => b;
    b.set = () => b;
    b.insert = () => b;
    b.values = () => b;
    b.onConflictDoNothing = () => b;
    b.returning = async () => (dbQueue.length ? dbQueue.shift() : []);
    b.delete = () => b;
    b.execute = async () => (dbQueue.length ? dbQueue.shift() : []);
    return b;
  }

  const builder = makeBuilder();

  return {
    db: {
      ...builder,
      select: () => builder,
      update: () => builder,
      insert: () => builder,
      delete: () => builder,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(mockTxProxy),
    },
  };
});

// ---------------------------------------------------------------------------
// Mock email-outbox-payloads (enqueueServiceOrderEmail)
// ---------------------------------------------------------------------------

vi.mock("./email-outbox-payloads", () => ({
  enqueueServiceOrderEmail: mockEnqueueServiceOrderEmail,
}));

// ---------------------------------------------------------------------------
// Mock other service-order deps
// ---------------------------------------------------------------------------

vi.mock("./service-order.queries", () => ({
  getQuoteForAction: vi.fn().mockResolvedValue({
    id: 42,
    serviceOrderId: 1,
    status: "sent",
    totalCents: 146000,
    subtotalServicesCents: 100000,
    subtotalPartsCents: 46000,
    freightCents: 0,
    discountCents: 0,
  }),
}));

vi.mock("./service-order.read-model", () => ({
  getServiceOrderDetail: vi.fn(),
}));

vi.mock("./service-order.documents", () => ({
  enqueueServiceOrderDocumentJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./service-order.list-queries", () => ({
  getPortalCustomerForAuthOrganization: vi.fn().mockResolvedValue({
    id: 101,
    name: "Portal Cliente SA",
    email: "portal@cliente.com",
    authOrganizationId: "auth-org-portal-1",
  }),
}));

vi.mock("./novo-orcamento-email-dispatch", () => ({
  dispatchNovoOrcamentoEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./service-order-email-once", () => ({
  sendServiceOrderEmailOnce: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/service-order-workflow", () => ({
  createPublicServiceOrderAccessToken: vi.fn().mockResolvedValue({
    token: "tok-123",
    tokenHash: "hash-123",
  }),
  recordServiceOrderEvent: vi.fn().mockResolvedValue(undefined),
  replaceQuoteItems: vi.fn().mockResolvedValue({
    subtotalServicesCents: 0,
    subtotalPartsCents: 0,
    discountCents: 0,
    freightCents: 0,
    totalCents: 0,
  }),
  // Token-lifecycle helpers (spec quote-approval-public-access) — not under
  // test here, but the quote commands call them.
  computeDefaultPublicTokenExpiry: vi
    .fn()
    .mockReturnValue(new Date("2026-08-08T00:00:00.000Z")),
  revokeActiveTokensForQuote: vi.fn().mockResolvedValue(undefined),
  revokeSupersededServiceOrderTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/units", () => ({
  buildUnitScopeCondition: vi.fn().mockReturnValue(undefined),
}));

vi.mock("@calibra-facil/shared", () => ({
  canApproveServiceOrderQuote: vi.fn().mockReturnValue(true),
  canEditServiceOrderQuote: vi.fn().mockReturnValue(false),
  isServiceOrderFinalStatus: vi.fn().mockReturnValue(false),
  // These specs cover the ordinary path: the order IS awaiting a decision, so
  // approving/rejecting still advances its status. (The mid-job and late-
  // decision cases are covered in packages/shared and the integration tier.)
  isServiceOrderDecidingQuoteStatus: vi.fn().mockReturnValue(true),
  isServiceOrderWorkInProgressStatus: vi.fn().mockReturnValue(false),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  desc: (col: unknown) => ({ desc: col }),
  or: (...args: unknown[]) => ({ or: args }),
}));

vi.mock("@calibra-facil/db/schema", () => ({
  serviceOrder: new Proxy({}, { get: (_, p) => ({ col: String(p) }) }),
  serviceOrderQuote: new Proxy({}, { get: (_, p) => ({ col: String(p) }) }),
  serviceOrderQuoteItem: new Proxy({}, { get: (_, p) => ({ col: String(p) }) }),
  serviceOrderAssetSnapshot: new Proxy(
    {},
    { get: (_, p) => ({ col: String(p) }) },
  ),
  customer: new Proxy({}, { get: (_, p) => ({ col: String(p) }) }),
}));

// ---------------------------------------------------------------------------
// Import commands after all mocks
// ---------------------------------------------------------------------------

import {
  approveServiceOrderQuoteManually,
  rejectServiceOrderQuoteManually,
  approveServiceOrderQuoteByPortalUser,
  rejectServiceOrderQuoteByPortalUser,
} from "./service-order.quotes";

// ---------------------------------------------------------------------------
// Shared fixture: a service order row that satisfies the commands
// ---------------------------------------------------------------------------

const SAMPLE_ORDER = {
  id: 1,
  organizationId: "org-1",
  unitId: 10,
  serviceOrderNumber: "OS-2026-042",
  publicId: "pub-abc-123",
  customerId: 101, // matches the portal linkedCustomer.id (101)
  clientContactSnapshot: null,
  status: "awaiting_quote_approval",
  totalApprovedCents: null,
  totalQuotedCents: null,
  rejectedAt: null,
  approvedAt: null,
  openedAt: new Date(),
};

const SAMPLE_CUSTOMER = {
  name: "Empresa Teste SA",
  email: "empresa@example.com",
};

// ---------------------------------------------------------------------------
// approveServiceOrderQuoteManually
// ---------------------------------------------------------------------------

describe("approveServiceOrderQuoteManually — email wiring (outbox)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueue.length = 0;
    capturedTxExecutors.length = 0;
  });

  it("calls enqueueServiceOrderEmail with eventKey='quote_approved:42' after approval", async () => {
    // DB calls:
    //  (1) serviceOrder SELECT → returns order
    //  (2) customer SELECT (for email payload) → returns customer
    //  (3) transaction: quote UPDATE returning, serviceOrder UPDATE returning, recordEvent (mocked)
    dbQueue.push(
      [SAMPLE_ORDER], // serviceOrder SELECT
      [SAMPLE_CUSTOMER], // customer SELECT for email payload
    );

    const result = await approveServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: {
        approvedByName: "João Silva",
        manualApprovalEvidenceType: "email",
        manualApprovalEvidenceText: "Aprovado por email",
        approvedAt: null,
      },
    });

    expect(result.status).toBe("ok");
    expect(mockEnqueueServiceOrderEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    expect(call[0].eventKey).toBe("quote_approved:42");
    expect(call[0].serviceOrderId).toBe(1);
  });

  it("payload contains serviceOrderId, quoteId, organizationId, totalApprovedCents", async () => {
    dbQueue.push([SAMPLE_ORDER], [SAMPLE_CUSTOMER]);

    await approveServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: {
        approvedByName: "João",
        manualApprovalEvidenceType: "email",
        manualApprovalEvidenceText: null,
        approvedAt: null,
      },
    });

    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    const payload = call[0].payload;
    expect(payload.serviceOrderId).toBe(1);
    expect(payload.quoteId).toBe(42);
    expect(payload.organizationId).toBe("org-1");
    expect(payload.totalApprovedCents).toBe(146000); // from mocked quote.totalCents
    expect(payload.customerName).toBe("Empresa Teste SA");
  });

  it("REQ-072: enqueue uses the tx executor, not module db (atomicity)", async () => {
    dbQueue.push([SAMPLE_ORDER], [SAMPLE_CUSTOMER]);

    await approveServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: {
        approvedByName: "João",
        manualApprovalEvidenceType: "email",
        manualApprovalEvidenceText: null,
        approvedAt: null,
      },
    });

    expect(capturedTxExecutors).toHaveLength(1);
    expect(capturedTxExecutors[0]).toBe(mockTxProxy);
  });

  it("does NOT call old dispatch helpers or sendServiceOrderEmailOnce", async () => {
    dbQueue.push([SAMPLE_ORDER], [SAMPLE_CUSTOMER]);
    await approveServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: {
        approvedByName: "João",
        manualApprovalEvidenceType: "email",
        manualApprovalEvidenceText: null,
        approvedAt: null,
      },
    });
    // Ensure old fire-and-forget pattern is gone
    const { sendServiceOrderEmailOnce } =
      await import("./service-order-email-once");
    expect(vi.mocked(sendServiceOrderEmailOnce)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rejectServiceOrderQuoteManually
// ---------------------------------------------------------------------------

describe("rejectServiceOrderQuoteManually — email wiring (outbox)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueue.length = 0;
    capturedTxExecutors.length = 0;
  });

  it("calls enqueueServiceOrderEmail with eventKey='quote_rejected:42' after rejection", async () => {
    dbQueue.push(
      [SAMPLE_ORDER], // serviceOrder SELECT
      [SAMPLE_CUSTOMER], // customer SELECT for email payload
    );

    const result = await rejectServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: { rejectionReason: "Preço elevado" },
    });

    expect(result.status).toBe("ok");
    expect(mockEnqueueServiceOrderEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    expect(call[0].eventKey).toBe("quote_rejected:42");
    expect(call[0].serviceOrderId).toBe(1);
  });

  it("payload contains rejectionReason when present", async () => {
    dbQueue.push([SAMPLE_ORDER], [SAMPLE_CUSTOMER]);

    await rejectServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: { rejectionReason: "Preço elevado" },
    });

    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    const payload = call[0].payload;
    expect(payload.quoteId).toBe(42);
    expect(payload.organizationId).toBe("org-1");
    expect(payload.rejectionReason).toBe("Preço elevado");
  });

  it("passes null rejectionReason when not provided", async () => {
    dbQueue.push([SAMPLE_ORDER], [SAMPLE_CUSTOMER]);

    await rejectServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: { rejectionReason: undefined },
    });

    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    const payload = call[0].payload;
    expect(payload.rejectionReason).toBeNull();
  });

  it("REQ-072: enqueue uses the tx executor (atomicity)", async () => {
    dbQueue.push([SAMPLE_ORDER], [SAMPLE_CUSTOMER]);

    await rejectServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: { rejectionReason: null },
    });

    expect(capturedTxExecutors).toHaveLength(1);
    expect(capturedTxExecutors[0]).toBe(mockTxProxy);
  });

  it("does NOT call enqueueServiceOrderEmail with approved eventKey on rejection", async () => {
    dbQueue.push([SAMPLE_ORDER], [SAMPLE_CUSTOMER]);
    await rejectServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: { rejectionReason: null },
    });
    const calls = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls;
    // Must have been called, but eventKey must be rejected not approved
    expect(calls).toHaveLength(1);
    expect(calls[0][0].eventKey).not.toContain("approved");
  });
});

// ---------------------------------------------------------------------------
// approveServiceOrderQuoteByPortalUser
// ---------------------------------------------------------------------------

describe("approveServiceOrderQuoteByPortalUser — email wiring (outbox)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueue.length = 0;
    capturedTxExecutors.length = 0;
  });

  it("calls enqueueServiceOrderEmail with eventKey='quote_approved:42' after portal approval", async () => {
    dbQueue.push([SAMPLE_ORDER]); // serviceOrder SELECT

    const result = await approveServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      metadata: { ipAddress: null, userAgent: null },
    });

    expect(result.status).toBe("ok");
    expect(mockEnqueueServiceOrderEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    expect(call[0].eventKey).toBe("quote_approved:42");
    expect(call[0].serviceOrderId).toBe(1);
  });

  it("payload contains customerName/customerEmail from linkedCustomer (tenant scope)", async () => {
    dbQueue.push([SAMPLE_ORDER]);

    await approveServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      metadata: {},
    });

    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    const payload = call[0].payload;
    expect(payload.organizationId).toBe("org-1");
    expect(payload.quoteId).toBe(42);
    expect(payload.totalApprovedCents).toBe(146000);
    expect(payload.customerName).toBe("Portal Cliente SA");
    expect(payload.customerEmail).toBe("portal@cliente.com");
  });

  it("REQ-072: enqueue uses the tx executor (atomicity)", async () => {
    dbQueue.push([SAMPLE_ORDER]);

    await approveServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      metadata: {},
    });

    expect(capturedTxExecutors).toHaveLength(1);
    expect(capturedTxExecutors[0]).toBe(mockTxProxy);
  });

  it("does NOT dispatch using old helper or sendServiceOrderEmailOnce", async () => {
    dbQueue.push([SAMPLE_ORDER], [], [], []);
    await approveServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      metadata: {},
    });
    const { sendServiceOrderEmailOnce } =
      await import("./service-order-email-once");
    expect(vi.mocked(sendServiceOrderEmailOnce)).not.toHaveBeenCalled();
  });

  it("returns not_found and does not enqueue when tenancy guard fails (customerId mismatch)", async () => {
    const { getPortalCustomerForAuthOrganization } =
      await import("./service-order.list-queries");
    vi.mocked(getPortalCustomerForAuthOrganization).mockResolvedValueOnce({
      id: 999, // does NOT match SAMPLE_ORDER.customerId (101)
      name: "Wrong Customer",
      email: null,
      authOrganizationId: "auth-org-portal-1",
      labOrganizationId: "org-1",
      taxId: null,
      phone: null,
      address: null,
      groupId: null,
      compliance: null,
      internalNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    dbQueue.push([SAMPLE_ORDER]);

    const result = await approveServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      metadata: {},
    });

    expect(result.status).toBe("not_found");
    expect(mockEnqueueServiceOrderEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rejectServiceOrderQuoteByPortalUser
// ---------------------------------------------------------------------------

describe("rejectServiceOrderQuoteByPortalUser — email wiring (outbox)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueue.length = 0;
    capturedTxExecutors.length = 0;
  });

  it("calls enqueueServiceOrderEmail with eventKey='quote_rejected:42' after portal rejection", async () => {
    dbQueue.push([SAMPLE_ORDER]);

    const result = await rejectServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      values: { rejectionReason: "Fora do orçamento" },
      metadata: { ipAddress: "1.2.3.4", userAgent: "Mozilla" },
    });

    expect(result.status).toBe("ok");
    expect(mockEnqueueServiceOrderEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    expect(call[0].eventKey).toBe("quote_rejected:42");
    expect(call[0].serviceOrderId).toBe(1);
  });

  it("payload contains rejectionReason and customerName from linkedCustomer", async () => {
    dbQueue.push([SAMPLE_ORDER]);

    await rejectServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      values: { rejectionReason: "Fora do orçamento" },
      metadata: {},
    });

    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    const payload = call[0].payload;
    expect(payload.organizationId).toBe("org-1");
    expect(payload.quoteId).toBe(42);
    expect(payload.rejectionReason).toBe("Fora do orçamento");
    expect(payload.customerName).toBe("Portal Cliente SA");
    expect(payload.customerEmail).toBe("portal@cliente.com");
  });

  it("passes null rejectionReason when portal rejection has no reason", async () => {
    dbQueue.push([SAMPLE_ORDER]);

    await rejectServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      values: { rejectionReason: undefined },
      metadata: {},
    });

    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    const payload = call[0].payload;
    expect(payload.rejectionReason).toBeNull();
  });

  it("REQ-072: enqueue uses the tx executor (atomicity)", async () => {
    dbQueue.push([SAMPLE_ORDER]);

    await rejectServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      values: { rejectionReason: null },
      metadata: {},
    });

    expect(capturedTxExecutors).toHaveLength(1);
    expect(capturedTxExecutors[0]).toBe(mockTxProxy);
  });

  it("does NOT call enqueueServiceOrderEmail with approved eventKey on portal rejection", async () => {
    dbQueue.push([SAMPLE_ORDER]);
    await rejectServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      values: { rejectionReason: null },
      metadata: {},
    });
    const calls = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].eventKey).not.toContain("approved");
  });

  it("returns not_found and does not enqueue when tenancy guard fails", async () => {
    const { getPortalCustomerForAuthOrganization } =
      await import("./service-order.list-queries");
    vi.mocked(getPortalCustomerForAuthOrganization).mockResolvedValueOnce({
      id: 999, // mismatch
      name: "Wrong Customer",
      email: null,
      authOrganizationId: "auth-org-portal-1",
      labOrganizationId: "org-1",
      taxId: null,
      phone: null,
      address: null,
      groupId: null,
      compliance: null,
      internalNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    dbQueue.push([SAMPLE_ORDER]);

    const result = await rejectServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      values: { rejectionReason: null },
      metadata: {},
    });

    expect(result.status).toBe("not_found");
    expect(mockEnqueueServiceOrderEmail).not.toHaveBeenCalled();
  });
});
