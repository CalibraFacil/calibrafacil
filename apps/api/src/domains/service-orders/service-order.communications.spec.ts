/**
 * Tests for the per-OS customer-communication log merge (#343).
 *
 * Unit-tests the pure `buildServiceOrderCommunicationEntries` merge of the
 * email ledger (`service_order_email_log`) and outbox
 * (`service_order_email_outbox`) into display entries:
 *
 *  - ledger row (+ outbox counterpart)          → "sent"
 *  - outbox pending, no attempts                → "queued"
 *  - outbox pending, attempts > 0               → "retrying"
 *  - outbox dead-lettered                       → "failed"
 *  - outbox processed without a ledger row      → "skipped" (graceful skip)
 *  - ledger row without outbox (command path)   → "sent"
 *  - suppression list marks the recipient       → recipientSuppressed
 *  - entries are ordered newest first
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@calibra-facil/db", () => ({ db: {} }));
vi.mock("@calibra-facil/db/schema", () => ({
  customer: {},
  emailSuppression: {},
  serviceOrder: {},
  serviceOrderEmailLog: {},
  serviceOrderEmailOutbox: {},
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
}));
vi.mock("@calibra-facil/notifications", () => ({
  resolveServiceOrderRecipient: vi.fn(),
}));

import { buildServiceOrderCommunicationEntries } from "./service-order.communications";

const NO_SUPPRESSION: ReadonlySet<string> = new Set();

function outboxRow(overrides: {
  eventKey: string;
  createdAt?: Date;
  processedAt?: Date | null;
  deadLetterAt?: Date | null;
  attempts?: number;
  lastError?: string | null;
}) {
  return {
    createdAt: new Date("2026-07-01T10:00:00Z"),
    processedAt: null,
    deadLetterAt: null,
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

describe("buildServiceOrderCommunicationEntries", () => {
  it("marks a ledger row with outbox counterpart as sent, with the recorded recipient", () => {
    const entries = buildServiceOrderCommunicationEntries({
      logRows: [
        {
          eventKey: "status_email:ready_for_pickup",
          recipientEmail: "cliente@exemplo.com.br",
          sentAt: new Date("2026-07-01T10:05:00Z"),
        },
      ],
      outboxRows: [
        outboxRow({
          eventKey: "status_email:ready_for_pickup",
          processedAt: new Date("2026-07-01T10:05:00Z"),
        }),
      ],
      fallbackRecipient: "outro@exemplo.com.br",
      suppressedEmails: NO_SUPPRESSION,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      eventKey: "status_email:ready_for_pickup",
      channel: "email",
      status: "sent",
      recipientEmail: "cliente@exemplo.com.br",
      sentAt: "2026-07-01T10:05:00.000Z",
      queuedAt: "2026-07-01T10:00:00.000Z",
      recipientSuppressed: false,
    });
  });

  it("falls back to the currently-resolved recipient for sent rows that predate recipient stamping", () => {
    const entries = buildServiceOrderCommunicationEntries({
      logRows: [
        {
          eventKey: "nova_os",
          recipientEmail: null,
          sentAt: new Date("2026-06-01T09:00:00Z"),
        },
      ],
      outboxRows: [],
      fallbackRecipient: "cliente@exemplo.com.br",
      suppressedEmails: NO_SUPPRESSION,
    });

    expect(entries[0]).toMatchObject({
      status: "sent",
      recipientEmail: "cliente@exemplo.com.br",
      queuedAt: null,
    });
  });

  it("marks a pending outbox row with no attempts as queued", () => {
    const entries = buildServiceOrderCommunicationEntries({
      logRows: [],
      outboxRows: [outboxRow({ eventKey: "status_email:delivered" })],
      fallbackRecipient: "cliente@exemplo.com.br",
      suppressedEmails: NO_SUPPRESSION,
    });

    expect(entries[0]).toMatchObject({
      status: "queued",
      recipientEmail: "cliente@exemplo.com.br",
      sentAt: null,
      attempts: 0,
    });
  });

  it("marks a pending outbox row with attempts as retrying, keeping lastError", () => {
    const entries = buildServiceOrderCommunicationEntries({
      logRows: [],
      outboxRows: [
        outboxRow({
          eventKey: "status_email:delivered",
          attempts: 2,
          lastError: "Send did not complete — released for retry",
        }),
      ],
      fallbackRecipient: "cliente@exemplo.com.br",
      suppressedEmails: NO_SUPPRESSION,
    });

    expect(entries[0]).toMatchObject({
      status: "retrying",
      attempts: 2,
      lastError: "Send did not complete — released for retry",
    });
  });

  it("marks a dead-lettered outbox row as failed", () => {
    const entries = buildServiceOrderCommunicationEntries({
      logRows: [],
      outboxRows: [
        outboxRow({
          eventKey: "status_email:closed",
          attempts: 3,
          deadLetterAt: new Date("2026-07-02T00:00:00Z"),
          lastError: "Send did not complete — released for retry",
        }),
      ],
      fallbackRecipient: "cliente@exemplo.com.br",
      suppressedEmails: NO_SUPPRESSION,
    });

    expect(entries[0]).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("marks a processed outbox row without a ledger row as skipped, with no recipient", () => {
    const entries = buildServiceOrderCommunicationEntries({
      logRows: [],
      outboxRows: [
        outboxRow({
          eventKey: "status_email:canceled",
          processedAt: new Date("2026-07-01T11:00:00Z"),
        }),
      ],
      fallbackRecipient: null,
      suppressedEmails: NO_SUPPRESSION,
    });

    expect(entries[0]).toMatchObject({
      status: "skipped",
      recipientEmail: null,
    });
  });

  it("flags recipients on the suppression list (case/whitespace-insensitive)", () => {
    const entries = buildServiceOrderCommunicationEntries({
      logRows: [
        {
          eventKey: "nova_os",
          recipientEmail: " Cliente@Exemplo.com.br ",
          sentAt: new Date("2026-07-01T10:00:00Z"),
        },
      ],
      outboxRows: [],
      fallbackRecipient: null,
      suppressedEmails: new Set(["cliente@exemplo.com.br"]),
    });

    expect(entries[0]?.recipientSuppressed).toBe(true);
  });

  it("orders entries newest first across ledger and outbox timestamps", () => {
    const entries = buildServiceOrderCommunicationEntries({
      logRows: [
        {
          eventKey: "nova_os",
          recipientEmail: "cliente@exemplo.com.br",
          sentAt: new Date("2026-06-01T09:00:00Z"),
        },
        {
          eventKey: "orcamento_sent:5",
          recipientEmail: "cliente@exemplo.com.br",
          sentAt: new Date("2026-06-03T09:00:00Z"),
        },
      ],
      outboxRows: [
        outboxRow({
          eventKey: "status_email:ready_for_pickup",
          createdAt: new Date("2026-06-02T09:00:00Z"),
        }),
      ],
      fallbackRecipient: "cliente@exemplo.com.br",
      suppressedEmails: NO_SUPPRESSION,
    });

    expect(entries.map((entry) => entry.eventKey)).toEqual([
      "orcamento_sent:5",
      "status_email:ready_for_pickup",
      "nova_os",
    ]);
  });
});
