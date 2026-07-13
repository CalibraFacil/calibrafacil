/**
 * Per-OS customer-communication log (#343).
 *
 * Read model that merges the two existing customer-email ledgers into one
 * chronological "we told customer X on date Y" list for the OS detail page:
 *
 *  - `service_order_email_log`    — at-most-once ledger; a kept row means the
 *    email was actually dispatched (sent_at + recipient_email).
 *  - `service_order_email_outbox` — transactional queue; pending / retrying /
 *    dead-lettered rows describe emails still owed or permanently failed.
 *
 * Delivery-failure signal (bounce/complaint) comes from the Resend suppression
 * webhook: an address on the `email_suppression` list with a delivery-failure
 * reason, same derivation the standards recall view uses.
 *
 * No new tables — this surfaces what the pipeline already records.
 */

import { db } from "@calibra-facil/db";
import {
  customer,
  emailSuppression,
  serviceOrder,
  serviceOrderEmailLog,
  serviceOrderEmailOutbox,
} from "@calibra-facil/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { resolveServiceOrderRecipient } from "@calibra-facil/notifications";
import type { buildUnitScopeCondition } from "../../lib/units";

export type ServiceOrderCommunicationStatus =
  | "sent"
  | "queued"
  | "retrying"
  | "failed"
  | "skipped";

export type ServiceOrderCommunicationEntry = {
  /** Stable per-event dedup key, e.g. "nova_os", "status_email:ready_for_pickup". */
  eventKey: string;
  /** Only email exists today; in-portal/SMS/WhatsApp may join later. */
  channel: "email";
  status: ServiceOrderCommunicationStatus;
  /**
   * For sent entries: the address recorded at send time (falls back to the
   * currently-resolved OS recipient for rows that predate recipient stamping).
   * For queued/retrying entries: the address the send would resolve to today.
   */
  recipientEmail: string | null;
  /** Recipient is on the suppression list for hard bounce / spam complaint. */
  recipientSuppressed: boolean;
  /** ISO timestamp the email was dispatched (sent entries only). */
  sentAt: string | null;
  /** ISO timestamp the event was enqueued (outbox-backed entries only). */
  queuedAt: string | null;
  attempts: number;
  lastError: string | null;
};

type LogRow = {
  eventKey: string;
  recipientEmail: string | null;
  sentAt: Date;
};

type OutboxRow = {
  eventKey: string;
  createdAt: Date;
  processedAt: Date | null;
  deadLetterAt: Date | null;
  attempts: number;
  lastError: string | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Pure merge of the two ledgers into display entries, newest first.
 * Exported for unit tests.
 */
export function buildServiceOrderCommunicationEntries(input: {
  logRows: LogRow[];
  outboxRows: OutboxRow[];
  fallbackRecipient: string | null;
  suppressedEmails: ReadonlySet<string>;
}): ServiceOrderCommunicationEntry[] {
  const { logRows, outboxRows, fallbackRecipient, suppressedEmails } = input;

  const logByKey = new Map(logRows.map((row) => [row.eventKey, row]));
  const entries: ServiceOrderCommunicationEntry[] = [];

  const withSuppression = (
    entry: Omit<ServiceOrderCommunicationEntry, "recipientSuppressed">,
  ): ServiceOrderCommunicationEntry => ({
    ...entry,
    recipientSuppressed: entry.recipientEmail
      ? suppressedEmails.has(normalizeEmail(entry.recipientEmail))
      : false,
  });

  for (const outbox of outboxRows) {
    const log = logByKey.get(outbox.eventKey);
    if (log) {
      logByKey.delete(outbox.eventKey);
      entries.push(
        withSuppression({
          eventKey: outbox.eventKey,
          channel: "email",
          status: "sent",
          recipientEmail: log.recipientEmail ?? fallbackRecipient,
          sentAt: log.sentAt.toISOString(),
          queuedAt: outbox.createdAt.toISOString(),
          attempts: outbox.attempts,
          lastError: outbox.lastError,
        }),
      );
      continue;
    }

    const status: ServiceOrderCommunicationStatus = outbox.deadLetterAt
      ? "failed"
      : outbox.processedAt
        ? // Processed without a ledger row = graceful skip (e.g. no valid
          // recipient could be resolved at send time).
          "skipped"
        : outbox.attempts > 0
          ? "retrying"
          : "queued";

    entries.push(
      withSuppression({
        eventKey: outbox.eventKey,
        channel: "email",
        status,
        recipientEmail: status === "skipped" ? null : fallbackRecipient,
        sentAt: null,
        queuedAt: outbox.createdAt.toISOString(),
        attempts: outbox.attempts,
        lastError: outbox.lastError,
      }),
    );
  }

  // Ledger rows with no outbox counterpart: sends made directly on the command
  // path (pre-outbox history). Still part of the audit trail.
  for (const log of logByKey.values()) {
    entries.push(
      withSuppression({
        eventKey: log.eventKey,
        channel: "email",
        status: "sent",
        recipientEmail: log.recipientEmail ?? fallbackRecipient,
        sentAt: log.sentAt.toISOString(),
        queuedAt: null,
        attempts: 0,
        lastError: null,
      }),
    );
  }

  return entries.sort((a, b) => {
    const aTime = a.sentAt ?? a.queuedAt ?? "";
    const bTime = b.sentAt ?? b.queuedAt ?? "";
    return bTime.localeCompare(aTime);
  });
}

/**
 * Lists the customer-communication log for one service order, tenant- and
 * unit-scoped. Returns undefined when the OS is not visible to the member
 * (route answers 404).
 */
export async function listServiceOrderCommunications(
  id: number,
  organizationId: string,
  unitCondition?: ReturnType<typeof buildUnitScopeCondition>,
): Promise<{ data: ServiceOrderCommunicationEntry[] } | undefined> {
  const [order] = await db
    .select({
      id: serviceOrder.id,
      publicId: serviceOrder.publicId,
      customerId: serviceOrder.customerId,
      serviceOrderNumber: serviceOrder.serviceOrderNumber,
      clientContactSnapshot: serviceOrder.clientContactSnapshot,
      customerEmail: customer.email,
    })
    .from(serviceOrder)
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .where(
      and(
        eq(serviceOrder.id, id),
        eq(serviceOrder.organizationId, organizationId),
        unitCondition,
      ),
    )
    .limit(1);

  if (!order) return undefined;

  const fallbackRecipient =
    resolveServiceOrderRecipient(
      {
        id: order.id,
        publicId: order.publicId,
        organizationId,
        customerId: order.customerId,
        serviceOrderNumber: order.serviceOrderNumber,
        clientContactSnapshot: order.clientContactSnapshot,
      },
      { id: order.customerId, name: "", email: order.customerEmail },
    ) ?? null;

  const [logRows, outboxRows] = await Promise.all([
    db
      .select({
        eventKey: serviceOrderEmailLog.eventKey,
        recipientEmail: serviceOrderEmailLog.recipientEmail,
        sentAt: serviceOrderEmailLog.sentAt,
      })
      .from(serviceOrderEmailLog)
      .where(eq(serviceOrderEmailLog.serviceOrderId, id)),
    db
      .select({
        eventKey: serviceOrderEmailOutbox.eventKey,
        createdAt: serviceOrderEmailOutbox.createdAt,
        processedAt: serviceOrderEmailOutbox.processedAt,
        deadLetterAt: serviceOrderEmailOutbox.deadLetterAt,
        attempts: serviceOrderEmailOutbox.attempts,
        lastError: serviceOrderEmailOutbox.lastError,
      })
      .from(serviceOrderEmailOutbox)
      .where(eq(serviceOrderEmailOutbox.serviceOrderId, id)),
  ]);

  // Bounce/complaint signal from the Resend suppression webhook: any involved
  // address on the suppression list with a delivery-failure reason.
  const involvedEmails = [
    ...new Set(
      [...logRows.map((row) => row.recipientEmail), fallbackRecipient]
        .filter((email): email is string => Boolean(email))
        .map(normalizeEmail),
    ),
  ];
  const suppressedRows = involvedEmails.length
    ? await db
        .select({ email: emailSuppression.email })
        .from(emailSuppression)
        .where(
          and(
            inArray(emailSuppression.email, involvedEmails),
            inArray(emailSuppression.reason, ["hard_bounce", "complaint"]),
          ),
        )
    : [];
  const suppressedEmails = new Set(
    suppressedRows.map((row) => normalizeEmail(row.email)),
  );

  return {
    data: buildServiceOrderCommunicationEntries({
      logRows,
      outboxRows,
      fallbackRecipient,
      suppressedEmails,
    }),
  };
}
