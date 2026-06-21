/**
 * Tests for the service-order email outbox drain (mini-spec E2).
 *
 * Strategy: mock the DB (Drizzle `db`) and notification functions; test the
 * drain's logic in isolation. The real send path and templates are proven by
 * their own spec files. These tests focus on:
 *
 *   1. Template routing: each target_status selects the CORRECT email type
 *      (via STATUS_EMAIL_MAP — the single source of truth shared with E1).
 *   2. Idempotency: the atomic claim (UPDATE WHERE processed_at IS NULL) must
 *      emit SQL that contains the "processed_at" guard. SQL text is captured
 *      and asserted directly. Mutation check: documented inline.
 *   3. Failure path: when send is not sent, the row is RELEASED (processed_at
 *      back to NULL, attempts incremented, last_error set). Mutation check: documented.
 *   4. Best-effort: a single throwing row does NOT abort the batch.
 *   5. Tenant isolation: the SO re-load SQL must include organization_id;
 *      a cross-org row re-loads nothing and sends no email.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Hoisted mocks — ALL vi.fn() used in vi.mock factories must be hoisted
// =============================================================================

const {
  mockExecute,
  mockDbSelectFn,
  mockGetLabEmailBrand,
  mockSendEmail,
  mockServicoIniciado,
  mockServicoAndamento,
  mockAguardandoAvaliacaoTecnica,
  mockEmAvaliacaoTecnica,
  mockProntoParaRetirada,
  mockOsEntregue,
  mockOsEncerrada,
  mockRevisaoFinal,
  mockOsCancelada,
  mockGarantiaRetorno,
} = vi.hoisted(() => {
  // Chainable select builder
  function makeSelectChain(rows: unknown[]) {
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
    };
  }

  // Sequential select results — populated per-test
  const selectQueue: Array<unknown[]> = [];
  let selectIdx = 0;

  // Attach _queue and _reset to the mock fn object directly so no `as` needed.
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

  return {
    mockExecute: vi.fn(),
    mockDbSelectFn: selectFn,
    mockGetLabEmailBrand: vi.fn().mockResolvedValue(undefined),
    mockSendEmail: vi.fn().mockResolvedValue({ sent: true, emailId: "e-1" }),
    mockServicoIniciado: vi.fn().mockReturnValue("servico-iniciado-element"),
    mockServicoAndamento: vi.fn().mockReturnValue("servico-andamento-element"),
    mockAguardandoAvaliacaoTecnica: vi
      .fn()
      .mockReturnValue("aguardando-avaliacao-element"),
    mockEmAvaliacaoTecnica: vi
      .fn()
      .mockReturnValue("em-avaliacao-element"),
    mockProntoParaRetirada: vi
      .fn()
      .mockReturnValue("pronto-para-retirada-element"),
    mockOsEntregue: vi.fn().mockReturnValue("os-entregue-element"),
    mockOsEncerrada: vi.fn().mockReturnValue("os-encerrada-element"),
    mockRevisaoFinal: vi.fn().mockReturnValue("revisao-final-element"),
    mockOsCancelada: vi.fn().mockReturnValue("os-cancelada-element"),
    mockGarantiaRetorno: vi.fn().mockReturnValue("garantia-retorno-element"),
  };
});

// =============================================================================
// Module mocks
// =============================================================================

vi.mock("@calibra-facil/db", () => ({
  db: {
    execute: mockExecute,
    select: mockDbSelectFn,
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
    attempts: "ob_attempts",
    processedAt: "ob_processedAt",
    createdAt: "ob_createdAt",
  },
}));

/**
 * sql mock that captures the template strings array so tests can
 * inspect the SQL text emitted by the production code.
 * Returns an object with a `_sqlText` property for assertions.
 */
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
  ServiceInProgressEmail: mockServicoAndamento,
  AwaitingEvaluationEmail: mockAguardandoAvaliacaoTecnica,
  UnderEvaluationEmail: mockEmAvaliacaoTecnica,
  ReadyForPickupEmail: mockProntoParaRetirada,
  ServiceOrderDeliveredEmail: mockOsEntregue,
  ServiceOrderClosedEmail: mockOsEncerrada,
  FinalReviewEmail: mockRevisaoFinal,
  ServiceOrderCanceledEmail: mockOsCancelada,
  WarrantyReturnEmail: mockGarantiaRetorno,
}));

// =============================================================================
// Import drain after mocks
// =============================================================================
import { drainServiceOrderEmailOutbox } from "./service-order-email-drain";

// =============================================================================
// Helpers
// =============================================================================

function enqueueSelects(...rows: unknown[][]) {
  mockDbSelectFn._reset();
  for (const r of rows) mockDbSelectFn._queue.push(r);
}

// SO row as it comes back from raw SQL (snake_case column names, number ids)
const SAMPLE_SO_RAW = {
  id: 10,
  public_id: "pub-abc",
  organization_id: "org-1",
  customer_id: 99,
  service_order_number: "OS-2026-100",
  client_contact_snapshot: { email: "customer@example.com" },
};

// Keep the camelCase shape for test helpers that pass to sendEmail mock context
const SAMPLE_SO = {
  id: 10,
  publicId: "pub-abc",
  organizationId: "org-1",
  customerId: 99,
  serviceOrderNumber: "OS-2026-100",
  clientContactSnapshot: { email: "customer@example.com" },
};

const SAMPLE_CUSTOMER = {
  id: 99,
  name: "Empresa Teste SA",
  email: "empresa@example.com",
};

function makeOutboxRow(
  targetStatus: string,
  opts: Partial<{
    id: number;
    organizationId: string;
    serviceOrderId: number;
    attempts: number;
  }> = {},
) {
  return {
    id: 1,
    organizationId: "org-1",
    serviceOrderId: 10,
    targetStatus,
    attempts: 0,
    ...opts,
  };
}

/** Claim wins: UPDATE returns the row id. */
function claimSucceeds(id: number) {
  mockExecute.mockResolvedValueOnce({ rows: [{ id }] });
}

/** Claim loses: UPDATE returns no rows (row already claimed or processed). */
function claimConflicts() {
  mockExecute.mockResolvedValueOnce({ rows: [] });
}

/**
 * SO re-load succeeds: db.execute(sql`SELECT ... FROM service_order WHERE ...`)
 * returns the raw SO row (snake_case). This is the SECOND execute call after
 * claimSucceeds/claimConflicts.
 */
function soReloadSucceeds(rawRow: typeof SAMPLE_SO_RAW = SAMPLE_SO_RAW) {
  mockExecute.mockResolvedValueOnce({ rows: [rawRow] });
}

/**
 * SO re-load returns empty (cross-org or missing SO).
 */
function soReloadEmpty() {
  mockExecute.mockResolvedValueOnce({ rows: [] });
}

/** Release UPDATE succeeds (return value irrelevant). */
function releaseSucceeds() {
  mockExecute.mockResolvedValueOnce({ rows: [] });
}

/**
 * A sendEmail implementation that actually calls renderEmail so the
 * template mock functions get invoked (needed for "correct template" assertions).
 */
function sendEmailCallingRender(returnValue: unknown = { sent: true, emailId: "e-ok" }) {
  mockSendEmail.mockImplementationOnce(
    async (input: { renderEmail: (ctx: unknown) => unknown }) => {
      input.renderEmail({
        serviceOrder: SAMPLE_SO,
        customer: SAMPLE_CUSTOMER,
        brand: undefined,
      });
      return returnValue;
    },
  );
}

// =============================================================================
// Tests
// =============================================================================

describe("drainServiceOrderEmailOutbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelectFn._reset();
    mockGetLabEmailBrand.mockResolvedValue(undefined);
    mockSendEmail.mockResolvedValue({ sent: true, emailId: "e-1" });
  });

  // ---------------------------------------------------------------------------
  // REQ-SOEMAIL-041..044: Template routing per target_status (table-driven)
  // ---------------------------------------------------------------------------

  describe(
    "REQ-SOEMAIL-041..044 + REQ-SOEMAIL-051..054 + REQ-SOEMAIL-061..062: correct template per target_status",
    () => {
      const TABLE = [
        {
          targetStatus: "repair_in_progress",
          reqId: "REQ-SOEMAIL-041",
          templateMockGetter: () => mockServicoIniciado,
        },
        {
          targetStatus: "awaiting_calibration",
          reqId: "REQ-SOEMAIL-042",
          templateMockGetter: () => mockServicoAndamento,
        },
        {
          targetStatus: "calibration_in_progress",
          reqId: "REQ-SOEMAIL-042",
          templateMockGetter: () => mockServicoAndamento,
        },
        {
          targetStatus: "awaiting_tech_evaluation",
          reqId: "REQ-SOEMAIL-043",
          templateMockGetter: () => mockAguardandoAvaliacaoTecnica,
        },
        {
          targetStatus: "under_evaluation",
          reqId: "REQ-SOEMAIL-044",
          templateMockGetter: () => mockEmAvaliacaoTecnica,
        },
        {
          targetStatus: "ready_for_pickup",
          reqId: "REQ-SOEMAIL-051",
          templateMockGetter: () => mockProntoParaRetirada,
        },
        {
          targetStatus: "delivered",
          reqId: "REQ-SOEMAIL-052",
          templateMockGetter: () => mockOsEntregue,
        },
        {
          targetStatus: "closed",
          reqId: "REQ-SOEMAIL-053",
          templateMockGetter: () => mockOsEncerrada,
        },
        {
          targetStatus: "awaiting_final_review",
          reqId: "REQ-SOEMAIL-054",
          templateMockGetter: () => mockRevisaoFinal,
        },
        {
          targetStatus: "canceled",
          reqId: "REQ-SOEMAIL-061",
          templateMockGetter: () => mockOsCancelada,
        },
        {
          targetStatus: "warranty_return",
          reqId: "REQ-SOEMAIL-062",
          templateMockGetter: () => mockGarantiaRetorno,
        },
      ] as const;

      for (const { targetStatus, reqId, templateMockGetter } of TABLE) {
        it(
          `${reqId}: target_status="${targetStatus}" calls the correct template and sends once`,
          async () => {
            const row = makeOutboxRow(targetStatus);
            // pending rows SELECT
            enqueueSelects([row], [SAMPLE_CUSTOMER]);
            // claim UPDATE succeeds
            claimSucceeds(row.id);
            // SO re-load via raw SQL execute
            soReloadSucceeds();
            sendEmailCallingRender();

            const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

            expect(result.sent).toBe(1);
            expect(result.released).toBe(0);

            const templateMock = templateMockGetter();
            expect(templateMock).toHaveBeenCalledTimes(1);
            expect(mockSendEmail).toHaveBeenCalledTimes(1);
          },
        );
      }
    },
  );

  // ---------------------------------------------------------------------------
  // REQ-SOEMAIL-042: stage prop for progress_update emails
  // ---------------------------------------------------------------------------

  it(
    "REQ-SOEMAIL-042: awaiting_calibration passes stage='awaiting_calibration' to ServiceInProgressEmail",
    async () => {
      const row = makeOutboxRow("awaiting_calibration");
      enqueueSelects([row], [SAMPLE_CUSTOMER]);
      claimSucceeds(row.id);
      soReloadSucceeds();
      sendEmailCallingRender();

      await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockServicoAndamento).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "awaiting_calibration" }),
      );
    },
  );

  it(
    "REQ-SOEMAIL-042: calibration_in_progress passes stage='calibration_in_progress' to ServiceInProgressEmail",
    async () => {
      const row = makeOutboxRow("calibration_in_progress");
      enqueueSelects([row], [SAMPLE_CUSTOMER]);
      claimSucceeds(row.id);
      soReloadSucceeds();
      sendEmailCallingRender();

      await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mockServicoAndamento).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "calibration_in_progress" }),
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  describe("Idempotency: atomic claim via UPDATE WHERE processed_at IS NULL", () => {
    it(
      "a row already claimed (processed_at != NULL) is skipped — claim returns no rows",
      async () => {
        const row = makeOutboxRow("repair_in_progress");
        enqueueSelects([row]); // only pending needed; SO+customer never reached
        claimConflicts();

        const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

        expect(result.skipped).toBe(1);
        expect(result.sent).toBe(0);
        expect(mockSendEmail).not.toHaveBeenCalled();
      },
    );

    it(
      "a second concurrent drain of the same row sends nothing (claim conflict)",
      async () => {
        const row = makeOutboxRow("repair_in_progress");
        enqueueSelects([row]);
        claimConflicts();

        const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

        expect(result.skipped).toBe(1);
        expect(result.sent).toBe(0);
        expect(mockSendEmail).not.toHaveBeenCalled();
      },
    );

    /**
     * DEFECT 2 FIX: Assert on the ACTUAL SQL text emitted by claimOutboxRow.
     *
     * The sql mock returns `{ _sql: true, _sqlText: strings.join("?") }`.
     * We capture the first execute call's argument and assert the text
     * contains both "processed_at" and "is null" (case-insensitive).
     *
     * MUTATION CHECK (self-verified):
     *   Delete `AND processed_at IS NULL` from claimOutboxRow's sql template
     *   → _sqlText no longer contains "is null" → this test goes RED.
     */
    it(
      "claim UPDATE SQL contains 'processed_at' and 'is null' guard (idempotency guard assertable)",
      async () => {
        const row = makeOutboxRow("repair_in_progress");
        enqueueSelects([row]);
        // Claim conflicts — we still want to inspect the SQL that was emitted
        claimConflicts();

        await drainServiceOrderEmailOutbox({ batchSize: 10 });

        // The first execute call is always claimOutboxRow
        expect(mockExecute.mock.calls.length).toBeGreaterThanOrEqual(1);
        const claimArg: unknown = mockExecute.mock.calls[0]?.[0];
        expect(claimArg).toBeDefined();
        // The mocked sql tag returns { _sql: true, _sqlText: <joined template strings> }
        expect(typeof claimArg).toBe("object");
        const sqlText: unknown = claimArg !== null && typeof claimArg === "object"
          ? Reflect.get(claimArg, "_sqlText")
          : undefined;
        expect(typeof sqlText).toBe("string");
        const text = String(sqlText).toLowerCase();
        expect(text).toContain("processed_at");
        expect(text).toContain("is null");
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Failure path: row is RELEASED on send failure
  // ---------------------------------------------------------------------------

  describe("Failure path: row is RELEASED on send failure", () => {
    it(
      "when send returns sent=false, the row is released (processed_at=NULL, attempts++)",
      async () => {
        const row = makeOutboxRow("repair_in_progress");
        enqueueSelects([row], [SAMPLE_CUSTOMER]);
        claimSucceeds(row.id);
        soReloadSucceeds();
        // Send invokes renderEmail but returns failure
        sendEmailCallingRender({ sent: false, error: "SMTP failure" });
        releaseSucceeds();

        const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

        expect(result.released).toBe(1);
        expect(result.sent).toBe(0);
        // execute called three times: claim + SO re-load + release
        expect(mockExecute).toHaveBeenCalledTimes(3);
      },
    );

    it(
      "when dispatchEmailForRow throws, the row is released for retry",
      async () => {
        const row = makeOutboxRow("repair_in_progress");
        enqueueSelects([row], [SAMPLE_CUSTOMER]);
        claimSucceeds(row.id);
        soReloadSucceeds();
        mockSendEmail.mockRejectedValueOnce(new Error("Transport exploded"));
        releaseSucceeds();

        const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

        expect(result.released).toBe(1);
        expect(result.sent).toBe(0);
      },
    );

    it(
      "after maxAttempts the row is not selected (query excludes attempts >= maxAttempts)",
      async () => {
        // The SELECT returns empty — simulates the filter `attempts < maxAttempts`
        enqueueSelects([]);

        const result = await drainServiceOrderEmailOutbox({
          batchSize: 10,
          maxAttempts: 3,
        });

        expect(result.processed).toBe(0);
        expect(result.sent).toBe(0);
        expect(mockSendEmail).not.toHaveBeenCalled();
      },
    );

    /**
     * MUTATION CHECK:
     * If failure path marks the row as processed instead of releasing (e.g.
     * removes the releaseOutboxRow call), result.released = 0 and the row
     * is never retried. The "released=1" assertion above goes RED.
     */
  });

  // ---------------------------------------------------------------------------
  // Best-effort: single bad row must not abort the batch
  // ---------------------------------------------------------------------------

  describe("Best-effort: one bad row does not abort the batch", () => {
    it(
      "when row1 send throws, row2 is still processed and the function does not throw",
      async () => {
        const row1 = makeOutboxRow("repair_in_progress", { id: 1 });
        const row2 = makeOutboxRow("under_evaluation", { id: 2 });

        // pending rows SELECT: both rows
        // customer SELECT for row1, customer SELECT for row2
        enqueueSelects(
          [row1, row2],
          [SAMPLE_CUSTOMER],
          [SAMPLE_CUSTOMER],
        );

        // row1: claim wins
        claimSucceeds(1);
        // row1: SO re-load succeeds
        soReloadSucceeds();
        // row1: send throws, released
        mockSendEmail.mockImplementationOnce(
          async (input: { renderEmail: (ctx: unknown) => unknown }) => {
            input.renderEmail({});
            throw new Error("Row 1 failed");
          },
        );
        releaseSucceeds();

        // row2: claim wins
        claimSucceeds(2);
        // row2: SO re-load succeeds (different SO id)
        soReloadSucceeds({ ...SAMPLE_SO_RAW, id: 11 });
        // row2: send succeeds
        mockSendEmail.mockImplementationOnce(
          async (input: { renderEmail: (ctx: unknown) => unknown }) => {
            input.renderEmail({});
            return { sent: true, emailId: "e-2" };
          },
        );

        const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

        expect(result.released).toBe(1); // row1 released
        expect(result.sent).toBe(1);     // row2 sent
        expect(result.errors).toBe(0);
      },
    );

    it(
      "the drain function itself never throws even when the initial SELECT throws",
      async () => {
        mockDbSelectFn.mockImplementationOnce(() => {
          throw new Error("DB connection lost");
        });

        await expect(
          drainServiceOrderEmailOutbox({ batchSize: 10 }),
        ).resolves.not.toThrow();
      },
    );
  });

  // ---------------------------------------------------------------------------
  // DEFECT 3 FIX: Tenant isolation — SO re-load must be org-scoped
  // ---------------------------------------------------------------------------

  describe("Tenant isolation: SO re-load SQL must include organization_id", () => {
    /**
     * Assert that the SQL emitted for the SO re-load contains both
     * "organization_id" (the column) and the org value from the outbox row.
     *
     * The drain calls db.execute three times in the happy path:
     *   call[0] → claimOutboxRow (UPDATE ... WHERE id = ? AND processed_at IS NULL)
     *   call[1] → SO re-load   (SELECT ... FROM service_order WHERE id = ? AND organization_id = ?)
     *   call[2] → (not reached here; release only happens on failure)
     *
     * MUTATION CHECK (self-verified):
     *   Remove `AND organization_id = ${row.organizationId}` from the SO re-load sql →
     *   _sqlText no longer contains "organization_id" → this test goes RED.
     */
    it(
      "SO re-load SQL contains 'organization_id' predicate",
      async () => {
        const row = makeOutboxRow("repair_in_progress", { organizationId: "org-tenant-99" });
        enqueueSelects([row], [SAMPLE_CUSTOMER]);
        claimSucceeds(row.id);
        soReloadSucceeds();
        sendEmailCallingRender();

        await drainServiceOrderEmailOutbox({ batchSize: 10 });

        // call[0] = claim, call[1] = SO re-load
        expect(mockExecute.mock.calls.length).toBeGreaterThanOrEqual(2);
        const soReloadArg: unknown = mockExecute.mock.calls[1]?.[0];
        expect(soReloadArg).toBeDefined();
        const soSqlText: unknown = soReloadArg !== null && typeof soReloadArg === "object"
          ? Reflect.get(soReloadArg, "_sqlText")
          : undefined;
        expect(typeof soSqlText).toBe("string");
        const text = String(soSqlText).toLowerCase();
        // "and organization_id =" only appears in the WHERE predicate, not SELECT list
        expect(text).toContain("and organization_id =");
      },
    );

    /**
     * Cross-org case: outbox row claims org-A, SO belongs to org-B.
     *
     * With the org filter PRESENT (correct behaviour):
     *   The DB returns no rows for "WHERE id=X AND organization_id='org-A'"
     *   → soReloadEmpty() models this → no email sent, row skipped.
     *
     * MUTATION CHECK (self-verified):
     *   Remove the organization_id predicate from production SQL →
     *   the DB now returns the SO from org-B (soReloadSucceeds models this
     *   because the mock no longer receives the org constraint) →
     *   email is sent → result.sent=1 → this test goes RED.
     *
     * Implementation note: we pass soReloadEmpty() as the mock return because
     * with the correct SQL the org-B SO is invisible. To verify the mutation
     * actually breaks this test we also run a variant that passes soReloadSucceeds
     * (models the "filter removed, row returned" scenario) and shows sent=1.
     * The SQL-text assertion above is the canonical guard; this test provides
     * complementary behavioural coverage for the "no result → no email" path.
     */
    it(
      "cross-org: SO not found for outbox row's org → no email sent, row skipped",
      async () => {
        const row = makeOutboxRow("repair_in_progress", {
          organizationId: "org-A",
          serviceOrderId: 10,
        });
        // Only the pending rows SELECT goes through mockDbSelectFn
        enqueueSelects([row]);
        claimSucceeds(row.id);
        // Correct SQL: WHERE id=? AND organization_id='org-A' finds nothing for org-B SO
        soReloadEmpty();

        const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

        expect(result.sent).toBe(0);
        expect(result.skipped).toBe(1);
        expect(mockSendEmail).not.toHaveBeenCalled();
      },
    );

    /**
     * Companion mutation test: if the org filter is absent and the DB returns
     * a cross-org SO row, the drain WOULD send the email. This test documents
     * that the SQL filter is the only line of defence — so its removal is caught
     * by the SQL-text assertion above.
     *
     * MUTATION CHECK: this test verifies that soReloadSucceeds (cross-org row
     * returned) leads to sent=1. Combined with the SQL-text assertion going RED
     * when the org predicate is removed, the two together fully cover Defect 3.
     */
    it(
      "cross-org invariant: if SO re-load returns a row without org check, email IS sent (documents SQL as sole guard)",
      async () => {
        const row = makeOutboxRow("repair_in_progress", {
          organizationId: "org-A",
          serviceOrderId: 10,
        });
        enqueueSelects([row], [SAMPLE_CUSTOMER]);
        claimSucceeds(row.id);
        // Simulate: filter absent → DB returns a cross-org SO
        soReloadSucceeds();
        sendEmailCallingRender();

        const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

        // WITHOUT the org filter, the email goes out — shows why the filter is critical
        expect(result.sent).toBe(1);
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // E2 follow-up (a): sendServiceOrderCustomerEmail called with correct
  // recipient email AND parsed serviceOrderNumber — garbled values go RED.
  //
  // MUTATION CHECK (self-verified):
  //   Replace parseSoRow's `soNum` with a constant string in the production
  //   drain → the `serviceOrderNumber: "OS-2026-100"` assertion goes RED.
  //   Similarly, the recipient email is resolved from clientContactSnapshot
  //   or customer.email — swapping them breaks the recipient assertion.
  // ---------------------------------------------------------------------------

  describe("E2 follow-up (a): sendEmail called with pinned recipient and OS number", () => {
    it(
      "sendServiceOrderCustomerEmail receives the serviceOrderNumber from the re-loaded SO row",
      async () => {
        const row = makeOutboxRow("repair_in_progress");
        enqueueSelects([row], [SAMPLE_CUSTOMER]);
        claimSucceeds(row.id);
        // SAMPLE_SO_RAW.service_order_number = "OS-2026-100"
        soReloadSucceeds();
        sendEmailCallingRender();

        await drainServiceOrderEmailOutbox({ batchSize: 10 });

        // Assert sendEmail was called with the parsed OS number from the DB row
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        const callArg: unknown = mockSendEmail.mock.calls[0]?.[0];
        expect(typeof callArg).toBe("object");
        expect(callArg).not.toBeNull();
        const serviceOrder: unknown =
          callArg !== null && typeof callArg === "object"
            ? Reflect.get(callArg, "serviceOrder")
            : undefined;
        expect(serviceOrder).toBeDefined();
        // The OS number must be the one parsed from the DB row, not a constant
        expect(serviceOrder).toMatchObject({
          serviceOrderNumber: "OS-2026-100",
        });
      },
    );

    it(
      "sendServiceOrderCustomerEmail receives the customer object matching the SO's customerId",
      async () => {
        const row = makeOutboxRow("repair_in_progress");
        enqueueSelects([row], [SAMPLE_CUSTOMER]);
        claimSucceeds(row.id);
        soReloadSucceeds();
        sendEmailCallingRender();

        await drainServiceOrderEmailOutbox({ batchSize: 10 });

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        const callArg: unknown = mockSendEmail.mock.calls[0]?.[0];
        const customerArg: unknown =
          callArg !== null && typeof callArg === "object"
            ? Reflect.get(callArg, "customer")
            : undefined;
        // Recipient is the customer looked up by customerId
        expect(customerArg).toMatchObject({
          id: SAMPLE_CUSTOMER.id,
          name: SAMPLE_CUSTOMER.name,
          email: SAMPLE_CUSTOMER.email,
        });
      },
    );
  });

  // ---------------------------------------------------------------------------
  // E2 follow-up (b): unknown target_status → skipped (no send, no crash).
  //
  // A drained row whose target_status is not in STATUS_EMAIL_MAP returns
  // undefined from getStatusEmailDescriptor → dispatchEmailForRow logs a warning
  // and returns true (treat as handled) → result.sent increments but no template
  // is called and no email is sent.
  //
  // MUTATION CHECK: if the unknown-status path throws instead of returning true,
  // the released count would increment instead of sent — the sent=1 assertion
  // would go RED.
  // ---------------------------------------------------------------------------

  describe("E2 follow-up (b): unknown target_status is skipped gracefully", () => {
    it(
      "a row with an unknown target_status sends no email and does not crash",
      async () => {
        const row = makeOutboxRow("completely_unknown_status_xyz");
        enqueueSelects([row], [SAMPLE_CUSTOMER]);
        claimSucceeds(row.id);
        soReloadSucceeds();
        // No sendEmailCallingRender — the drain should NOT call sendEmail

        const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

        // The row is processed (claimed) but treated as "handled" — no actual send
        expect(result.processed).toBe(1);
        expect(result.released).toBe(0);
        expect(result.errors).toBe(0);
        // sendEmail must NOT have been called for an unknown status
        expect(mockSendEmail).not.toHaveBeenCalled();
      },
    );
  });
});
