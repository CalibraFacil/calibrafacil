/**
 * Tests for mini-spec I — durability parity for B/C/D via the outbox.
 *
 * Covers:
 *  - REQ-SOEMAIL-073: drain routes nova_os / orcamento_sent:* /
 *    quote_approved:* / quote_rejected:* to the correct dispatch helper,
 *    wrapped in sendServiceOrderEmailOnce.
 *  - REQ-SOEMAIL-074: at-most-once dedup — if sendServiceOrderEmailOnce
 *    reports already-sent (key recorded), the row is marked processed and
 *    the dispatch helper is NOT called again.
 *  - REQ-SOEMAIL-075: tenant isolation — recipient comes only from the row's
 *    own org (payload is org-owned by construction; SO re-load scoped by
 *    organizationId).
 *  - Payload validation: malformed payload skips gracefully, does not crash.
 *  - Recipient/OS pinned: garbling a payload field causes the test to go RED.
 *  - Regression: existing status_email:* path unchanged.
 *  - enqueueServiceOrderEmail: inserts with the passed executor (tx), onConflictDoNothing.
 *
 * Strategy: mock db, dispatch helpers, and sendServiceOrderEmailOnce; drive
 * the drain from synthetic outbox rows with valid / malformed payloads.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { serviceOrderEmailOutbox } from "@calibra-facil/db/schema";

// =============================================================================
// Hoisted mocks
// =============================================================================

const {
  // DB mocks
  mockExecute,
  mockDbSelectFn,
  mockDbInsertFn,
  // Dispatch helper mocks — one per B/C/D email type
  mockDispatchNovaOs,
  mockDispatchNovoOrcamento,
  mockDispatchOrcamentoAprovado,
  mockDispatchOrcamentoRecusado,
  // sendServiceOrderEmailOnce mock
  mockSendOnce,
  // Status-path mocks (regression: must still work)
  mockGetLabEmailBrand,
  mockSendEmail,
  mockServicoIniciado,
} = vi.hoisted(() => {
  // Chainable Drizzle select builder
  function makeSelectChain(rows: unknown[]) {
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
    };
  }

  // Sequential select queue — populated per-test
  const selectQueue: Array<unknown[]> = [];
  let selectIdx = 0;

  const selectFn = Object.assign(
    vi.fn(() => {
      const rows = selectQueue[selectIdx] ?? [];
      selectIdx++;
      return makeSelectChain(rows);
    }),
    {
      _queue: selectQueue,
      _reset: () => {
        selectQueue.length = 0;
        selectIdx = 0;
      },
    },
  );

  // Chainable Drizzle insert builder for enqueueServiceOrderEmail tests
  const capturedInserts: Array<{
    table: unknown;
    values: unknown;
    conflictTarget: unknown;
  }> = [];

  function makeInsertChain(table: unknown) {
    return {
      values: vi.fn((row: unknown) => ({
        onConflictDoNothing: vi.fn((opts: unknown) => {
          capturedInserts.push({ table, values: row, conflictTarget: opts });
          return Promise.resolve();
        }),
      })),
    };
  }

  const insertFn = Object.assign(
    vi.fn((table: unknown) => makeInsertChain(table)),
    {
      _captured: capturedInserts,
      _reset: () => {
        capturedInserts.length = 0;
      },
    },
  );

  return {
    mockExecute: vi.fn(),
    mockDbSelectFn: selectFn,
    mockDbInsertFn: insertFn,

    mockDispatchNovaOs: vi
      .fn()
      .mockResolvedValue({ sent: true, emailId: "e-nova-os" }),
    mockDispatchNovoOrcamento: vi
      .fn()
      .mockResolvedValue({ sent: true, emailId: "e-orcamento" }),
    mockDispatchOrcamentoAprovado: vi
      .fn()
      .mockResolvedValue({ sent: true, emailId: "e-aprovado" }),
    mockDispatchOrcamentoRecusado: vi
      .fn()
      .mockResolvedValue({ sent: true, emailId: "e-recusado" }),

    // sendServiceOrderEmailOnce: by default calls dispatch() and returns nothing
    mockSendOnce: vi.fn(
      async (input: {
        serviceOrderId: number;
        eventKey: string;
        dispatch: () => Promise<unknown>;
      }) => {
        await input.dispatch();
      },
    ),

    mockGetLabEmailBrand: vi.fn().mockResolvedValue(undefined),
    mockSendEmail: vi
      .fn()
      .mockResolvedValue({ sent: true, emailId: "e-status" }),
    mockServicoIniciado: vi.fn().mockReturnValue("servico-iniciado-element"),
  };
});

// =============================================================================
// Module mocks
// =============================================================================

vi.mock("@calibra-facil/db", () => ({
  db: {
    execute: mockExecute,
    select: mockDbSelectFn,
    insert: mockDbInsertFn,
  },
}));

vi.mock("@calibra-facil/db/schema", () => ({
  serviceOrder: {
    id: "so_id",
    organizationId: "so_orgId",
    customerId: "so_custId",
    serviceOrderNumber: "so_num",
    publicId: "so_pubId",
    clientContactSnapshot: "so_snapshot",
  },
  customer: { id: "c_id", name: "c_name", email: "c_email" },
  serviceOrderEmailOutbox: {
    id: "ob_id",
    organizationId: "ob_orgId",
    serviceOrderId: "ob_soId",
    targetStatus: "ob_status",
    eventKey: "ob_eventKey",
    payload: "ob_payload",
    attempts: "ob_attempts",
    processedAt: "ob_processedAt",
    claimedAt: "ob_claimedAt",
    createdAt: "ob_createdAt",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    eq: (_c: unknown, _v: unknown) => ({ _op: "eq" }),
    and: (..._a: unknown[]) => ({ _op: "and" }),
    isNull: (_c: unknown) => ({ _op: "isNull" }),
    lt: (_c: unknown, _v: unknown) => ({ _op: "lt" }),
    asc: (_c: unknown) => ({ _op: "asc" }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ..._values: unknown[]) => ({
        _sql: true,
        _sqlText: strings.join("?"),
      }),
      { raw: (_s: string) => ({ _sqlRaw: true }) },
    ),
  };
});

vi.mock("@calibra-facil/notifications", () => ({
  sendServiceOrderCustomerEmail: mockSendEmail,
  getLabEmailBrand: mockGetLabEmailBrand,
}));

vi.mock("@calibra-facil/email", () => ({
  ServiceStartedEmail: mockServicoIniciado,
  ServiceInProgressEmail: vi.fn().mockReturnValue("andamento"),
  AwaitingEvaluationEmail: vi.fn().mockReturnValue("aat"),
  UnderEvaluationEmail: vi.fn().mockReturnValue("eat"),
  ReadyForPickupEmail: vi.fn().mockReturnValue("ppr"),
  ServiceOrderDeliveredEmail: vi.fn().mockReturnValue("ent"),
  ServiceOrderClosedEmail: vi.fn().mockReturnValue("enc"),
  FinalReviewEmail: vi.fn().mockReturnValue("rev"),
  ServiceOrderCanceledEmail: vi.fn().mockReturnValue("can"),
  WarrantyReturnEmail: vi.fn().mockReturnValue("gar"),
}));

// Mock the B/C/D dispatch helpers
// Paths relative to THIS test file (src/lib/__tests__/) → ../../modules/service-orders/
vi.mock("../../modules/service-orders/nova-os-email-dispatch", () => ({
  dispatchNovaOsEmail: mockDispatchNovaOs,
}));
vi.mock("../../modules/service-orders/novo-orcamento-email-dispatch", () => ({
  dispatchNovoOrcamentoEmail: mockDispatchNovoOrcamento,
}));
vi.mock(
  "../../modules/service-orders/orcamento-aprovado-email-dispatch",
  () => ({ dispatchOrcamentoAprovadoEmail: mockDispatchOrcamentoAprovado }),
);
vi.mock(
  "../../modules/service-orders/orcamento-recusado-email-dispatch",
  () => ({ dispatchOrcamentoRecusadoEmail: mockDispatchOrcamentoRecusado }),
);

// Mock sendServiceOrderEmailOnce
vi.mock("../../modules/service-orders/service-order-email-once", () => ({
  sendServiceOrderEmailOnce: mockSendOnce,
}));

// =============================================================================
// Import drain and enqueue helper AFTER mocks
// =============================================================================
import { drainServiceOrderEmailOutbox } from "../service-order-email-drain";
import { enqueueServiceOrderEmail } from "../../modules/service-orders/email-outbox-payloads";

// =============================================================================
// Helpers
// =============================================================================

function enqueueSelects(...rows: unknown[][]) {
  mockDbSelectFn._reset();
  for (const r of rows) mockDbSelectFn._queue.push(r);
}

// Synthetic outbox rows with eventKey + payload
function makeStatusRow(targetStatus: string, id = 1) {
  return {
    id,
    organizationId: "org-1",
    unitId: null,
    serviceOrderId: 10,
    targetStatus,
    eventKey: `status_email:${targetStatus}`,
    payload: { status: targetStatus },
    attempts: 0,
  };
}

function makeNovaOsRow(overridePayload?: Record<string, unknown>, id = 1) {
  const payload: Record<string, unknown> = overridePayload ?? {
    serviceOrderId: 10,
    serviceOrderNumber: "OS-2026-TEST",
    organizationId: "org-1",
    publicId: "pub-test-1",
    customerId: 99,
    clientContactSnapshot: null,
    customerName: "Empresa Teste SA",
    customerEmail: "cliente@example.com",
    assetManufacturer: "Acme",
    assetModel: "X-100",
    assetSerialNumber: "SN-999",
    openedAt: "2026-06-01T00:00:00.000Z",
    claimedDefect: "Sensor fault",
  };
  return {
    id,
    organizationId: "org-1",
    unitId: null,
    serviceOrderId: 10,
    targetStatus: "opened",
    eventKey: "nova_os",
    payload,
    attempts: 0,
  };
}

function makeOrcamentoSentRow(
  quoteId: number,
  overridePayload?: Record<string, unknown>,
  id = 1,
) {
  const payload: Record<string, unknown> = overridePayload ?? {
    serviceOrderId: 10,
    quoteId,
    serviceOrderNumber: "OS-2026-TEST",
    organizationId: "org-1",
    publicId: "pub-test-1",
    customerId: 99,
    clientContactSnapshot: null,
    customerName: "Empresa Teste SA",
    customerEmail: "cliente@example.com",
    openedAt: "2026-06-01T00:00:00.000Z",
    claimedDefect: "Sensor fault",
    items: [],
    subtotalServicesCents: 10000,
    subtotalPartsCents: 5000,
    freightCents: 0,
    discountCents: 0,
    totalCents: 15000,
    publicAccessToken: "tok-abc",
    approvalCode: "K7WM3P9A",
    portalAppUrl: "https://portal.calibrafacil.com",
  };
  return {
    id,
    organizationId: "org-1",
    unitId: null,
    serviceOrderId: 10,
    targetStatus: "quote_sent",
    eventKey: `orcamento_sent:${quoteId}`,
    payload,
    attempts: 0,
  };
}

function makeQuoteApprovedRow(
  quoteId: number,
  overridePayload?: Record<string, unknown>,
  id = 1,
) {
  const payload: Record<string, unknown> = overridePayload ?? {
    serviceOrderId: 10,
    quoteId,
    serviceOrderNumber: "OS-2026-TEST",
    organizationId: "org-1",
    publicId: "pub-test-1",
    customerId: 99,
    clientContactSnapshot: null,
    customerName: "Empresa Teste SA",
    customerEmail: "cliente@example.com",
    totalApprovedCents: 15000,
  };
  return {
    id,
    organizationId: "org-1",
    unitId: null,
    serviceOrderId: 10,
    targetStatus: "quote_approved",
    eventKey: `quote_approved:${quoteId}`,
    payload,
    attempts: 0,
  };
}

function makeQuoteRejectedRow(
  quoteId: number,
  overridePayload?: Record<string, unknown>,
  id = 1,
) {
  const payload: Record<string, unknown> = overridePayload ?? {
    serviceOrderId: 10,
    quoteId,
    serviceOrderNumber: "OS-2026-TEST",
    organizationId: "org-1",
    publicId: "pub-test-1",
    customerId: 99,
    clientContactSnapshot: null,
    customerName: "Empresa Teste SA",
    customerEmail: "cliente@example.com",
    rejectionReason: "Too expensive",
  };
  return {
    id,
    organizationId: "org-1",
    unitId: null,
    serviceOrderId: 10,
    targetStatus: "quote_rejected",
    eventKey: `quote_rejected:${quoteId}`,
    payload,
    attempts: 0,
  };
}

function claimSucceeds(id: number) {
  mockExecute.mockResolvedValueOnce({ rows: [{ id }] });
}

function claimConflicts() {
  mockExecute.mockResolvedValueOnce({ rows: [] });
}

// After a terminal success/graceful-skip the drain issues a markOutboxRowProcessed
// UPDATE (one extra db.execute). In a multi-row batch this call sits between one
// row's claim and the next row's claim, so it must be queued to keep the
// execute() mock sequence aligned. Return value is irrelevant.
function markProcessedSucceeds() {
  mockExecute.mockResolvedValueOnce({ rows: [] });
}

// SO re-load for the status_email path (still needed for regression tests)
function soReloadSucceeds() {
  mockExecute.mockResolvedValueOnce({
    rows: [
      {
        id: 10,
        public_id: "pub-abc",
        organization_id: "org-1",
        customer_id: 99,
        service_order_number: "OS-2026-100",
        client_contact_snapshot: null,
      },
    ],
  });
}

const SAMPLE_CUSTOMER = {
  id: 99,
  name: "Empresa Teste SA",
  email: "empresa@example.com",
};

function sendEmailCallingRender(
  returnVal: unknown = { sent: true, emailId: "ok" },
) {
  mockSendEmail.mockImplementationOnce(
    async (input: { renderEmail: (ctx: unknown) => unknown }) => {
      input.renderEmail({ brand: undefined });
      return returnVal;
    },
  );
}

function releaseSucceeds() {
  mockExecute.mockResolvedValueOnce({ rows: [] });
}

// =============================================================================
// Tests
// =============================================================================

describe("mini-spec I drain: B/C/D routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelectFn._reset();
    mockDbInsertFn._reset();
    mockGetLabEmailBrand.mockResolvedValue(undefined);
    mockSendEmail.mockResolvedValue({ sent: true, emailId: "e-1" });
    // Default: sendServiceOrderEmailOnce calls dispatch
    mockSendOnce.mockImplementation(
      async (input: { dispatch: () => Promise<unknown> }) => {
        await input.dispatch();
      },
    );
  });

  // ---------------------------------------------------------------------------
  // REQ-SOEMAIL-073: nova_os routes to dispatchNovaOsEmail
  // ---------------------------------------------------------------------------

  describe("REQ-SOEMAIL-073 (nova_os): routes to dispatchNovaOsEmail via sendServiceOrderEmailOnce", () => {
    it("REQ-SOEMAIL-073/nova_os: row with eventKey='nova_os' calls dispatchNovaOsEmail, NOT other dispatchers", async () => {
      const row = makeNovaOsRow();
      enqueueSelects([row]);
      claimSucceeds(row.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(result.sent).toBe(1);
      expect(mockDispatchNovaOs).toHaveBeenCalledTimes(1);
      expect(mockDispatchNovoOrcamento).not.toHaveBeenCalled();
      expect(mockDispatchOrcamentoAprovado).not.toHaveBeenCalled();
      expect(mockDispatchOrcamentoRecusado).not.toHaveBeenCalled();
      // Must be wrapped in sendServiceOrderEmailOnce
      expect(mockSendOnce).toHaveBeenCalledTimes(1);
      expect(mockSendOnce).toHaveBeenCalledWith(
        expect.objectContaining({ serviceOrderId: 10, eventKey: "nova_os" }),
      );
    });

    it("REQ-SOEMAIL-073/nova_os: payload fields flow into dispatchNovaOsEmail (garbling OS number → RED)", async () => {
      const row = makeNovaOsRow();
      enqueueSelects([row]);
      claimSucceeds(row.id);

      await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockDispatchNovaOs).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceOrderNumber: "OS-2026-TEST",
          customerName: "Empresa Teste SA",
          claimedDefect: "Sensor fault",
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-SOEMAIL-073: orcamento_sent:* routes to dispatchNovoOrcamentoEmail
  // ---------------------------------------------------------------------------

  describe("REQ-SOEMAIL-073 (orcamento_sent): routes to dispatchNovoOrcamentoEmail", () => {
    it("REQ-SOEMAIL-073/orcamento_sent: row with eventKey='orcamento_sent:42' calls dispatchNovoOrcamentoEmail", async () => {
      const row = makeOrcamentoSentRow(42);
      enqueueSelects([row]);
      claimSucceeds(row.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(result.sent).toBe(1);
      expect(mockDispatchNovoOrcamento).toHaveBeenCalledTimes(1);
      expect(mockDispatchNovaOs).not.toHaveBeenCalled();
      expect(mockDispatchOrcamentoAprovado).not.toHaveBeenCalled();
      expect(mockDispatchOrcamentoRecusado).not.toHaveBeenCalled();
      expect(mockSendOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceOrderId: 10,
          eventKey: "orcamento_sent:42",
        }),
      );
    });

    it("REQ-SOEMAIL-073/orcamento_sent: payload fields (totalCents, quoteId, publicAccessToken) flow in", async () => {
      const row = makeOrcamentoSentRow(42);
      enqueueSelects([row]);
      claimSucceeds(row.id);

      await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockDispatchNovoOrcamento).toHaveBeenCalledWith(
        expect.objectContaining({
          quoteId: 42,
          totalCents: 15000,
          publicAccessToken: "tok-abc",
          // REQ-QPUB-020/021: the captured code flows through unchanged.
          approvalCode: "K7WM3P9A",
          serviceOrderNumber: "OS-2026-TEST",
        }),
      );
    });

    it("REQ-QPUB-020 (transitional): a legacy row WITHOUT approvalCode still sends, code null", async () => {
      const row = makeOrcamentoSentRow(42);
      const legacyPayload = { ...row.payload };
      delete legacyPayload.approvalCode;
      const legacyRow = { ...row, payload: legacyPayload };
      enqueueSelects([legacyRow]);
      claimSucceeds(legacyRow.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(result.sent).toBe(1);
      expect(mockDispatchNovoOrcamento).toHaveBeenCalledWith(
        expect.objectContaining({ approvalCode: null }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-SOEMAIL-073: quote_approved:* routes to dispatchOrcamentoAprovadoEmail
  // ---------------------------------------------------------------------------

  describe("REQ-SOEMAIL-073 (quote_approved): routes to dispatchOrcamentoAprovadoEmail", () => {
    it("REQ-SOEMAIL-073/quote_approved: row with eventKey='quote_approved:7' calls dispatchOrcamentoAprovadoEmail", async () => {
      const row = makeQuoteApprovedRow(7);
      enqueueSelects([row]);
      claimSucceeds(row.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(result.sent).toBe(1);
      expect(mockDispatchOrcamentoAprovado).toHaveBeenCalledTimes(1);
      expect(mockDispatchNovaOs).not.toHaveBeenCalled();
      expect(mockDispatchNovoOrcamento).not.toHaveBeenCalled();
      expect(mockDispatchOrcamentoRecusado).not.toHaveBeenCalled();
      expect(mockSendOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceOrderId: 10,
          eventKey: "quote_approved:7",
        }),
      );
    });

    it("REQ-SOEMAIL-073/quote_approved: totalApprovedCents from payload flows into dispatcher", async () => {
      const row = makeQuoteApprovedRow(7);
      enqueueSelects([row]);
      claimSucceeds(row.id);

      await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockDispatchOrcamentoAprovado).toHaveBeenCalledWith(
        expect.objectContaining({
          quoteId: 7,
          totalApprovedCents: 15000,
          serviceOrderNumber: "OS-2026-TEST",
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-SOEMAIL-073: quote_rejected:* routes to dispatchOrcamentoRecusadoEmail
  // ---------------------------------------------------------------------------

  describe("REQ-SOEMAIL-073 (quote_rejected): routes to dispatchOrcamentoRecusadoEmail", () => {
    it("REQ-SOEMAIL-073/quote_rejected: row with eventKey='quote_rejected:5' calls dispatchOrcamentoRecusadoEmail", async () => {
      const row = makeQuoteRejectedRow(5);
      enqueueSelects([row]);
      claimSucceeds(row.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(result.sent).toBe(1);
      expect(mockDispatchOrcamentoRecusado).toHaveBeenCalledTimes(1);
      expect(mockDispatchNovaOs).not.toHaveBeenCalled();
      expect(mockDispatchNovoOrcamento).not.toHaveBeenCalled();
      expect(mockDispatchOrcamentoAprovado).not.toHaveBeenCalled();
      expect(mockSendOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceOrderId: 10,
          eventKey: "quote_rejected:5",
        }),
      );
    });

    it("REQ-SOEMAIL-073/quote_rejected: rejectionReason from payload flows into dispatcher", async () => {
      const row = makeQuoteRejectedRow(5);
      enqueueSelects([row]);
      claimSucceeds(row.id);

      await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockDispatchOrcamentoRecusado).toHaveBeenCalledWith(
        expect.objectContaining({
          quoteId: 5,
          rejectionReason: "Too expensive",
          serviceOrderNumber: "OS-2026-TEST",
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // MUTATION CHECK: swapping two namespace routings → RED
  //
  // If nova_os mistakenly routes to dispatchNovoOrcamentoEmail and
  // orcamento_sent routes to dispatchNovaOsEmail, the assertions on
  // mockDispatchNovaOs / mockDispatchNovoOrcamento counts go RED.
  // ---------------------------------------------------------------------------

  describe("Mutation guard: swapped routing goes RED", () => {
    it("nova_os row calls dispatchNovaOs, orcamento_sent row calls dispatchNovoOrcamento (swap would fail)", async () => {
      const novaOsRow = makeNovaOsRow(undefined, 1);
      const orcamentoRow = makeOrcamentoSentRow(42, undefined, 2);

      enqueueSelects([novaOsRow, orcamentoRow]);
      claimSucceeds(1);
      markProcessedSucceeds(); // row 1 marked done before row 2 is claimed
      claimSucceeds(2);

      await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockDispatchNovaOs).toHaveBeenCalledTimes(1);
      expect(mockDispatchNovoOrcamento).toHaveBeenCalledTimes(1);
      // Each called for the right row (check the serviceOrderNumber in the call)
      expect(mockDispatchNovaOs.mock.calls[0]?.[0]).toMatchObject({
        serviceOrderNumber: "OS-2026-TEST",
        claimedDefect: "Sensor fault",
      });
      expect(mockDispatchNovoOrcamento.mock.calls[0]?.[0]).toMatchObject({
        quoteId: 42,
        totalCents: 15000,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-SOEMAIL-074: idempotency via sendServiceOrderEmailOnce
  //
  // If sendServiceOrderEmailOnce does NOT call dispatch() (simulating already-sent),
  // the dispatch helper is not invoked but the row is still marked processed.
  // ---------------------------------------------------------------------------

  describe("REQ-SOEMAIL-074: idempotency — sendServiceOrderEmailOnce skips dispatch when key recorded", () => {
    it("when sendServiceOrderEmailOnce does not call dispatch (key already recorded), dispatchNovaOs is NOT called", async () => {
      // Simulate already-sent: sendServiceOrderEmailOnce is a no-op (does not call dispatch)
      mockSendOnce.mockImplementationOnce(async (_input: unknown) => {
        // do NOT call input.dispatch
      });

      const row = makeNovaOsRow();
      enqueueSelects([row]);
      claimSucceeds(row.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      // Row is processed (claimed) but dispatch was not called
      expect(result.processed).toBe(1);
      expect(mockDispatchNovaOs).not.toHaveBeenCalled();
      // result.sent should be 1 because sendServiceOrderEmailOnce itself returned
      // (the row is "handled" from the drain's perspective)
      expect(result.sent).toBe(1);
    });

    it("idempotency also works for orcamento_sent: sendServiceOrderEmailOnce skip leaves dispatchNovoOrcamento un-called", async () => {
      mockSendOnce.mockImplementationOnce(async (_input: unknown) => {
        // no-op: already sent
      });

      const row = makeOrcamentoSentRow(42);
      enqueueSelects([row]);
      claimSucceeds(row.id);

      await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockDispatchNovoOrcamento).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Payload validation: malformed payload → graceful skip, no crash, no dispatch
  // ---------------------------------------------------------------------------

  describe("Payload validation: malformed payload skips without crash", () => {
    it("nova_os row with empty payload does NOT call dispatchNovaOs and does NOT crash the batch", async () => {
      const malformedRow = makeNovaOsRow({}); // missing required fields
      enqueueSelects([malformedRow]);
      claimSucceeds(malformedRow.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockDispatchNovaOs).not.toHaveBeenCalled();
      expect(result.errors).toBe(0);
      // Row is skipped gracefully (not released as a send failure)
    });

    it("orcamento_sent row with missing totalCents does NOT call dispatchNovoOrcamento", async () => {
      const badPayload: Record<string, unknown> = {
        serviceOrderId: 10,
        quoteId: 42,
        // missing required fields like totalCents, customerName, etc.
      };
      const malformedRow = makeOrcamentoSentRow(42, badPayload);
      enqueueSelects([malformedRow]);
      claimSucceeds(malformedRow.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockDispatchNovoOrcamento).not.toHaveBeenCalled();
      expect(result.errors).toBe(0);
    });

    it("quote_approved row with missing totalApprovedCents does NOT call dispatchOrcamentoAprovado", async () => {
      const badPayload: Record<string, unknown> = {
        serviceOrderId: 10,
        quoteId: 7,
        // missing totalApprovedCents and other required fields
      };
      const malformedRow = makeQuoteApprovedRow(7, badPayload);
      enqueueSelects([malformedRow]);
      claimSucceeds(malformedRow.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockDispatchOrcamentoAprovado).not.toHaveBeenCalled();
      expect(result.errors).toBe(0);
    });

    it("quote_rejected row with missing serviceOrderNumber does NOT call dispatchOrcamentoRecusado", async () => {
      const badPayload: Record<string, unknown> = {
        serviceOrderId: 10,
        quoteId: 5,
        // missing serviceOrderNumber etc.
      };
      const malformedRow = makeQuoteRejectedRow(5, badPayload);
      enqueueSelects([malformedRow]);
      claimSucceeds(malformedRow.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockDispatchOrcamentoRecusado).not.toHaveBeenCalled();
      expect(result.errors).toBe(0);
    });

    it("a malformed-payload row in a batch does NOT prevent subsequent rows from being processed", async () => {
      const malformedRow = makeNovaOsRow({}, 1); // bad payload
      const goodRow = makeQuoteApprovedRow(7, undefined, 2);

      enqueueSelects([malformedRow, goodRow]);
      claimSucceeds(1);
      markProcessedSucceeds(); // malformed row gracefully marked done
      claimSucceeds(2);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      // Good row still processed
      expect(mockDispatchOrcamentoAprovado).toHaveBeenCalledTimes(1);
      expect(result.errors).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-SOEMAIL-075: tenant isolation
  //
  // The payload is org-owned by construction. The drain must not load data
  // across org boundaries. The status_email path has organization_id in the
  // SQL predicate; the B/C/D path uses payload fields (which are org-scoped
  // because the enqueuer stored them that way). The organizationId in the payload
  // must match the row's organizationId (or be absent for the status path).
  // ---------------------------------------------------------------------------

  describe("REQ-SOEMAIL-075: tenant isolation for B/C/D path", () => {
    it("nova_os dispatch receives organizationId from payload (no cross-org data)", async () => {
      const row = makeNovaOsRow();
      enqueueSelects([row]);
      claimSucceeds(row.id);

      await drainServiceOrderEmailOutbox({ batchSize: 10 });

      // dispatchNovaOsEmail must receive organizationId from the payload (org-1)
      expect(mockDispatchNovaOs).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
      );
      // It must NOT receive a different org's data
      const call = mockDispatchNovaOs.mock.calls[0]?.[0];
      expect(call).toBeDefined();
      if (
        call !== undefined &&
        typeof call === "object" &&
        "organizationId" in call
      ) {
        expect(call.organizationId).toBe("org-1");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Regression: status_email:* path still works (existing tests style)
  // ---------------------------------------------------------------------------

  describe("Regression: status_email:* path still routes to status templates", () => {
    it("status_email:repair_in_progress still sends via the status path (no B/C/D dispatchers called)", async () => {
      const row = makeStatusRow("repair_in_progress");
      enqueueSelects([row], [SAMPLE_CUSTOMER]);
      claimSucceeds(row.id);
      soReloadSucceeds();
      sendEmailCallingRender();

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(result.sent).toBe(1);
      expect(mockServicoIniciado).toHaveBeenCalledTimes(1);
      expect(mockDispatchNovaOs).not.toHaveBeenCalled();
      expect(mockDispatchNovoOrcamento).not.toHaveBeenCalled();
      expect(mockDispatchOrcamentoAprovado).not.toHaveBeenCalled();
      expect(mockDispatchOrcamentoRecusado).not.toHaveBeenCalled();
      // Status path now ALSO routes through the at-most-once ledger
      // (sendServiceOrderEmailOnce) — same as B/C/D — so a lease-reclaimed,
      // already-sent status email is deduped instead of re-sent.
      expect(mockSendOnce).toHaveBeenCalledTimes(1);
      expect(mockSendOnce.mock.calls[0]?.[0]).toMatchObject({
        eventKey: "status_email:repair_in_progress",
      });
    });

    it("status_email:delivered still routes to the status path without calling B/C/D helpers", async () => {
      const row = makeStatusRow("delivered");
      enqueueSelects([row], [SAMPLE_CUSTOMER]);
      claimSucceeds(row.id);
      soReloadSucceeds();
      sendEmailCallingRender({ sent: true });

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(result.sent).toBe(1);
      expect(mockDispatchNovaOs).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-QPUB-008 [HIGH RISK]: credential redaction on the sent-marking UPDATE
  // ---------------------------------------------------------------------------

  describe("REQ-QPUB-008: raw credentials are redacted when an orcamento_sent row is marked sent", () => {
    // The mocked `sql` tag returns { _sql: true, _sqlText: strings.join("?") },
    // so the template text of the LAST db.execute (the processed UPDATE that
    // follows the claim) is directly assertable — same convention as the
    // dead-letter SQL-text tests in service-order-email-drain.spec.ts.
    function lastExecuteSqlText(): string {
      const calls = mockExecute.mock.calls;
      const lastArg: unknown = calls[calls.length - 1]?.[0];
      const sqlText: unknown =
        typeof lastArg === "object" && lastArg !== null
          ? Reflect.get(lastArg, "_sqlText")
          : undefined;
      expect(typeof sqlText).toBe("string");
      return String(sqlText).toLowerCase();
    }

    it("orcamento_sent success marks processed AND jsonb_set-redacts publicAccessToken + approvalCode in one statement", async () => {
      const row = makeOrcamentoSentRow(42);
      enqueueSelects([row]);
      claimSucceeds(row.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(result.sent).toBe(1);
      const text = lastExecuteSqlText();
      expect(text).toContain("processed_at = now()");
      expect(text).toContain("jsonb_set");
      expect(text).toContain("publicaccesstoken");
      expect(text).toContain("approvalcode");
      expect(text).toContain("[redacted]");
    });

    it("non-credential namespaces (nova_os) mark processed WITHOUT touching the payload", async () => {
      const row = makeNovaOsRow();
      enqueueSelects([row]);
      claimSucceeds(row.id);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(result.sent).toBe(1);
      const text = lastExecuteSqlText();
      expect(text).toContain("processed_at = now()");
      expect(text).not.toContain("jsonb_set");
    });

    it("a FAILED orcamento_sent dispatch is released with its payload intact (no redaction on retryable rows)", async () => {
      const row = makeOrcamentoSentRow(42);
      enqueueSelects([row]);
      claimSucceeds(row.id);
      // Real sendServiceOrderEmailOnce maps a sent:false dispatch to "failed";
      // the drain must release (not process/redact) such rows.
      mockSendOnce.mockImplementationOnce(
        async (input: { dispatch: () => Promise<unknown> }) => {
          await input.dispatch();
          return "failed";
        },
      );

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(result.released).toBe(1);
      expect(result.sent).toBe(0);
      const text = lastExecuteSqlText();
      expect(text).toContain("attempts = attempts + 1");
      expect(text).not.toContain("jsonb_set");
    });
  });
});

// =============================================================================
// enqueueServiceOrderEmail tests
// =============================================================================

describe("enqueueServiceOrderEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsertFn._reset();
  });

  it("inserts a row into serviceOrderEmailOutbox using the PASSED executor (tx), not the module-level db", async () => {
    // Build a mock tx with the same shape as the enqueue helper expects
    const txInserts: Array<{
      table: unknown;
      values: unknown;
      conflictTarget: unknown;
    }> = [];

    function makeTxInsertChain(table: unknown) {
      return {
        values: vi.fn((row: unknown) => ({
          onConflictDoNothing: vi.fn((opts: unknown) => {
            txInserts.push({ table, values: row, conflictTarget: opts });
            return Promise.resolve();
          }),
        })),
      };
    }

    const tx = {
      insert: vi.fn((table: unknown) => makeTxInsertChain(table)),
      select: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    await enqueueServiceOrderEmail(
      {
        organizationId: "org-tx",
        unitId: 5,
        serviceOrderId: 77,
        eventKey: "nova_os",
        targetStatus: "opened",
        payload: {
          serviceOrderId: 77,
          serviceOrderNumber: "OS-2026-TX",
          organizationId: "org-tx",
          publicId: "pub-tx",
          customerId: 11,
          clientContactSnapshot: null,
          customerName: "TX Empresa",
          customerEmail: "tx@example.com",
          assetManufacturer: null,
          assetModel: null,
          assetSerialNumber: null,
          openedAt: "2026-06-01T00:00:00.000Z",
          claimedDefect: "N/A",
        },
      },
      tx,
    );

    // Must use tx.insert, NOT the module-level db.insert
    expect(tx.insert).toHaveBeenCalledTimes(1);
    // The module-level db.insert must NOT have been called
    expect(mockDbInsertFn).not.toHaveBeenCalled();

    expect(txInserts).toHaveLength(1);
    const row = txInserts[0];
    expect(row).toBeDefined();
    expect(row?.table).toBe(serviceOrderEmailOutbox);
  });

  it("inserts with the correct eventKey and payload", async () => {
    const txInserts: Array<{
      table: unknown;
      values: unknown;
      conflictTarget: unknown;
    }> = [];

    const tx = {
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((row: unknown) => ({
          onConflictDoNothing: vi.fn((opts: unknown) => {
            txInserts.push({ table, values: row, conflictTarget: opts });
            return Promise.resolve();
          }),
        })),
      })),
      select: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const payload = {
      serviceOrderId: 42,
      quoteId: 99,
      serviceOrderNumber: "OS-2026-042",
      organizationId: "org-enq",
      publicId: "pub-enq",
      customerId: 7,
      clientContactSnapshot: null,
      customerName: "Enq Empresa",
      customerEmail: "enq@example.com",
      openedAt: "2026-01-15T00:00:00.000Z",
      claimedDefect: "Test",
      items: [],
      subtotalServicesCents: 500,
      subtotalPartsCents: 0,
      freightCents: 0,
      discountCents: 0,
      totalCents: 500,
      publicAccessToken: "tok-enq",
      portalAppUrl: "https://portal.example.com",
    };

    await enqueueServiceOrderEmail(
      {
        organizationId: "org-enq",
        unitId: null,
        serviceOrderId: 42,
        eventKey: "orcamento_sent:99",
        targetStatus: "quote_sent",
        payload,
      },
      tx,
    );

    expect(txInserts).toHaveLength(1);
    const insertedRow = txInserts[0]?.values;
    expect(insertedRow).toMatchObject({
      organizationId: "org-enq",
      serviceOrderId: 42,
      eventKey: "orcamento_sent:99",
      targetStatus: "quote_sent",
    });
    // conflict target must be defined (onConflictDoNothing with target)
    expect(txInserts[0]?.conflictTarget).toBeDefined();
  });

  it("uses onConflictDoNothing (mutation: switching to default db → txInserts empty → test RED)", async () => {
    // This test proves the executor param is REQUIRED for tx-scoped enqueue.
    // If production code used the module-level db instead of the executor arg,
    // txInserts would be empty and the assertions below go RED.
    const txInserts: Array<{
      table: unknown;
      values: unknown;
      conflictTarget: unknown;
    }> = [];
    const tx = {
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((row: unknown) => ({
          onConflictDoNothing: vi.fn((opts: unknown) => {
            txInserts.push({ table, values: row, conflictTarget: opts });
            return Promise.resolve();
          }),
        })),
      })),
      select: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    await enqueueServiceOrderEmail(
      {
        organizationId: "org-1",
        unitId: null,
        serviceOrderId: 10,
        eventKey: "nova_os",
        targetStatus: "opened",
        payload: {
          serviceOrderId: 10,
          serviceOrderNumber: "OS-2026-001",
          organizationId: "org-1",
          publicId: "pub-1",
          customerId: 5,
          clientContactSnapshot: null,
          customerName: "Test",
          customerEmail: null,
          assetManufacturer: null,
          assetModel: null,
          assetSerialNumber: null,
          openedAt: "2026-01-01T00:00:00.000Z",
          claimedDefect: "Test defect",
        },
      },
      tx,
    );

    // Proves executor is used — if switched to db, this would be empty
    expect(txInserts).toHaveLength(1);
    // And the insert was NOT done via the module-level mock
    expect(mockDbInsertFn).not.toHaveBeenCalled();
  });
});
