/**
 * service-order-email-drain.int.spec.ts: the outbox drain of the service-order e-mails, against a
 * real Postgres. The only seam faked is the mail sender (`sendEmailWithLabSender`, the last hop
 * before the transport): what the customer would receive (recipient, subject, body) is captured
 * there, and the assertions are on the observable outcome: the mails sent, the state of the
 * outbox rows (processed, released, dead-lettered, payload redacted) and the at-most-once ledger.
 *
 * Status e-mails (the `status_email:*` rows)
 *   REQ-SOEMAIL-041..044, 051..054, 061..062  each target status sends its own template and
 *                    subject to the order's customer, once, and the row is marked done
 *   REQ-SOEMAIL-001  the recipient is the contact the order captured, else the customer
 *   (lease)          a processed row, a live lease and an exhausted row are never sent; an
 *                    expired lease is reclaimed; two drains of one row send one mail
 *   (failure)        a failed send releases the row (lease cleared, attempts + 1, last_error)
 *                    and the next drain delivers it; a send that throws is a failed send
 *   REQ-REL-OBS-003  the release that exhausts the attempts dead-letters the row
 *   REGULATED        a status e-mail whose key the ledger already holds is NOT sent again
 *   (best effort)    one failing row does not stop the batch; the drain never throws
 *   (tenant)         an outbox row that points at another laboratory's order sends nothing
 *
 * B/C/D e-mails (`nova_os`, `orcamento_sent:*`, `quote_approved:*`, `quote_rejected:*`)
 *   REQ-SOEMAIL-073  each namespace sends its own mail from the payload
 *   REQ-SOEMAIL-074  a key the ledger already holds sends nothing and the row is marked done
 *   (payload)        a malformed payload is skipped gracefully and does not stop the batch
 *   REQ-SOEMAIL-075  the mail and the ledger entry belong to the row's own laboratory
 *   REQ-QPUB-008     a sent `orcamento_sent` row loses its raw credentials; a released one
 *                    keeps its payload for the retry; other namespaces are not touched
 *
 *   enqueueServiceOrderEmail  one row per (order, event key) through the caller's transaction
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  serviceOrder,
  serviceOrderEmailLog,
  serviceOrderEmailOutbox,
} from "@calibra-facil/db/schema";
import { truncateAll } from "../../../../test/integration/db";
import {
  seedBillableOrder,
  seedBillingLab,
  type BillingLab,
} from "../../../../test/integration/billing-fixtures";
import { orgDb } from "../../../lib/org-db";

const mail = vi.hoisted(() => ({ send: vi.fn() }));

// The mails leave through one seam of the sender package: capture what each would send. A test
// makes a send fail by returning a failed outcome, or throw, from `mail.send`.
vi.mock("@calibra-facil/email-sender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/email-sender")>()),
  sendEmailWithLabSender: async (params: {
    buildPayload: (sender: undefined) => Promise<unknown>;
  }) => {
    const outcome: unknown = mail.send(await params.buildPayload(undefined));
    return outcome ?? { sent: true, emailId: "email_1" };
  },
}));

import { drainServiceOrderEmailOutbox } from "./service-order-email-drain";
import { enqueueServiceOrderEmail } from "./email-outbox-payloads";

const ORDER_NUMBER = "OS-2026-100";
const FAILED_SEND = {
  sent: false,
  retryable: true,
  error: "SMTP failure",
} as const;

type Mail = { to: string; subject: string; html: string };

/** The mails the sender was asked to send, as the customer would read them. */
function sentMails(): Mail[] {
  return mail.send.mock.calls.map(([payload]) => {
    const fields = Object(payload);
    return {
      to: String(fields.to),
      subject: String(fields.subject),
      html: String(fields.html),
    };
  });
}

let lab: BillingLab;
let orderId: number;

beforeEach(async () => {
  await truncateAll();
  mail.send.mockReset();
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "noreply@calibrafacil.com");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  lab = await seedBillingLab("lab-a");
  orderId = await seedBillableOrder(lab, { number: ORDER_NUMBER });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type QueueRowParams = {
  eventKey: string;
  targetStatus: string;
  payload?: Record<string, unknown>;
  serviceOrderId?: number;
  organizationId?: string;
  unitId?: number;
  attempts?: number;
  claimedAt?: Date;
  processedAt?: Date;
  createdAt?: Date;
};

/** Queue an outbox row of `lab` (or of the laboratory given) and return its id. */
async function queueRow(
  params: QueueRowParams,
  owner: BillingLab = lab,
): Promise<number> {
  const [row] = await db
    .insert(serviceOrderEmailOutbox)
    .values({
      organizationId: params.organizationId ?? owner.orgId,
      unitId: params.unitId ?? owner.unitId,
      serviceOrderId: params.serviceOrderId ?? orderId,
      eventKey: params.eventKey,
      targetStatus: params.targetStatus,
      payload: params.payload ?? {},
      attempts: params.attempts ?? 0,
      claimedAt: params.claimedAt,
      processedAt: params.processedAt,
      createdAt: params.createdAt,
    })
    .returning({ id: serviceOrderEmailOutbox.id });
  if (!row) throw new Error("queueRow: insert failed");
  return row.id;
}

function queueStatusRow(
  status: string,
  more: Partial<Omit<QueueRowParams, "eventKey" | "targetStatus">> = {},
  owner: BillingLab = lab,
) {
  return queueRow(
    { eventKey: `status_email:${status}`, targetStatus: status, ...more },
    owner,
  );
}

async function outboxRow(id: number) {
  const [row] = await db
    .select()
    .from(serviceOrderEmailOutbox)
    .where(eq(serviceOrderEmailOutbox.id, id));
  if (!row) throw new Error(`outbox row ${id} is gone`);
  return row;
}

async function ledgerKeys() {
  const rows = await db
    .select({
      organizationId: serviceOrderEmailLog.organizationId,
      serviceOrderId: serviceOrderEmailLog.serviceOrderId,
      eventKey: serviceOrderEmailLog.eventKey,
    })
    .from(serviceOrderEmailLog);
  return rows.toSorted((a, b) => a.eventKey.localeCompare(b.eventKey));
}

// =============================================================================
// Status e-mails
// =============================================================================

describe("status e-mails: the template and subject of each target status", () => {
  const TABLE = [
    ["repair_in_progress", "REQ-SOEMAIL-041", "serviço iniciado"],
    ["awaiting_calibration", "REQ-SOEMAIL-042", "atualização do serviço"],
    ["calibration_in_progress", "REQ-SOEMAIL-042", "atualização do serviço"],
    [
      "awaiting_tech_evaluation",
      "REQ-SOEMAIL-043",
      "aguardando avaliação técnica",
    ],
    ["under_evaluation", "REQ-SOEMAIL-044", "em avaliação técnica"],
    ["ready_for_pickup", "REQ-SOEMAIL-051", "pronto para retirada"],
    ["delivered", "REQ-SOEMAIL-052", "equipamento entregue"],
    ["closed", "REQ-SOEMAIL-053", "OS encerrada"],
    ["awaiting_final_review", "REQ-SOEMAIL-054", "em revisão final"],
    ["canceled", "REQ-SOEMAIL-061", "OS cancelada"],
    ["warranty_return", "REQ-SOEMAIL-062", "retorno em garantia"],
  ] as const;

  it.each(TABLE)(
    "%s (%s): the customer gets one mail with the %s subject and the row is marked done",
    async (status, _req, subjectTail) => {
      const rowId = await queueStatusRow(status);

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(result).toMatchObject({ processed: 1, sent: 1, released: 0 });
      const mails = sentMails();
      expect(mails).toHaveLength(1);
      expect(mails[0]?.to).toBe("financeiro@lab-a.test");
      expect(mails[0]?.subject).toBe(`OS ${ORDER_NUMBER} — ${subjectTail}`);
      expect(mails[0]?.html).toContain("Customer lab-a");
      const row = await outboxRow(rowId);
      expect(row.processedAt).toBeInstanceOf(Date);
      expect(row.attempts).toBe(0);
      expect(row.deadLetterAt).toBeNull();
      expect(await ledgerKeys()).toEqual([
        {
          organizationId: lab.orgId,
          serviceOrderId: orderId,
          eventKey: `status_email:${status}`,
        },
      ]);
    },
  );

  it("REQ-SOEMAIL-001: the mail goes to the contact the order captured, not the customer's address", async () => {
    await db
      .update(serviceOrder)
      .set({ clientContactSnapshot: { email: "contato@lab-a.test" } })
      .where(eq(serviceOrder.id, orderId));
    await queueStatusRow("repair_in_progress");

    await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(sentMails().map((sent) => sent.to)).toEqual(["contato@lab-a.test"]);
  });

  it("an unknown target status sends nothing, is marked done and does not count as an error", async () => {
    const rowId = await queueStatusRow("completely_unknown_status_xyz");

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ processed: 1, released: 0, errors: 0 });
    expect(mail.send).not.toHaveBeenCalled();
    expect((await outboxRow(rowId)).processedAt).toBeInstanceOf(Date);
    expect(await ledgerKeys()).toEqual([]);
  });
});

describe("status e-mails: a row is sent once, and only when it is owed", () => {
  it("a row already processed is not sent again", async () => {
    const processedAt = new Date("2026-06-01T10:00:00.000Z");
    const rowId = await queueStatusRow("repair_in_progress", { processedAt });

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ processed: 0, sent: 0 });
    expect(mail.send).not.toHaveBeenCalled();
    expect((await outboxRow(rowId)).processedAt).toEqual(processedAt);
  });

  it("a row under a live lease (another drain is sending it) is left alone", async () => {
    const claimedAt = new Date();
    const rowId = await queueStatusRow("repair_in_progress", { claimedAt });

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ processed: 0, sent: 0 });
    expect(mail.send).not.toHaveBeenCalled();
    const row = await outboxRow(rowId);
    expect(row.processedAt).toBeNull();
    expect(row.claimedAt).toEqual(claimedAt);
  });

  it("a row whose lease expired (a drain killed mid-send) is reclaimed and sent", async () => {
    const rowId = await queueStatusRow("repair_in_progress", {
      claimedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ processed: 1, sent: 1 });
    expect(sentMails()).toHaveLength(1);
    expect((await outboxRow(rowId)).processedAt).toBeInstanceOf(Date);
  });

  it("two drains running at once send one mail for the row", async () => {
    const rowId = await queueStatusRow("repair_in_progress");

    const [first, second] = await Promise.all([
      drainServiceOrderEmailOutbox({ batchSize: 10 }),
      drainServiceOrderEmailOutbox({ batchSize: 10 }),
    ]);

    expect(first.sent + second.sent).toBe(1);
    expect(sentMails()).toHaveLength(1);
    expect((await outboxRow(rowId)).processedAt).toBeInstanceOf(Date);
    expect(await ledgerKeys()).toHaveLength(1);
  });

  it("a row whose attempts reached the maximum is never selected", async () => {
    const rowId = await queueStatusRow("repair_in_progress", { attempts: 3 });

    const result = await drainServiceOrderEmailOutbox({
      batchSize: 10,
      maxAttempts: 3,
    });

    expect(result).toMatchObject({ processed: 0, sent: 0 });
    expect(mail.send).not.toHaveBeenCalled();
    expect((await outboxRow(rowId)).processedAt).toBeNull();
  });

  it("REGULATED at-most-once: a reclaimed status e-mail whose key is already recorded is NOT sent again", async () => {
    // A drain delivered the mail but died before marking the row: the ledger holds the key.
    await db.insert(serviceOrderEmailLog).values({
      organizationId: lab.orgId,
      serviceOrderId: orderId,
      eventKey: "status_email:repair_in_progress",
    });
    const rowId = await queueStatusRow("repair_in_progress", {
      claimedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(mail.send).not.toHaveBeenCalled();
    // The row is still resolved as handled (done, not released), so it stops coming back.
    expect(result).toMatchObject({ sent: 1, released: 0 });
    expect((await outboxRow(rowId)).processedAt).toBeInstanceOf(Date);
    expect(await ledgerKeys()).toHaveLength(1);
  });
});

describe("status e-mails: a failed send is released and retried", () => {
  it("a send the transport refuses releases the row (lease cleared, attempts + 1, last_error) and frees the ledger key", async () => {
    mail.send.mockReturnValueOnce(FAILED_SEND);
    const rowId = await queueStatusRow("repair_in_progress");

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ processed: 1, sent: 0, released: 1 });
    const row = await outboxRow(rowId);
    expect(row.processedAt).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("Send did not complete — released for retry");
    expect(row.deadLetterAt).toBeNull();
    // The key is free again, so the retry can send.
    expect(await ledgerKeys()).toEqual([]);
  });

  it("the next drain delivers a released row, once", async () => {
    mail.send.mockReturnValueOnce(FAILED_SEND);
    const rowId = await queueStatusRow("repair_in_progress");
    await drainServiceOrderEmailOutbox({ batchSize: 10 });

    const retry = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(retry).toMatchObject({ processed: 1, sent: 1, released: 0 });
    // Two attempts reached the sender (the refused one and the delivered one).
    expect(mail.send).toHaveBeenCalledTimes(2);
    const row = await outboxRow(rowId);
    expect(row.processedAt).toBeInstanceOf(Date);
    expect(row.attempts).toBe(1);
    expect(await ledgerKeys()).toHaveLength(1);
    // And nothing is left to send.
    const idle = await drainServiceOrderEmailOutbox();
    expect(idle).toMatchObject({ processed: 0, sent: 0 });
  });

  it("a send that throws is a failed send: the row is released, not lost", async () => {
    mail.send.mockImplementationOnce(() => {
      throw new Error("Transport exploded");
    });
    const rowId = await queueStatusRow("repair_in_progress");

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ sent: 0, released: 1, errors: 0 });
    const row = await outboxRow(rowId);
    expect(row.processedAt).toBeNull();
    expect(row.attempts).toBe(1);
  });

  it("REQ-REL-OBS-003: a failing send that exhausts the maximum attempts dead-letters the row", async () => {
    mail.send.mockReturnValueOnce(FAILED_SEND);
    // attempts 2 of 3: this release is the last one.
    const rowId = await queueStatusRow("repair_in_progress", { attempts: 2 });

    const result = await drainServiceOrderEmailOutbox({
      batchSize: 10,
      maxAttempts: 3,
    });

    expect(result.released).toBe(1);
    const row = await outboxRow(rowId);
    expect(row.deadLetterAt).toBeInstanceOf(Date);
    expect(row.attempts).toBe(3);
    expect(row.claimedAt).toBeNull();
    expect(row.processedAt).toBeNull();
  });

  it("REQ-REL-OBS-003: a failing send with retries left does NOT dead-letter the row", async () => {
    mail.send.mockReturnValueOnce(FAILED_SEND);
    const rowId = await queueStatusRow("repair_in_progress", { attempts: 0 });

    await drainServiceOrderEmailOutbox({ batchSize: 10, maxAttempts: 3 });

    const row = await outboxRow(rowId);
    expect(row.deadLetterAt).toBeNull();
    expect(row.attempts).toBe(1);
  });
});

describe("status e-mails: best effort", () => {
  it("when the first row fails, the second is still sent and the drain does not throw", async () => {
    mail.send.mockReturnValueOnce(FAILED_SEND);
    const first = await queueStatusRow("repair_in_progress", {
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
    });
    const second = await queueStatusRow("under_evaluation", {
      createdAt: new Date("2026-06-01T11:00:00.000Z"),
    });

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ sent: 1, released: 1, errors: 0 });
    expect((await outboxRow(first)).processedAt).toBeNull();
    expect((await outboxRow(second)).processedAt).toBeInstanceOf(Date);
    expect(sentMails().at(-1)?.subject).toBe(
      `OS ${ORDER_NUMBER} — em avaliação técnica`,
    );
  });

  it("the drain answers even when the outbox cannot be read", async () => {
    await queueStatusRow("repair_in_progress");
    await db.execute(
      sql`ALTER TABLE service_order_email_outbox RENAME TO service_order_email_outbox_away`,
    );
    let result: Awaited<ReturnType<typeof drainServiceOrderEmailOutbox>>;
    try {
      result = await drainServiceOrderEmailOutbox({ batchSize: 10 });
    } finally {
      await db.execute(
        sql`ALTER TABLE service_order_email_outbox_away RENAME TO service_order_email_outbox`,
      );
    }

    expect(result).toMatchObject({ processed: 0, sent: 0, errors: 1 });
    expect(mail.send).not.toHaveBeenCalled();
  });
});

describe("status e-mails: tenant isolation", () => {
  it("an outbox row of one laboratory that points at another laboratory's order sends nothing and is closed", async () => {
    const other = await seedBillingLab("lab-b");
    const otherOrder = await seedBillableOrder(other, { number: "OS-B-1" });
    const forged = await queueStatusRow(
      "delivered",
      { serviceOrderId: otherOrder },
      lab,
    );

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ processed: 1, sent: 0, skipped: 1 });
    expect(mail.send).not.toHaveBeenCalled();
    expect((await outboxRow(forged)).processedAt).toBeInstanceOf(Date);
    expect(await ledgerKeys()).toEqual([]);
  });

  it("each laboratory's row is mailed from its own order, with its own customer", async () => {
    const other = await seedBillingLab("lab-b");
    const otherOrder = await seedBillableOrder(other, { number: "OS-B-1" });
    await queueStatusRow("closed");
    await queueStatusRow("closed", { serviceOrderId: otherOrder }, other);

    await drainServiceOrderEmailOutbox({ batchSize: 10 });

    const mails = sentMails();
    expect(mails).toHaveLength(2);
    const toA = mails.find((sent) => sent.to === "financeiro@lab-a.test");
    const toB = mails.find((sent) => sent.to === "financeiro@lab-b.test");
    expect(toA?.subject).toContain(ORDER_NUMBER);
    expect(toA?.html).toContain("Customer lab-a");
    expect(toA?.html).not.toContain("Customer lab-b");
    expect(toB?.subject).toContain("OS-B-1");
    expect(toB?.html).toContain("Customer lab-b");
    expect(toB?.html).not.toContain("Customer lab-a");
    expect(await ledgerKeys()).toEqual([
      {
        organizationId: lab.orgId,
        serviceOrderId: orderId,
        eventKey: "status_email:closed",
      },
      {
        organizationId: other.orgId,
        serviceOrderId: otherOrder,
        eventKey: "status_email:closed",
      },
    ]);
  });
});

// =============================================================================
// B/C/D e-mails
// =============================================================================

function novaOsPayload(overrides: Record<string, unknown> = {}) {
  return {
    serviceOrderId: orderId,
    serviceOrderNumber: "OS-2026-TEST",
    organizationId: lab.orgId,
    publicId: "pub-test-1",
    customerId: lab.customerId,
    clientContactSnapshot: null,
    customerName: "Empresa Teste SA",
    customerEmail: "cliente@example.com",
    assetManufacturer: "Acme",
    assetModel: "X-100",
    assetSerialNumber: "SN-999",
    openedAt: "2026-06-01T00:00:00.000Z",
    claimedDefect: "Sensor fault",
    ...overrides,
  };
}

function orcamentoSentPayload(
  quoteId: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...novaOsPayload(),
    quoteId,
    items: [],
    subtotalServicesCents: 10000,
    subtotalPartsCents: 5000,
    freightCents: 0,
    discountCents: 0,
    totalCents: 15000,
    publicAccessToken: "tok-abc",
    approvalCode: "K7WM3P9A",
    portalAppUrl: "https://portal.calibrafacil.com",
    ...overrides,
  };
}

function quoteApprovedPayload(quoteId: number) {
  return {
    serviceOrderId: orderId,
    quoteId,
    serviceOrderNumber: "OS-2026-TEST",
    organizationId: lab.orgId,
    publicId: "pub-test-1",
    customerId: lab.customerId,
    clientContactSnapshot: null,
    customerName: "Empresa Teste SA",
    customerEmail: "cliente@example.com",
    totalApprovedCents: 15000,
  };
}

function quoteRejectedPayload(quoteId: number) {
  const { totalApprovedCents: _total, ...base } = quoteApprovedPayload(quoteId);
  return { ...base, rejectionReason: "Too expensive" };
}

function queueNovaOs(payload: Record<string, unknown> = novaOsPayload()) {
  return queueRow({ eventKey: "nova_os", targetStatus: "opened", payload });
}

function queueOrcamentoSent(
  payload: Record<string, unknown> = orcamentoSentPayload(42),
) {
  return queueRow({
    eventKey: "orcamento_sent:42",
    targetStatus: "quote_sent",
    payload,
  });
}

describe("REQ-SOEMAIL-073: each B/C/D namespace sends its own mail from the payload", () => {
  it("REQ-SOEMAIL-073/nova_os: the customer is told the order was received, with the payload's data", async () => {
    const rowId = await queueNovaOs();

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ processed: 1, sent: 1, errors: 0 });
    const mails = sentMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe("cliente@example.com");
    expect(mails[0]?.subject).toBe("Ordem de Serviço OS-2026-TEST recebida");
    expect(mails[0]?.html).toContain("Empresa Teste SA");
    expect(mails[0]?.html).toContain("Sensor fault");
    expect((await outboxRow(rowId)).processedAt).toBeInstanceOf(Date);
    expect(await ledgerKeys()).toEqual([
      {
        organizationId: lab.orgId,
        serviceOrderId: orderId,
        eventKey: "nova_os",
      },
    ]);
  });

  it("REQ-SOEMAIL-073/orcamento_sent: the quote mail carries the approval link and code of the payload", async () => {
    await queueOrcamentoSent();

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ sent: 1, errors: 0 });
    const [sent] = sentMails();
    expect(sent?.to).toBe("cliente@example.com");
    expect(sent?.subject).toBe(
      "Orçamento OS-2026-TEST aguardando sua aprovação",
    );
    expect(sent?.html).toContain("tok-abc");
    expect(sent?.html).toContain("K7WM3P9A");
  });

  it("REQ-QPUB-020 (transitional): a legacy orcamento_sent row without approvalCode still sends", async () => {
    const { approvalCode: _code, ...legacy } = orcamentoSentPayload(42);
    await queueOrcamentoSent(legacy);

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ sent: 1, errors: 0 });
    expect(sentMails()[0]?.subject).toBe(
      "Orçamento OS-2026-TEST aguardando sua aprovação",
    );
  });

  it("REQ-SOEMAIL-073/quote_approved: the customer is told the quote was approved", async () => {
    await queueRow({
      eventKey: "quote_approved:7",
      targetStatus: "quote_approved",
      payload: quoteApprovedPayload(7),
    });

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ sent: 1, errors: 0 });
    expect(sentMails().map((sent) => sent.subject)).toEqual([
      "Orçamento OS-2026-TEST aprovado",
    ]);
  });

  it("REQ-SOEMAIL-073/quote_rejected: the customer is told the quote was not approved, with the reason", async () => {
    await queueRow({
      eventKey: "quote_rejected:5",
      targetStatus: "quote_rejected",
      payload: quoteRejectedPayload(5),
    });

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ sent: 1, errors: 0 });
    const [sent] = sentMails();
    expect(sent?.subject).toBe("Orçamento OS-2026-TEST não aprovado");
    expect(sent?.html).toContain("Too expensive");
  });

  it("REQ-SOEMAIL-073: a batch of different namespaces sends each its own mail (no namespace takes another's template)", async () => {
    await queueRow({
      eventKey: "nova_os",
      targetStatus: "opened",
      payload: novaOsPayload(),
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
    });
    await queueRow({
      eventKey: "orcamento_sent:42",
      targetStatus: "quote_sent",
      payload: orcamentoSentPayload(42),
      createdAt: new Date("2026-06-01T11:00:00.000Z"),
    });
    await queueRow({
      eventKey: "quote_approved:42",
      targetStatus: "quote_approved",
      payload: quoteApprovedPayload(42),
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
    });
    await queueRow({
      eventKey: "quote_rejected:43",
      targetStatus: "quote_rejected",
      payload: quoteRejectedPayload(43),
      createdAt: new Date("2026-06-01T13:00:00.000Z"),
    });

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ processed: 4, sent: 4, errors: 0 });
    expect(sentMails().map((sent) => sent.subject)).toEqual([
      "Ordem de Serviço OS-2026-TEST recebida",
      "Orçamento OS-2026-TEST aguardando sua aprovação",
      "Orçamento OS-2026-TEST aprovado",
      "Orçamento OS-2026-TEST não aprovado",
    ]);
  });
});

describe("REQ-SOEMAIL-074: a key the ledger already holds sends nothing", () => {
  it.each([
    ["nova_os", "nova_os"],
    ["orcamento_sent:42", "orcamento_sent:42"],
  ] as const)(
    "%s: no second mail, and the row is marked done",
    async (eventKey) => {
      await db.insert(serviceOrderEmailLog).values({
        organizationId: lab.orgId,
        serviceOrderId: orderId,
        eventKey,
      });
      const rowId =
        eventKey === "nova_os"
          ? await queueNovaOs()
          : await queueOrcamentoSent();

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mail.send).not.toHaveBeenCalled();
      expect(result).toMatchObject({ processed: 1, sent: 1, released: 0 });
      expect((await outboxRow(rowId)).processedAt).toBeInstanceOf(Date);
    },
  );
});

describe("a malformed B/C/D payload is skipped gracefully", () => {
  it.each([
    ["nova_os", "nova_os", "opened", {}],
    [
      "orcamento_sent:42",
      "orcamento_sent:42",
      "quote_sent",
      { serviceOrderId: 1, quoteId: 42 },
    ],
    [
      "quote_approved:7",
      "quote_approved:7",
      "quote_approved",
      { serviceOrderId: 1, quoteId: 7 },
    ],
    [
      "quote_rejected:5",
      "quote_rejected:5",
      "quote_rejected",
      { serviceOrderId: 1, quoteId: 5 },
    ],
  ] as const)(
    "%s: nothing is sent, nothing is recorded, the row is marked done and the batch reports no error",
    async (_name, eventKey, targetStatus, payload) => {
      const rowId = await queueRow({ eventKey, targetStatus, payload });

      const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

      expect(mail.send).not.toHaveBeenCalled();
      expect(result).toMatchObject({ processed: 1, errors: 0, released: 0 });
      expect((await outboxRow(rowId)).processedAt).toBeInstanceOf(Date);
      expect(await ledgerKeys()).toEqual([]);
    },
  );

  it("a malformed row does not stop the rows after it", async () => {
    await queueRow({
      eventKey: "nova_os",
      targetStatus: "opened",
      payload: {},
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
    });
    await queueRow({
      eventKey: "quote_approved:7",
      targetStatus: "quote_approved",
      payload: quoteApprovedPayload(7),
      createdAt: new Date("2026-06-01T11:00:00.000Z"),
    });

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result.errors).toBe(0);
    expect(sentMails().map((sent) => sent.subject)).toEqual([
      "Orçamento OS-2026-TEST aprovado",
    ]);
  });
});

describe("REQ-SOEMAIL-075: the B/C/D mail belongs to the row's own laboratory", () => {
  it("the ledger entry is written under the laboratory of the row, and the other laboratory's rows are untouched", async () => {
    const other = await seedBillingLab("lab-b");
    const otherOrder = await seedBillableOrder(other, { number: "OS-B-1" });
    await queueNovaOs();
    const otherRow = await queueRow(
      {
        eventKey: "nova_os",
        targetStatus: "opened",
        serviceOrderId: otherOrder,
        payload: {
          ...novaOsPayload(),
          serviceOrderId: otherOrder,
          serviceOrderNumber: "OS-B-1",
          organizationId: other.orgId,
          customerEmail: "cliente@lab-b.test",
        },
        processedAt: new Date("2026-06-01T09:00:00.000Z"),
      },
      other,
    );

    await drainServiceOrderEmailOutbox({ batchSize: 10 });

    // Only lab A's row was owed: one mail, to A's customer, under A.
    expect(sentMails().map((sent) => sent.to)).toEqual(["cliente@example.com"]);
    expect(await ledgerKeys()).toEqual([
      {
        organizationId: lab.orgId,
        serviceOrderId: orderId,
        eventKey: "nova_os",
      },
    ]);
    expect((await outboxRow(otherRow)).processedAt).toEqual(
      new Date("2026-06-01T09:00:00.000Z"),
    );
  });
});

describe("REQ-QPUB-008: raw credentials of a quote mail are kept only while a retry may need them", () => {
  it("a sent orcamento_sent row has its token and approval code overwritten, the rest of the payload intact", async () => {
    const payload = orcamentoSentPayload(42);
    const rowId = await queueOrcamentoSent(payload);

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result.sent).toBe(1);
    const row = await outboxRow(rowId);
    expect(row.processedAt).toBeInstanceOf(Date);
    expect(row.payload).toEqual({
      ...payload,
      publicAccessToken: "[REDACTED]",
      approvalCode: "[REDACTED]",
    });
  });

  it("a legacy sent row without an approval code gets only its token overwritten (no code is invented)", async () => {
    const { approvalCode: _code, ...legacy } = orcamentoSentPayload(42);
    const rowId = await queueOrcamentoSent(legacy);

    await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect((await outboxRow(rowId)).payload).toEqual({
      ...legacy,
      publicAccessToken: "[REDACTED]",
    });
  });

  it("a failed orcamento_sent send is released with its payload intact for the retry", async () => {
    mail.send.mockReturnValueOnce(FAILED_SEND);
    const payload = orcamentoSentPayload(42);
    const rowId = await queueOrcamentoSent(payload);

    const result = await drainServiceOrderEmailOutbox({ batchSize: 10 });

    expect(result).toMatchObject({ sent: 0, released: 1 });
    const row = await outboxRow(rowId);
    expect(row.processedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe(
      "B/C/D dispatch did not complete — released for retry",
    );
    expect(row.payload).toEqual(payload);
    // The retry still has the credentials it needs, and delivers.
    const retry = await drainServiceOrderEmailOutbox({ batchSize: 10 });
    expect(retry.sent).toBe(1);
    expect(sentMails().at(-1)?.html).toContain("tok-abc");
  });

  it("a namespace without credentials (nova_os) is marked done with its payload untouched", async () => {
    const payload = novaOsPayload();
    const rowId = await queueNovaOs(payload);

    await drainServiceOrderEmailOutbox({ batchSize: 10 });

    const row = await outboxRow(rowId);
    expect(row.processedAt).toBeInstanceOf(Date);
    expect(row.payload).toEqual(payload);
  });

  it("a B/C/D row that exhausts its attempts is dead-lettered", async () => {
    mail.send.mockReturnValueOnce(FAILED_SEND);
    const rowId = await queueRow({
      eventKey: "quote_approved:7",
      targetStatus: "quote_approved",
      payload: quoteApprovedPayload(7),
      attempts: 2,
    });

    await drainServiceOrderEmailOutbox({ batchSize: 10, maxAttempts: 3 });

    const row = await outboxRow(rowId);
    expect(row.deadLetterAt).toBeInstanceOf(Date);
    expect(row.attempts).toBe(3);
  });
});

// =============================================================================
// enqueueServiceOrderEmail
// =============================================================================

describe("enqueueServiceOrderEmail: one row per (order, event key), through the caller's transaction", () => {
  const params = () => ({
    organizationId: lab.orgId,
    unitId: lab.unitId,
    serviceOrderId: orderId,
    eventKey: "nova_os",
    targetStatus: "opened",
    payload: novaOsPayload(),
  });

  it("inserts the owed row with its key, status and payload, pending and with no attempt", async () => {
    await orgDb(lab.orgId).transaction((o) =>
      enqueueServiceOrderEmail(params(), o),
    );

    const rows = await db.select().from(serviceOrderEmailOutbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: lab.orgId,
      unitId: lab.unitId,
      serviceOrderId: orderId,
      eventKey: "nova_os",
      targetStatus: "opened",
      payload: novaOsPayload(),
      attempts: 0,
      processedAt: null,
      claimedAt: null,
      deadLetterAt: null,
    });
  });

  it("a second enqueue of the same event key changes nothing (the first row stands)", async () => {
    await orgDb(lab.orgId).transaction((o) =>
      enqueueServiceOrderEmail(params(), o),
    );

    await orgDb(lab.orgId).transaction((o) =>
      enqueueServiceOrderEmail(
        {
          ...params(),
          targetStatus: "changed",
          payload: novaOsPayload({ claimedDefect: "Another defect" }),
        },
        o,
      ),
    );

    const rows = await db.select().from(serviceOrderEmailOutbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetStatus).toBe("opened");
    expect(rows[0]?.payload).toEqual(novaOsPayload());
  });

  it("the row commits or rolls back with the caller's transaction", async () => {
    await expect(
      orgDb(lab.orgId).transaction(async (o) => {
        await enqueueServiceOrderEmail(params(), o);
        throw new Error("the command failed after queueing");
      }),
    ).rejects.toThrow("the command failed after queueing");

    expect(await db.select().from(serviceOrderEmailOutbox)).toEqual([]);
  });
});
