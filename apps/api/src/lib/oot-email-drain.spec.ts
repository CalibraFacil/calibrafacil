/**
 * Tests for the §7.10 out-of-tolerance email outbox drain (#426 Phase 0).
 *
 * Strategy mirrors service-order-email-drain.spec.ts: mock Drizzle `db`,
 * notifications and the email template; assert the drain's reliability
 * contract in isolation:
 *
 *   1. Claim lease SQL is guarded by `processed_at IS NULL` + claimed_at
 *      staleness (idempotency + strand recovery).
 *   2. Success: email sent with ack link, row marked processed, notification
 *      advanced to SENT (guarded so ACKNOWLEDGED never regresses).
 *   3. Missing PDF: row DEFERRED — lease cleared WITHOUT incrementing
 *      attempts (a slow render must not burn the retry budget).
 *   4. Send failure: row released (attempts + 1); exhaustion stamps
 *      dead_letter_at in the same statement.
 *   5. Graceful terminal skips: missing notification / recipient, already
 *      acknowledged, suppressed address — all mark the row processed and
 *      send nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockExecute,
  mockDbSelectFn,
  mockDbUpdateFn,
  mockGetLabEmailBrand,
  mockIsEmailSuppressed,
  mockSendOotEmail,
  mockOotEmailTemplate,
} = vi.hoisted(() => {
  function makeSelectChain(rows: unknown[]) {
    const chain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
    };
    return chain;
  }

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

  const updateFn = vi.fn(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  }));

  return {
    mockExecute: vi.fn(),
    mockDbSelectFn: selectFn,
    mockDbUpdateFn: updateFn,
    mockGetLabEmailBrand: vi.fn().mockResolvedValue(undefined),
    mockIsEmailSuppressed: vi.fn().mockResolvedValue(false),
    mockSendOotEmail: vi.fn().mockResolvedValue({ sent: true, emailId: "e1" }),
    mockOotEmailTemplate: vi.fn().mockReturnValue("oot-email-element"),
  };
});

vi.mock("@calibra-facil/db", () => ({
  db: {
    execute: mockExecute,
    select: mockDbSelectFn,
    update: mockDbUpdateFn,
  },
}));

vi.mock("@calibra-facil/db/schema", () => ({
  asset: { id: "a_id", name: "a_name" },
  calibrationJob: { id: "j_id", assetId: "j_assetId" },
  nonConformance: { id: "nc_id", ncNumber: "nc_number" },
  ootEmailOutbox: {
    id: "ob_id",
    organizationId: "ob_orgId",
    notificationId: "ob_notifId",
    attempts: "ob_attempts",
    processedAt: "ob_processedAt",
    claimedAt: "ob_claimedAt",
    createdAt: "ob_createdAt",
  },
  ootNotification: {
    id: "n_id",
    ncId: "n_ncId",
    jobId: "n_jobId",
    organizationId: "n_orgId",
    status: "n_status",
    recipientName: "n_recipientName",
    recipientEmail: "n_recipientEmail",
    certificateNumber: "n_certNumber",
    pdfR2Key: "n_pdfKey",
    ackToken: "n_ackToken",
    acknowledgedAt: "n_ackAt",
    sentAt: "n_sentAt",
  },
  organization: { id: "o_id", name: "o_name" },
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
  getLabEmailBrand: mockGetLabEmailBrand,
  isEmailSuppressed: mockIsEmailSuppressed,
  sendOotCustomerEmail: mockSendOotEmail,
}));

vi.mock("@calibra-facil/email", () => ({
  OotNotificationEmail: mockOotEmailTemplate,
}));

import { drainOotEmailOutbox } from "./oot-email-drain";

function enqueueSelects(...rows: unknown[][]) {
  mockDbSelectFn._reset();
  for (const r of rows) mockDbSelectFn._queue.push(r);
}

const OUTBOX_ROW = {
  id: 7,
  organizationId: "org-1",
  notificationId: 42,
  attempts: 0,
};

const NOTIFICATION_ROW = {
  id: 42,
  ncId: 5,
  status: "GENERATED",
  recipientName: "Cliente Exemplo",
  recipientEmail: "qualidade@cliente.com.br",
  certificateNumber: "CAL-2026-0100",
  pdfR2Key: "org/lab-1/2026/oot-notifications/42/notificacao.pdf",
  ackToken: "11111111-2222-3333-4444-555555555555",
  acknowledgedAt: null,
  ncNumber: "NC-2026-0009",
  labName: "Lab Exemplo",
  assetName: "Balança analítica",
};

function getExecuteSqlTexts(): string[] {
  return mockExecute.mock.calls.map((call) => {
    const arg: unknown = call[0];
    if (arg && typeof arg === "object" && "_sqlText" in arg) {
      const text = Reflect.get(arg, "_sqlText");
      return typeof text === "string" ? text : "";
    }
    return "";
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbSelectFn._reset();
  mockIsEmailSuppressed.mockResolvedValue(false);
  mockSendOotEmail.mockResolvedValue({ sent: true, emailId: "e1" });
  // Default: claim succeeds
  mockExecute.mockResolvedValue({ rows: [{ id: OUTBOX_ROW.id }] });
  delete process.env.R2_ACCOUNT_ID;
});

describe("drainOotEmailOutbox", () => {
  it("sends the email with the ack link and marks the row processed + notification SENT", async () => {
    enqueueSelects([OUTBOX_ROW], [NOTIFICATION_ROW]);

    const result = await drainOotEmailOutbox();

    expect(result.sent).toBe(1);
    expect(result.errors).toBe(0);

    // Claim SQL carries the idempotency + lease-staleness guard.
    const sqlTexts = getExecuteSqlTexts();
    const claimSql = sqlTexts.find((t) => t.includes("SET claimed_at = now()"));
    expect(claimSql).toBeDefined();
    expect(claimSql).toContain("processed_at IS NULL");
    expect(claimSql).toContain("claimed_at IS NULL OR claimed_at <");

    // Terminal success marker.
    expect(
      sqlTexts.some((t) => t.includes("SET processed_at = now()")),
    ).toBe(true);

    // Email got the ack link + context.
    expect(mockOotEmailTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        ncNumber: "NC-2026-0009",
        instrumentDescription: "Balança analítica",
        ackUrl: expect.stringContaining(
          "/api/public/oot-ack/11111111-2222-3333-4444-555555555555",
        ),
      }),
    );
    expect(mockSendOotEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: "qualidade@cliente.com.br",
      }),
    );

    // Notification advanced to SENT.
    expect(mockDbUpdateFn).toHaveBeenCalled();
  });

  it("defers (lease cleared, attempts NOT incremented) when the PDF is not rendered yet", async () => {
    enqueueSelects([OUTBOX_ROW], [{ ...NOTIFICATION_ROW, pdfR2Key: null }]);

    const result = await drainOotEmailOutbox();

    expect(result.deferred).toBe(1);
    expect(result.sent).toBe(0);
    expect(mockSendOotEmail).not.toHaveBeenCalled();

    const sqlTexts = getExecuteSqlTexts();
    const deferSql = sqlTexts.find((t) =>
      t.includes("PDF nao gerado ainda"),
    );
    expect(deferSql).toBeDefined();
    expect(deferSql).not.toContain("attempts = attempts + 1");
    expect(deferSql).toContain("SET claimed_at = NULL");
  });

  it("releases the row (attempts + 1) on send failure, without dead-letter before exhaustion", async () => {
    enqueueSelects([OUTBOX_ROW], [NOTIFICATION_ROW]);
    mockSendOotEmail.mockResolvedValue({ sent: false, error: "boom" });

    const result = await drainOotEmailOutbox();

    expect(result.released).toBe(1);
    const sqlTexts = getExecuteSqlTexts();
    const releaseSql = sqlTexts.find((t) =>
      t.includes("attempts = attempts + 1"),
    );
    expect(releaseSql).toBeDefined();
    expect(releaseSql).not.toContain("dead_letter_at");
  });

  it("stamps dead_letter_at when the failing release exhausts the retry budget", async () => {
    enqueueSelects(
      [{ ...OUTBOX_ROW, attempts: 2 }],
      [NOTIFICATION_ROW],
    );
    mockSendOotEmail.mockResolvedValue({ sent: false, error: "boom" });

    const result = await drainOotEmailOutbox({ maxAttempts: 3 });

    expect(result.released).toBe(1);
    const sqlTexts = getExecuteSqlTexts();
    const deadLetterSql = sqlTexts.find((t) => t.includes("dead_letter_at"));
    expect(deadLetterSql).toBeDefined();
    expect(deadLetterSql).toContain("attempts = attempts + 1");
  });

  it("skips terminally (processed, no send) when the receipt was already acknowledged", async () => {
    enqueueSelects(
      [OUTBOX_ROW],
      [{ ...NOTIFICATION_ROW, acknowledgedAt: new Date() }],
    );

    const result = await drainOotEmailOutbox();

    expect(result.skipped).toBe(1);
    expect(mockSendOotEmail).not.toHaveBeenCalled();
    expect(
      getExecuteSqlTexts().some((t) => t.includes("SET processed_at = now()")),
    ).toBe(true);
  });

  it("skips terminally when the recipient address is suppressed", async () => {
    enqueueSelects([OUTBOX_ROW], [NOTIFICATION_ROW]);
    mockIsEmailSuppressed.mockResolvedValue(true);

    const result = await drainOotEmailOutbox();

    expect(result.skipped).toBe(1);
    expect(mockSendOotEmail).not.toHaveBeenCalled();
  });

  it("skips terminally when the notification row no longer exists", async () => {
    enqueueSelects([OUTBOX_ROW], []);

    const result = await drainOotEmailOutbox();

    expect(result.skipped).toBe(1);
    expect(mockSendOotEmail).not.toHaveBeenCalled();
  });

  it("does not abort the batch when one row throws", async () => {
    const secondRow = { ...OUTBOX_ROW, id: 8, notificationId: 43 };
    enqueueSelects([OUTBOX_ROW, secondRow], [NOTIFICATION_ROW]);
    // First row: claim ok, then its notification select resolves via the
    // queue; make send throw for row 1 and the queue empty (skip) for row 2.
    mockSendOotEmail.mockRejectedValueOnce(new Error("transport exploded"));

    const result = await drainOotEmailOutbox();

    expect(result.errors).toBe(1);
    expect(result.released).toBe(1);
    // Second row still got processed (skipped: no notification in queue).
    expect(result.skipped).toBe(1);
  });
});
