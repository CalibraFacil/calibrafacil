/**
 * Mini-spec I, Part 2 — Outbox wiring tests.
 *
 * REQ-SOEMAIL-071: B (createServiceOrder) and C (sendServiceOrderQuote) enqueue
 *   an outbox row durably (awaited) instead of fire-and-forget dispatch.
 * REQ-SOEMAIL-072: D (approve/reject commands) enqueue INSIDE the transaction
 *   executor (tx), not with module-level db — atomicity with command effect.
 * REQ-SOEMAIL-073: (real producer) each command uses the correct eventKey /
 *   payload namespace so the drain can route to the correct dispatch helper.
 * REQ-SOEMAIL-074: (real producer) dedup key is (serviceOrderId, eventKey) — correct
 *   unique key present in enqueue call.
 * REQ-SOEMAIL-075: organizationId scoped to the service order — verified by
 *   asserting the payload.organizationId matches the OS orgId.
 *
 * Each test asserts enqueueServiceOrderEmail is called once with the correct
 * eventKey and payload fields. Mutation: wrong eventKey → RED.
 *
 * D atomicity test: swapping tx→db in the command (or moving outside tx) turns
 * the tx-executor assertion RED (the test checks the exact executor object).
 *
 * No fire-and-forget: the old dispatch helpers (dispatchNovaOsEmail,
 * dispatchNovoOrcamentoEmail, dispatchApprovedQuoteEmailOnce, etc.) must NOT
 * be called by the commands. These helpers now live only in the drain.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Hoisted mocks — declared before any module imports
// =============================================================================

const {
  mockEnqueueServiceOrderEmail,
  // old dispatch helpers — must NOT be called after rewiring
  mockDispatchNovaOsEmail,
  mockDispatchNovoOrcamentoEmail,
  mockSendServiceOrderEmailOnce,
  mockDispatchApprovedOnce,
  mockDispatchApprovedOncePortal,
  mockDispatchRejectedOnce,
  mockDispatchRejectedOncePortal,
  // db transaction capture
  capturedTxExecutors,
  mockTxProxy,
} = vi.hoisted(() => {
  // We capture the executor passed to enqueueServiceOrderEmail
  const capturedTxExecutors: Array<unknown> = [];

  // A minimal transaction proxy — its identity is what we assert against
  const txProxy = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn(),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
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

  const enqueue = vi.fn(async (_params: EnqueueParams, executor?: unknown) => {
    capturedTxExecutors.push(executor);
  });

  return {
    mockEnqueueServiceOrderEmail: enqueue,
    mockDispatchNovaOsEmail: vi.fn(),
    mockDispatchNovoOrcamentoEmail: vi.fn(),
    mockSendServiceOrderEmailOnce: vi.fn(),
    mockDispatchApprovedOnce: vi.fn(),
    mockDispatchApprovedOncePortal: vi.fn(),
    mockDispatchRejectedOnce: vi.fn(),
    mockDispatchRejectedOncePortal: vi.fn(),
    capturedTxExecutors,
    mockTxProxy: txProxy,
  };
});

// =============================================================================
// Module mocks
// =============================================================================

// enqueueServiceOrderEmail — the CORE assertion target
vi.mock("./email-outbox-payloads", () => ({
  enqueueServiceOrderEmail: mockEnqueueServiceOrderEmail,
}));

// Old fire-and-forget dispatch helpers — must NOT be called after rewiring
vi.mock("./nova-os-email-dispatch", () => ({
  dispatchNovaOsEmail: mockDispatchNovaOsEmail,
}));
vi.mock("./novo-orcamento-email-dispatch", () => ({
  dispatchNovoOrcamentoEmail: mockDispatchNovoOrcamentoEmail,
}));
vi.mock("./service-order-email-once", () => ({
  sendServiceOrderEmailOnce: mockSendServiceOrderEmailOnce,
}));
vi.mock("./quote-email-dispatch", () => ({
  dispatchApprovedQuoteEmailOnce: mockDispatchApprovedOnce,
  dispatchApprovedQuoteEmailOncePortal: mockDispatchApprovedOncePortal,
  dispatchRejectedQuoteEmailOnce: mockDispatchRejectedOnce,
  dispatchRejectedQuoteEmailOncePortal: mockDispatchRejectedOncePortal,
}));

// DB mock — chainable builder + transaction that passes mockTxProxy
const dbQueue: Array<unknown[]> = [];

vi.mock("@calibra-facil/db", () => {
  // Minimal chainable query builder that resolves from the queue.
  // Every terminal-like method (limit, returning, orderBy, execute, then) is async
  // so that queries ending in .orderBy() (without .limit()) also resolve correctly.
  function makeBuilder(): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    for (const method of ["from", "where", "innerJoin", "leftJoin"]) {
      b[method] = () => b;
    }
    b.select = () => b;
    // orderBy is treated as potentially terminal — returns a real Promise (for
    // queries that await .orderBy() directly) with an additional .limit() method
    // attached via Object.assign (for queries that chain .limit() after .orderBy()).
    b.orderBy = () => {
      const p = Promise.resolve(dbQueue.length ? dbQueue.shift() : []);
      return Object.assign(p, {
        limit: async () => (dbQueue.length ? dbQueue.shift() : []),
      });
    };
    b.limit = async () => (dbQueue.length ? dbQueue.shift() : []);
    b.returning = async () => (dbQueue.length ? dbQueue.shift() : []);
    b.execute = async () => (dbQueue.length ? dbQueue.shift() : []);
    b.update = () => b;
    b.set = () => b;
    b.insert = () => b;
    b.values = () => b;
    b.onConflictDoNothing = () => b;
    b.delete = () => b;
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

// Misc mocks for unrelated dependencies

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
  getServiceOrderDetail: vi.fn().mockResolvedValue({
    organizationId: "org-1",
    unitId: 10,
    serviceOrderNumber: "OS-2026-042",
    customerId: 101,
    customerName: "Empresa Teste SA",
    customerEmail: "empresa@example.com",
    customerTaxId: "12.345.678/0001-99",
    publicId: "pub-abc-123",
    openedAt: new Date("2026-06-01T00:00:00.000Z"),
    claimedDefect: "Sensor fault",
  }),
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
    labOrganizationId: "org-1",
    taxId: null,
    phone: null,
    address: null,
    groupId: null,
    compliance: null,
    internalNotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
}));

vi.mock("../../lib/service-order-workflow", () => ({
  createInitialServiceOrderRecords: vi.fn().mockResolvedValue({
    id: 1,
    organizationId: "org-1",
    unitId: 10,
    customerId: 101,
    serviceOrderNumber: "OS-2026-042",
    publicId: "pub-abc-123",
    claimedDefect: "Sensor fault",
    openedAt: new Date("2026-06-01T00:00:00.000Z"),
    clientContactSnapshot: null,
    status: "opened",
  }),
  createPublicServiceOrderAccessToken: vi.fn().mockResolvedValue({
    token: "tok-abc-123",
    tokenHash: "hash-abc-123",
  }),
  recordServiceOrderEvent: vi.fn().mockResolvedValue(undefined),
  replaceQuoteItems: vi.fn().mockResolvedValue({
    subtotalServicesCents: 0,
    subtotalPartsCents: 0,
    discountCents: 0,
    freightCents: 0,
    totalCents: 0,
  }),
  getOrCreateServiceOrderSettings: vi.fn().mockResolvedValue({}),
  createBillingDocumentFromServiceOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/units", () => ({
  buildUnitScopeCondition: vi.fn().mockReturnValue(undefined),
}));

vi.mock("@calibra-facil/shared", () => ({
  canApproveServiceOrderQuote: vi.fn().mockReturnValue(true),
  canEditServiceOrderQuote: vi.fn().mockReturnValue(true),
  canTransitionServiceOrderStatus: vi.fn().mockReturnValue(true),
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
  serviceOrderAssetSnapshot: new Proxy({}, { get: (_, p) => ({ col: String(p) }) }),
  customer: new Proxy({}, { get: (_, p) => ({ col: String(p) }) }),
  asset: new Proxy({}, { get: (_, p) => ({ col: String(p) }) }),
  serviceOrderSettings: new Proxy({}, { get: (_, p) => ({ col: String(p) }) }),
  serviceOrderEmailOutbox: new Proxy({}, { get: (_, p) => ({ col: String(p) }) }),
}));

// =============================================================================
// Import commands AFTER all mocks
// =============================================================================

import { createServiceOrder } from "./service-order.commands";
import {
  sendServiceOrderQuote,
  approveServiceOrderQuoteManually,
  rejectServiceOrderQuoteManually,
  approveServiceOrderQuoteByPortalUser,
  rejectServiceOrderQuoteByPortalUser,
} from "./service-order.quotes";

// =============================================================================
// Fixtures
// =============================================================================

const MEMBER = {
  organizationId: "org-1",
  activeUnitId: 10,
  accessibleUnitIds: [10],
  userId: "user-1",
  role: "admin" as const,
};

const SAMPLE_ORDER = {
  id: 1,
  organizationId: "org-1",
  unitId: 10,
  serviceOrderNumber: "OS-2026-042",
  publicId: "pub-abc-123",
  customerId: 101,
  clientContactSnapshot: null,
  status: "awaiting_quote_approval",
  totalApprovedCents: null,
  totalQuotedCents: null,
  rejectedAt: null,
  approvedAt: null,
  openedAt: new Date("2026-06-01T00:00:00.000Z"),
};

// Flush microtasks to allow any remaining async work to complete
async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

// =============================================================================
// B — createServiceOrder (REQ-SOEMAIL-071)
// =============================================================================

describe("REQ-SOEMAIL-071 (B): createServiceOrder enqueues nova_os outbox row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueue.length = 0;
    capturedTxExecutors.length = 0;

    // DB calls in createServiceOrder: asset+customer join, then document enqueues
    // createInitialServiceOrderRecords is mocked so no real DB calls for the main write
    // But there are still DB selects for customer + assetSnapshot AFTER creation
    dbQueue.push(
      [{ id: 10, unitId: 10, customerId: 101, labOrganizationId: "org-1" }], // asset+customer join
      [{ name: "Empresa Teste SA", email: "empresa@example.com" }], // customer select
      [{ manufacturer: "Mettler", model: "XS105", serialNumber: "SN-1" }], // assetSnapshot select
    );
  });

  it("REQ-SOEMAIL-071/B: enqueueServiceOrderEmail is called once with eventKey='nova_os'", async () => {
    const result = await createServiceOrder({
      member: MEMBER,
      actorUserId: "user-1",
      values: {
        assetId: 10,
        customerId: 101,
        assetSnapshot: {},
        claimedDefect: "Sensor fault",
        intakeType: "drop_off",
        priority: "normal",
        deliveryMethod: "pickup",
        evaluationFeeCents: 0,
      },
      metadata: {},
    });

    await flushAsync();

    expect(result.status).toBe("ok");
    expect(mockEnqueueServiceOrderEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    expect(call).toBeDefined();
    expect(call[0].eventKey).toBe("nova_os");
  });

  it("REQ-SOEMAIL-071/B: wrong eventKey → test RED (mutation guard)", async () => {
    // This test verifies that checking for the EXACT eventKey catches mutations.
    // If the implementation used 'wrong_key', this assertion would fail.
    dbQueue.push(
      [{ id: 10, unitId: 10, customerId: 101, labOrganizationId: "org-1" }],
      [{ name: "Empresa", email: "e@e.com" }],
      [{ manufacturer: "X", model: "Y", serialNumber: "Z" }],
    );

    await createServiceOrder({
      member: MEMBER,
      actorUserId: "user-1",
      values: {
        assetId: 10,
        customerId: 101,
        assetSnapshot: {},
        claimedDefect: "Sensor fault",
        intakeType: "drop_off",
        priority: "normal",
        deliveryMethod: "pickup",
        evaluationFeeCents: 0,
      },
      metadata: {},
    });

    await flushAsync();

    const calls = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // The eventKey must be exactly 'nova_os' — any other value is wrong
    expect(calls[0][0].eventKey).toBe("nova_os");
  });

  it("REQ-SOEMAIL-071/B: payload has serviceOrderId, serviceOrderNumber, organizationId", async () => {
    dbQueue.push(
      [{ id: 10, unitId: 10, customerId: 101, labOrganizationId: "org-1" }],
      [{ name: "Empresa Teste SA", email: "empresa@example.com" }],
      [{ manufacturer: "Mettler", model: "XS105", serialNumber: "SN-1" }],
    );

    await createServiceOrder({
      member: MEMBER,
      actorUserId: "user-1",
      values: {
        assetId: 10,
        customerId: 101,
        assetSnapshot: {},
        claimedDefect: "Sensor fault",
        intakeType: "drop_off",
        priority: "normal",
        deliveryMethod: "pickup",
        evaluationFeeCents: 0,
      },
      metadata: {},
    });

    await flushAsync();

    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    expect(call).toBeDefined();
    const params = call[0];
    // serviceOrderId from the created mock
    expect(params.serviceOrderId).toBe(1);
    expect(params.organizationId).toBe("org-1");
    // payload must include the key fields
    const payload = params.payload;
    expect(payload.serviceOrderId).toBe(1);
    expect(typeof payload.serviceOrderNumber).toBe("string");
    expect(payload.organizationId).toBe("org-1");
  });

  it("REQ-SOEMAIL-071/B: dispatchNovaOsEmail is NOT called directly (no fire-and-forget)", async () => {
    dbQueue.push(
      [{ id: 10, unitId: 10, customerId: 101, labOrganizationId: "org-1" }],
      [{ name: "Empresa", email: "e@e.com" }],
      [{ manufacturer: "X", model: "Y", serialNumber: "Z" }],
    );

    await createServiceOrder({
      member: MEMBER,
      actorUserId: "user-1",
      values: {
        assetId: 10,
        customerId: 101,
        assetSnapshot: {},
        claimedDefect: "Sensor fault",
        intakeType: "drop_off",
        priority: "normal",
        deliveryMethod: "pickup",
        evaluationFeeCents: 0,
      },
      metadata: {},
    });

    await flushAsync();

    // sendServiceOrderEmailOnce and dispatchNovaOsEmail must NOT be called
    // (email only produced by the drain now)
    expect(mockDispatchNovaOsEmail).not.toHaveBeenCalled();
    expect(mockSendServiceOrderEmailOnce).not.toHaveBeenCalled();
  });
});

// =============================================================================
// C — sendServiceOrderQuote (REQ-SOEMAIL-071)
// =============================================================================

describe("REQ-SOEMAIL-071 (C): sendServiceOrderQuote enqueues orcamento_sent:<quoteId> outbox row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueue.length = 0;
    capturedTxExecutors.length = 0;

    // Actual DB calls in sendServiceOrderQuote (mocked deps excluded):
    //  1. db.update(serviceOrderQuote).set().where().returning() → updated quote row
    //  2. db.update(serviceOrder).set().where()  → ends in .where(), no queue item
    //  3. recordServiceOrderEvent → MOCKED
    //  4. enqueueServiceOrderDocumentJob → MOCKED
    // Then parallel data-load for payload:
    //  5. db.select().from(serviceOrder).where().limit() → orderRow
    //  6. db.select().from(serviceOrderQuoteItem).where().orderBy() → quoteItemRows (thenable)
    //  7. db.select().from(serviceOrderAssetSnapshot).where().limit() → snapshotRow
    //  8. db.select().from(customer).where().limit() → customerRow
    dbQueue.push(
      [{ ...SAMPLE_ORDER, status: "sent", sentAt: new Date() }], // [0] quote UPDATE returning
      [{ publicId: "pub-abc-123", clientContactSnapshot: null }], // [1] orderRow SELECT
      [], // [2] quoteItemRows SELECT (orderBy thenable → empty)
      [{ manufacturer: "Mettler", model: "XS105", serialNumber: "SN-1", inventoryCode: "INV-1", displaySpecs: [] }], // [3] snapshotRow SELECT
      [{ name: "Empresa Teste SA", email: "empresa@example.com", taxId: "12.345.678/0001-99" }], // [4] customerRow SELECT
    );
  });

  it("REQ-SOEMAIL-071/C: enqueueServiceOrderEmail is called once with eventKey='orcamento_sent:42'", async () => {
    const result = await sendServiceOrderQuote({
      serviceOrderId: 1,
      quoteId: 42,
      member: MEMBER,
      actorUserId: "user-1",
      values: { expiresAt: null },
    });

    expect(result.status).toBe("ok");
    expect(mockEnqueueServiceOrderEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    expect(call[0].eventKey).toBe("orcamento_sent:42");
  });

  it("REQ-SOEMAIL-071/C: payload has serviceOrderId, quoteId, organizationId", async () => {
    dbQueue.push(
      [{ ...SAMPLE_ORDER, status: "sent", sentAt: new Date() }],
      [{ publicId: "pub-abc-123", clientContactSnapshot: null }],
      [],
      [{ manufacturer: "M", model: "Y", serialNumber: "Z", inventoryCode: null, displaySpecs: [] }],
      [{ name: "Empresa", email: "e@e.com", taxId: null }],
    );

    await sendServiceOrderQuote({
      serviceOrderId: 1,
      quoteId: 42,
      member: MEMBER,
      actorUserId: "user-1",
      values: { expiresAt: null },
    });

    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    const params = call[0];
    expect(params.serviceOrderId).toBe(1);
    expect(params.organizationId).toBe("org-1");
    const payload = params.payload;
    expect(payload.serviceOrderId).toBe(1);
    expect(payload.quoteId).toBe(42);
    expect(payload.organizationId).toBe("org-1");
  });

  it("REQ-SOEMAIL-071/C: dispatchNovoOrcamentoEmail and sendServiceOrderEmailOnce are NOT called directly", async () => {
    dbQueue.push(
      [{ ...SAMPLE_ORDER, status: "sent", sentAt: new Date() }],
      [{ publicId: "pub-abc-123", clientContactSnapshot: null }],
      [],
      [{ manufacturer: "M", model: "Y", serialNumber: "Z", inventoryCode: null, displaySpecs: [] }],
      [{ name: "Empresa", email: "e@e.com", taxId: null }],
    );

    await sendServiceOrderQuote({
      serviceOrderId: 1,
      quoteId: 42,
      member: MEMBER,
      actorUserId: "user-1",
      values: { expiresAt: null },
    });

    expect(mockDispatchNovoOrcamentoEmail).not.toHaveBeenCalled();
    expect(mockSendServiceOrderEmailOnce).not.toHaveBeenCalled();
  });
});

// =============================================================================
// D — approveServiceOrderQuoteManually (REQ-SOEMAIL-071, 072)
// =============================================================================

describe("REQ-SOEMAIL-071/072 (D): approveServiceOrderQuoteManually enqueues inside tx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueue.length = 0;
    capturedTxExecutors.length = 0;

    dbQueue.push(
      [SAMPLE_ORDER], // serviceOrder SELECT
    );
  });

  it("REQ-SOEMAIL-071/D-approve-manual: enqueueServiceOrderEmail called with eventKey='quote_approved:42'", async () => {
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
  });

  it("REQ-SOEMAIL-072/D-approve-manual: enqueue uses the tx executor (atomicity)", async () => {
    dbQueue.push([SAMPLE_ORDER]);

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

    // capturedTxExecutors[0] is the second argument to enqueueServiceOrderEmail
    // It must be the tx proxy, NOT the module-level db
    expect(capturedTxExecutors).toHaveLength(1);
    expect(capturedTxExecutors[0]).toBe(mockTxProxy);
  });

  it("REQ-SOEMAIL-071/D-approve-manual: payload contains serviceOrderId, quoteId, organizationId", async () => {
    dbQueue.push([SAMPLE_ORDER]);

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
    const params = call[0];
    expect(params.serviceOrderId).toBe(1);
    expect(params.organizationId).toBe("org-1");
    const payload = params.payload;
    expect(payload.serviceOrderId).toBe(1);
    expect(payload.quoteId).toBe(42);
    expect(payload.organizationId).toBe("org-1");
    expect(payload.totalApprovedCents).toBe(146000); // from mocked quote.totalCents
  });

  it("REQ-SOEMAIL-071/D-approve-manual: old dispatch helpers NOT called", async () => {
    dbQueue.push([SAMPLE_ORDER]);

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

    expect(mockDispatchApprovedOnce).not.toHaveBeenCalled();
    expect(mockDispatchRejectedOnce).not.toHaveBeenCalled();
    expect(mockSendServiceOrderEmailOnce).not.toHaveBeenCalled();
  });
});

// =============================================================================
// D — rejectServiceOrderQuoteManually (REQ-SOEMAIL-071, 072)
// =============================================================================

describe("REQ-SOEMAIL-071/072 (D): rejectServiceOrderQuoteManually enqueues inside tx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueue.length = 0;
    capturedTxExecutors.length = 0;

    dbQueue.push([SAMPLE_ORDER]);
  });

  it("REQ-SOEMAIL-071/D-reject-manual: enqueueServiceOrderEmail called with eventKey='quote_rejected:42'", async () => {
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
  });

  it("REQ-SOEMAIL-072/D-reject-manual: enqueue uses the tx executor (atomicity)", async () => {
    dbQueue.push([SAMPLE_ORDER]);

    await rejectServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: { rejectionReason: "Preço elevado" },
    });

    expect(capturedTxExecutors).toHaveLength(1);
    expect(capturedTxExecutors[0]).toBe(mockTxProxy);
  });

  it("REQ-SOEMAIL-071/D-reject-manual: payload contains rejectionReason and organizationId", async () => {
    dbQueue.push([SAMPLE_ORDER]);

    await rejectServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: { rejectionReason: "Preço elevado" },
    });

    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    const params = call[0];
    expect(params.serviceOrderId).toBe(1);
    const payload = params.payload;
    expect(payload.quoteId).toBe(42);
    expect(payload.organizationId).toBe("org-1");
    expect(payload.rejectionReason).toBe("Preço elevado");
  });

  it("REQ-SOEMAIL-071/D-reject-manual: old dispatch helpers NOT called", async () => {
    dbQueue.push([SAMPLE_ORDER]);

    await rejectServiceOrderQuoteManually({
      serviceOrderId: 1,
      quoteId: 42,
      actorUserId: "user-1",
      values: { rejectionReason: null },
    });

    expect(mockDispatchApprovedOnce).not.toHaveBeenCalled();
    expect(mockDispatchRejectedOnce).not.toHaveBeenCalled();
    expect(mockSendServiceOrderEmailOnce).not.toHaveBeenCalled();
  });
});

// =============================================================================
// D — approveServiceOrderQuoteByPortalUser (REQ-SOEMAIL-071, 072)
// =============================================================================

describe("REQ-SOEMAIL-071/072 (D): approveServiceOrderQuoteByPortalUser enqueues inside tx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueue.length = 0;
    capturedTxExecutors.length = 0;

    // getPortalCustomerForAuthOrganization is mocked → returns id:101
    // getQuoteForAction is mocked → returns id:42, customerId:1 ok
    // serviceOrder SELECT → SAMPLE_ORDER (customerId:101 matches mocked customer.id:101)
    dbQueue.push([SAMPLE_ORDER]);
  });

  it("REQ-SOEMAIL-071/D-approve-portal: enqueueServiceOrderEmail called with eventKey='quote_approved:42'", async () => {
    const result = await approveServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      metadata: {},
    });

    expect(result.status).toBe("ok");
    expect(mockEnqueueServiceOrderEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    expect(call[0].eventKey).toBe("quote_approved:42");
  });

  it("REQ-SOEMAIL-072/D-approve-portal: enqueue uses the tx executor (atomicity)", async () => {
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

  it("REQ-SOEMAIL-071/D-approve-portal: payload contains customerName from linkedCustomer (REQ-075 tenant scope)", async () => {
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
    // Customer name and email come from linkedCustomer (portal tenancy scope)
    expect(payload.customerName).toBe("Portal Cliente SA");
    expect(payload.customerEmail).toBe("portal@cliente.com");
  });

  it("REQ-SOEMAIL-071/D-approve-portal: old dispatch helpers NOT called", async () => {
    dbQueue.push([SAMPLE_ORDER]);

    await approveServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      metadata: {},
    });

    expect(mockDispatchApprovedOnce).not.toHaveBeenCalled();
    expect(mockDispatchApprovedOncePortal).not.toHaveBeenCalled();
    expect(mockSendServiceOrderEmailOnce).not.toHaveBeenCalled();
  });
});

// =============================================================================
// D — rejectServiceOrderQuoteByPortalUser (REQ-SOEMAIL-071, 072)
// =============================================================================

describe("REQ-SOEMAIL-071/072 (D): rejectServiceOrderQuoteByPortalUser enqueues inside tx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbQueue.length = 0;
    capturedTxExecutors.length = 0;

    dbQueue.push([SAMPLE_ORDER]);
  });

  it("REQ-SOEMAIL-071/D-reject-portal: enqueueServiceOrderEmail called with eventKey='quote_rejected:42'", async () => {
    const result = await rejectServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      values: { rejectionReason: "Fora do orçamento" },
      metadata: {},
    });

    expect(result.status).toBe("ok");
    expect(mockEnqueueServiceOrderEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockEnqueueServiceOrderEmail).mock.calls[0];
    expect(call[0].eventKey).toBe("quote_rejected:42");
  });

  it("REQ-SOEMAIL-072/D-reject-portal: enqueue uses the tx executor (atomicity)", async () => {
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

  it("REQ-SOEMAIL-071/D-reject-portal: payload contains rejectionReason and customerName from linkedCustomer", async () => {
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

  it("REQ-SOEMAIL-071/D-reject-portal: old dispatch helpers NOT called", async () => {
    dbQueue.push([SAMPLE_ORDER]);

    await rejectServiceOrderQuoteByPortalUser({
      serviceOrderId: 1,
      quoteId: 42,
      authOrganizationId: "auth-org-portal-1",
      actorUserId: "portal-user-1",
      values: { rejectionReason: null },
      metadata: {},
    });

    expect(mockDispatchRejectedOnce).not.toHaveBeenCalled();
    expect(mockDispatchRejectedOncePortal).not.toHaveBeenCalled();
    expect(mockSendServiceOrderEmailOnce).not.toHaveBeenCalled();
  });
});
