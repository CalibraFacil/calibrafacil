/**
 * Outbox drain for service-order lifecycle emails (mini-spec E2 + mini-spec I).
 *
 * Drains the `service_order_email_outbox` table and sends the matching
 * customer email template for each pending row. The drain is designed for
 * best-effort, idempotent delivery:
 *
 *  1. SELECT pending rows (processed_at IS NULL AND attempts < maxAttempts),
 *     ordered by created_at (uses the pending index), bounded by batch size.
 *  2. ATOMICALLY CLAIM each row:
 *       UPDATE ... SET processed_at = now()
 *       WHERE id = $1 AND processed_at IS NULL
 *       RETURNING id
 *     Only proceed if a row was returned — this is the idempotency guard.
 *  3. Re-load service order + customer data, resolve the template, send email.
 *  4. On send failure: RELEASE (processed_at = NULL, attempts++, last_error set).
 *  5. Best-effort: one bad row never aborts the batch; function never throws.
 *
 * Template selection / routing:
 *
 *   eventKey namespace       → path
 *   ──────────────────────────────────────────────────────────────────
 *   "status_email:*"         → STATUS_EMAIL_MAP (existing E/F/G path, unchanged)
 *   "nova_os"                → dispatchNovaOsEmail via sendServiceOrderEmailOnce
 *   "orcamento_sent:*"       → dispatchNovoOrcamentoEmail via sendServiceOrderEmailOnce
 *   "quote_approved:*"       → dispatchOrcamentoAprovadoEmail via sendServiceOrderEmailOnce
 *   "quote_rejected:*"       → dispatchOrcamentoRecusadoEmail via sendServiceOrderEmailOnce
 *
 * Mini-spec I (REQ-SOEMAIL-073..075): B/C/D rows are routed by eventKey
 * namespace, payload is parsed with the matching Zod schema, and the
 * existing dispatch helpers are called inside sendServiceOrderEmailOnce so
 * the at-most-once ledger covers them exactly as the command path did.
 * A malformed payload is skipped gracefully (logged, row marked processed)
 * and does NOT crash the batch. Tenant isolation is preserved because the
 * payload is org-owned by construction and the drain does not load extra data
 * across orgs for B/C/D rows.
 */

import { db } from "@calibra-facil/db";
import { customer, serviceOrderEmailOutbox } from "@calibra-facil/db/schema";
import { eq, and, isNull, lt, asc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  sendServiceOrderCustomerEmail,
  getLabEmailBrand,
} from "@calibra-facil/notifications";
import {
  ServiceStartedEmail,
  ServiceInProgressEmail,
  AwaitingEvaluationEmail,
  UnderEvaluationEmail,
  ReadyForPickupEmail,
  ServiceOrderDeliveredEmail,
  ServiceOrderClosedEmail,
  FinalReviewEmail,
  ServiceOrderCanceledEmail,
  WarrantyReturnEmail,
} from "@calibra-facil/email";
import type { ServiceInProgressStage } from "@calibra-facil/email";
import { getStatusEmailDescriptor } from "../modules/service-orders/status-email-map";
import { parseOutboxPayloadByNamespace } from "../modules/service-orders/email-outbox-payloads";
import { sendServiceOrderEmailOnce } from "../modules/service-orders/service-order-email-once";
import { dispatchNovaOsEmail } from "../modules/service-orders/nova-os-email-dispatch";
import { dispatchNovoOrcamentoEmail } from "../modules/service-orders/novo-orcamento-email-dispatch";
import { dispatchOrcamentoAprovadoEmail } from "../modules/service-orders/orcamento-aprovado-email-dispatch";
import { dispatchOrcamentoRecusadoEmail } from "../modules/service-orders/orcamento-recusado-email-dispatch";

// =============================================================================
// CONSTANTS
// =============================================================================

// Each row reloads the service order + customer, renders a template, and sends
// an email (network) sequentially, all inside the cron's 30s maxDuration. A
// batch sized so the whole drain reliably finishes well under 30s avoids the
// failure mode where the function is killed mid-send: the row is claimed
// (processed_at = now()) but not yet completed, and — because a sent row and a
// stranded row are indistinguishable by processed_at alone — it cannot be
// safely auto-released without re-sending the already-sent ones. At the */5min
// cadence, 20 rows/run keeps the backlog draining with margin to spare.
// (A lease-based claimed_at/processed_at split that lets stranded rows
// auto-recover is a regulated-path follow-up; see the cron hardening PR notes.)
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_ATTEMPTS = 3;

// =============================================================================
// TYPES
// =============================================================================

export interface DrainServiceOrderEmailsResult {
  processed: number;
  sent: number;
  skipped: number;
  released: number;
  errors: number;
}

// Internal row shape returned by the SELECT query.
// eventKey and payload are included for B/C/D routing (mini-spec I).
// They may be absent on legacy status_email rows (no migration required — the
// columns exist in the schema; the optional typing guards against test mocks
// that pre-date mini-spec I and don't populate these fields).
interface OutboxRow {
  id: number;
  organizationId: string;
  serviceOrderId: number;
  targetStatus: string;
  eventKey: string | undefined;
  payload: Record<string, unknown> | undefined;
  attempts: number;
}

// Internal shape for the claimed row returned by UPDATE...RETURNING
interface ClaimResult {
  id: number;
}

// Re-loaded service order data needed to render the email
interface ServiceOrderEmailData {
  id: number;
  publicId: string;
  organizationId: string;
  customerId: number;
  serviceOrderNumber: string;
  clientContactSnapshot: Record<string, unknown> | null | undefined;
}

// Re-loaded customer data needed to render the email
interface CustomerEmailData {
  id: number;
  name: string;
  email: string | null | undefined;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Converts an `unknown` value to `Record<string, unknown> | null | undefined`
 * without type assertions. Objects become records, null stays null, everything
 * else (primitive, undefined) becomes undefined.
 */
function toRecordOrNull(
  val: unknown,
): Record<string, unknown> | null | undefined {
  if (val === null) return null;
  if (typeof val !== "object") return undefined;
  // val is narrowed to `object` (non-null); Object.entries accepts object
  return Object.fromEntries(Object.entries(val));
}

/**
 * Atomically claim a single outbox row for processing.
 * Returns the row id when claimed, undefined if already claimed (concurrent drain).
 * Uses `UPDATE ... WHERE id = $id AND processed_at IS NULL RETURNING id` —
 * the WHERE clause is the idempotency guard.
 */
async function claimOutboxRow(rowId: number): Promise<ClaimResult | undefined> {
  const result = await db.execute(
    sql`UPDATE service_order_email_outbox
        SET processed_at = now()
        WHERE id = ${rowId} AND processed_at IS NULL
        RETURNING id`,
  );
  // Drizzle's db.execute returns a PG QueryResult — rows is on .rows
  const rows: unknown = Reflect.get(result, "rows") ?? result;
  if (!Array.isArray(rows) || rows.length === 0) {
    return undefined;
  }
  const first: unknown = rows[0];
  if (typeof first === "object" && first !== null && "id" in first) {
    const id = Reflect.get(first, "id");
    if (typeof id === "number") {
      return { id };
    }
  }
  return undefined;
}

/**
 * Release a row back into the pending queue after a send failure.
 * Increments attempts and records the error message.
 */
async function releaseOutboxRow(
  rowId: number,
  errorMessage: string,
): Promise<void> {
  await db.execute(
    sql`UPDATE service_order_email_outbox
        SET processed_at = NULL,
            attempts = attempts + 1,
            last_error = ${errorMessage}
        WHERE id = ${rowId}`,
  );
}

// =============================================================================
// B/C/D DISPATCH — mini-spec I
// =============================================================================

/**
 * Handle a B/C/D outbox row by parsing its payload and calling the appropriate
 * dispatch helper inside sendServiceOrderEmailOnce.
 *
 * Returns:
 *   true  — row handled (sent OR gracefully skipped due to bad payload)
 *   false — send was attempted but failed (row should be released for retry)
 *
 * A malformed payload is a graceful skip (returns true so the row is not
 * re-released in a retry loop). REQ-SOEMAIL-073/075.
 *
 * Receives a narrowed row where eventKey and payload are guaranteed strings/records.
 */
async function dispatchBcdEmailForRow(
  row: OutboxRow & { eventKey: string; payload: Record<string, unknown> },
): Promise<boolean> {
  const parseResult = parseOutboxPayloadByNamespace(row.eventKey, row.payload);

  if (parseResult.namespace === "unknown") {
    // Not a B/C/D event — caller should fall through to status_email path.
    return false;
  }

  if (parseResult.namespace === "invalid") {
    // Malformed payload: log and treat as handled (graceful skip, no retry).
    console.warn(
      `[ServiceOrderEmailDrain] Malformed payload for eventKey="${row.eventKey}" (outbox id=${row.id}): ${parseResult.error}`,
    );
    return true; // skip, do not release for retry
  }

  // Dispatch the correct helper inside sendServiceOrderEmailOnce.

  if (parseResult.namespace === "nova_os") {
    const p = parseResult.payload;
    await sendServiceOrderEmailOnce({
      serviceOrderId: row.serviceOrderId,
      eventKey: row.eventKey,
      dispatch: () =>
        dispatchNovaOsEmail({
          serviceOrderId: p.serviceOrderId,
          serviceOrderNumber: p.serviceOrderNumber,
          organizationId: p.organizationId,
          publicId: p.publicId,
          customerId: p.customerId,
          clientContactSnapshot: p.clientContactSnapshot ?? null,
          customerName: p.customerName,
          customerEmail: p.customerEmail ?? null,
          assetManufacturer: p.assetManufacturer ?? null,
          assetModel: p.assetModel ?? null,
          assetSerialNumber: p.assetSerialNumber ?? null,
          openedAt: new Date(p.openedAt),
          claimedDefect: p.claimedDefect,
        }),
    });
    return true; // sendServiceOrderEmailOnce handled it (sent or deduped)
  }

  if (parseResult.namespace === "orcamento_sent") {
    const p = parseResult.payload;
    await sendServiceOrderEmailOnce({
      serviceOrderId: row.serviceOrderId,
      eventKey: row.eventKey,
      dispatch: () =>
        dispatchNovoOrcamentoEmail({
          serviceOrderId: p.serviceOrderId,
          quoteId: p.quoteId,
          serviceOrderNumber: p.serviceOrderNumber,
          organizationId: p.organizationId,
          publicId: p.publicId,
          customerId: p.customerId,
          clientContactSnapshot: p.clientContactSnapshot ?? null,
          customerName: p.customerName,
          customerEmail: p.customerEmail ?? null,
          customerTaxId: p.customerTaxId ?? null,
          assetManufacturer: p.assetManufacturer ?? null,
          assetModel: p.assetModel ?? null,
          assetInventoryCode: p.assetInventoryCode ?? null,
          openedAt: new Date(p.openedAt),
          assetSerialNumber: p.assetSerialNumber ?? null,
          displaySpecs: p.displaySpecs ?? null,
          claimedDefect: p.claimedDefect,
          items: p.items,
          subtotalServicesCents: p.subtotalServicesCents,
          subtotalPartsCents: p.subtotalPartsCents,
          freightCents: p.freightCents,
          discountCents: p.discountCents,
          totalCents: p.totalCents,
          publicAccessToken: p.publicAccessToken,
          portalAppUrl: p.portalAppUrl,
        }),
    });
    return true;
  }

  if (parseResult.namespace === "quote_approved") {
    const p = parseResult.payload;
    await sendServiceOrderEmailOnce({
      serviceOrderId: row.serviceOrderId,
      eventKey: row.eventKey,
      dispatch: () =>
        dispatchOrcamentoAprovadoEmail({
          serviceOrderId: p.serviceOrderId,
          quoteId: p.quoteId,
          serviceOrderNumber: p.serviceOrderNumber,
          organizationId: p.organizationId,
          publicId: p.publicId,
          customerId: p.customerId,
          clientContactSnapshot: p.clientContactSnapshot ?? null,
          customerName: p.customerName,
          customerEmail: p.customerEmail ?? null,
          totalApprovedCents: p.totalApprovedCents,
        }),
    });
    return true;
  }

  if (parseResult.namespace === "quote_rejected") {
    const p = parseResult.payload;
    await sendServiceOrderEmailOnce({
      serviceOrderId: row.serviceOrderId,
      eventKey: row.eventKey,
      dispatch: () =>
        dispatchOrcamentoRecusadoEmail({
          serviceOrderId: p.serviceOrderId,
          quoteId: p.quoteId,
          serviceOrderNumber: p.serviceOrderNumber,
          organizationId: p.organizationId,
          publicId: p.publicId,
          customerId: p.customerId,
          clientContactSnapshot: p.clientContactSnapshot ?? null,
          customerName: p.customerName,
          customerEmail: p.customerEmail ?? null,
          rejectionReason: p.rejectionReason ?? null,
        }),
    });
    return true;
  }

  // Should never reach here (exhaustive over namespaces)
  return false;
}

// =============================================================================
// STATUS_EMAIL PATH (unchanged, E/F/G)
// =============================================================================

/**
 * Render and dispatch the correct email template for a given outbox row.
 * Returns true when the send path reports sent=true, false otherwise.
 *
 * Template routing follows STATUS_EMAIL_MAP (the single source of truth shared
 * with E1). The emailType field from the map drives template selection.
 */
async function dispatchEmailForRow(
  row: OutboxRow,
  so: ServiceOrderEmailData,
  cust: CustomerEmailData,
): Promise<boolean> {
  const descriptor = getStatusEmailDescriptor(row.targetStatus);
  if (!descriptor) {
    console.warn(
      `[ServiceOrderEmailDrain] No email descriptor for target_status="${row.targetStatus}" (outbox id=${row.id}); skipping.`,
    );
    return true; // treat as "handled" — release-on-retry would loop forever
  }

  const brand = await getLabEmailBrand(so.organizationId);

  const result = await sendServiceOrderCustomerEmail({
    serviceOrder: {
      id: so.id,
      publicId: so.publicId,
      organizationId: so.organizationId,
      customerId: so.customerId,
      serviceOrderNumber: so.serviceOrderNumber,
      clientContactSnapshot: so.clientContactSnapshot,
    },
    customer: {
      id: cust.id,
      name: cust.name,
      email: cust.email,
    },
    brand,
    subject: buildSubject(descriptor.emailType, so.serviceOrderNumber),
    renderEmail: () =>
      renderTemplate(
        descriptor.emailType,
        so.serviceOrderNumber,
        cust.name,
        row.targetStatus,
        brand,
      ),
  });

  return result.sent === true;
}

function buildSubject(emailType: string, serviceOrderNumber: string): string {
  const labels: Record<string, string> = {
    service_started: `OS ${serviceOrderNumber} — serviço iniciado`,
    progress_update: `OS ${serviceOrderNumber} — atualização do serviço`,
    awaiting_tech_evaluation: `OS ${serviceOrderNumber} — aguardando avaliação técnica`,
    under_evaluation: `OS ${serviceOrderNumber} — em avaliação técnica`,
    ready_for_pickup: `OS ${serviceOrderNumber} — pronto para retirada`,
    delivered: `OS ${serviceOrderNumber} — equipamento entregue`,
    closed: `OS ${serviceOrderNumber} — OS encerrada`,
    final_review: `OS ${serviceOrderNumber} — em revisão final`,
    canceled: `OS ${serviceOrderNumber} — OS cancelada`,
    warranty_return: `OS ${serviceOrderNumber} — retorno em garantia`,
  };
  return labels[emailType] ?? `OS ${serviceOrderNumber} — atualização`;
}

function renderTemplate(
  emailType: string,
  serviceOrderNumber: string,
  customerName: string,
  targetStatus: string,
  brand: Awaited<ReturnType<typeof getLabEmailBrand>>,
) {
  if (emailType === "service_started") {
    return ServiceStartedEmail({ brand, serviceOrderNumber, customerName });
  }

  if (emailType === "progress_update") {
    // Both awaiting_calibration and calibration_in_progress use ServicoAndamento
    // with a stage prop that corresponds to the targetStatus.
    const isValidStage = (s: string): s is ServiceInProgressStage =>
      s === "awaiting_calibration" || s === "calibration_in_progress";
    const stage = isValidStage(targetStatus)
      ? targetStatus
      : "awaiting_calibration";
    return ServiceInProgressEmail({
      brand,
      serviceOrderNumber,
      customerName,
      stage,
    });
  }

  if (emailType === "awaiting_tech_evaluation") {
    return AwaitingEvaluationEmail({
      brand,
      serviceOrderNumber,
      customerName,
    });
  }

  if (emailType === "under_evaluation") {
    return UnderEvaluationEmail({ brand, serviceOrderNumber, customerName });
  }

  if (emailType === "ready_for_pickup") {
    return ReadyForPickupEmail({ brand, serviceOrderNumber, customerName });
  }

  if (emailType === "delivered") {
    return ServiceOrderDeliveredEmail({
      brand,
      serviceOrderNumber,
      customerName,
    });
  }

  if (emailType === "closed") {
    return ServiceOrderClosedEmail({ brand, serviceOrderNumber, customerName });
  }

  if (emailType === "final_review") {
    return FinalReviewEmail({ brand, serviceOrderNumber, customerName });
  }

  if (emailType === "canceled") {
    return ServiceOrderCanceledEmail({
      brand,
      serviceOrderNumber,
      customerName,
    });
  }

  if (emailType === "warranty_return") {
    return WarrantyReturnEmail({ brand, serviceOrderNumber, customerName });
  }

  return null;
}

// =============================================================================
// MAIN DRAIN FUNCTION
// =============================================================================

/**
 * Drain up to `batchSize` pending outbox rows and send the matching
 * customer email for each. Best-effort: errors are logged and rows are
 * released for retry. Never throws.
 *
 * Called from the `service-order-emails` cron handler in dispatch.ts.
 */
export async function drainServiceOrderEmailOutbox(options?: {
  batchSize?: number;
  maxAttempts?: number;
}): Promise<DrainServiceOrderEmailsResult> {
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const result: DrainServiceOrderEmailsResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    released: 0,
    errors: 0,
  };

  try {
    // 1. SELECT pending rows using the pending index (created_at, processed_at).
    const pendingRows = await db
      .select({
        id: serviceOrderEmailOutbox.id,
        organizationId: serviceOrderEmailOutbox.organizationId,
        serviceOrderId: serviceOrderEmailOutbox.serviceOrderId,
        targetStatus: serviceOrderEmailOutbox.targetStatus,
        eventKey: serviceOrderEmailOutbox.eventKey,
        payload: serviceOrderEmailOutbox.payload,
        attempts: serviceOrderEmailOutbox.attempts,
      })
      .from(serviceOrderEmailOutbox)
      .where(
        and(
          isNull(serviceOrderEmailOutbox.processedAt),
          lt(serviceOrderEmailOutbox.attempts, maxAttempts),
        ),
      )
      .orderBy(asc(serviceOrderEmailOutbox.createdAt))
      .limit(batchSize);

    for (const row of pendingRows) {
      try {
        // 2. Atomically claim: only proceed if we won the race.
        const claimed = await claimOutboxRow(row.id);
        if (!claimed) {
          // Another concurrent drain already claimed this row — skip silently.
          result.skipped++;
          continue;
        }

        result.processed++;

        // ==========================================================
        // MINI-SPEC I: B/C/D namespace routing
        // Route by eventKey namespace BEFORE the status_email path.
        // Guard: only enter this path if eventKey is a string (existing
        // status_email rows always have eventKey; defensive guard for tests).
        // ==========================================================
        const eventKey = row.eventKey;
        if (
          typeof eventKey === "string" &&
          row.payload !== undefined &&
          (eventKey === "nova_os" ||
            eventKey.startsWith("orcamento_sent:") ||
            eventKey.startsWith("quote_approved:") ||
            eventKey.startsWith("quote_rejected:"))
        ) {
          // Narrow the row to the subtype expected by dispatchBcdEmailForRow
          const bcdRow = { ...row, eventKey, payload: row.payload };
          let handled: boolean;
          try {
            handled = await dispatchBcdEmailForRow(bcdRow);
          } catch (bcdError) {
            console.error(
              `[ServiceOrderEmailDrain] dispatchBcdEmailForRow threw for outbox id=${row.id}:`,
              bcdError,
            );
            handled = false;
          }

          if (handled) {
            result.sent++;
          } else {
            // Dispatch failed — release for retry.
            const releaseMsg =
              "B/C/D dispatch did not complete — released for retry";
            try {
              await releaseOutboxRow(row.id, releaseMsg);
            } catch (releaseError) {
              console.error(
                `[ServiceOrderEmailDrain] Release failed for B/C/D outbox id=${row.id}:`,
                releaseError,
              );
            }
            result.released++;
          }
          continue;
        }

        // ==========================================================
        // EXISTING STATUS_EMAIL PATH (E/F/G — unchanged)
        // ==========================================================

        // 3. Re-load service order + customer (tenant-scoped by organizationId).
        // Raw SQL so the organization_id predicate is directly assertable in tests.
        const soResult = await db.execute(
          sql`SELECT id, public_id, organization_id, customer_id, service_order_number, client_contact_snapshot
              FROM service_order
              WHERE id = ${row.serviceOrderId} AND organization_id = ${row.organizationId}
              LIMIT 1`,
        );
        const soResultRows: unknown = Reflect.get(soResult, "rows") ?? soResult;
        const soRawRow: unknown = Array.isArray(soResultRows)
          ? soResultRows[0]
          : undefined;

        function parseSoRow(raw: unknown): ServiceOrderEmailData | undefined {
          if (typeof raw !== "object" || raw === null) return undefined;
          const id = Reflect.get(raw, "id");
          const publicId = Reflect.get(raw, "public_id");
          const orgId = Reflect.get(raw, "organization_id");
          const custId = Reflect.get(raw, "customer_id");
          const soNum = Reflect.get(raw, "service_order_number");
          const snapshot = Reflect.get(raw, "client_contact_snapshot");
          if (
            typeof id !== "number" ||
            typeof publicId !== "string" ||
            typeof orgId !== "string" ||
            typeof custId !== "number" ||
            typeof soNum !== "string"
          ) {
            return undefined;
          }
          return {
            id,
            publicId,
            organizationId: orgId,
            customerId: custId,
            serviceOrderNumber: soNum,
            clientContactSnapshot: toRecordOrNull(snapshot),
          };
        }

        const soRow = parseSoRow(soRawRow);
        if (!soRow) {
          console.warn(
            `[ServiceOrderEmailDrain] Service order ${row.serviceOrderId} not found for org ${row.organizationId} (outbox id=${row.id}); leaving processed.`,
          );
          result.skipped++;
          continue;
        }

        const custRows = await db
          .select({
            id: customer.id,
            name: customer.name,
            email: customer.email,
          })
          .from(customer)
          .where(eq(customer.id, soRow.customerId))
          .limit(1);

        const custRow = custRows[0];
        if (!custRow) {
          console.warn(
            `[ServiceOrderEmailDrain] Customer ${soRow.customerId} not found (outbox id=${row.id}); leaving processed.`,
          );
          result.skipped++;
          continue;
        }

        // 4. Dispatch the email.
        let sent: boolean;
        try {
          sent = await dispatchEmailForRow(row, soRow, custRow);
        } catch (sendError) {
          sent = false;
          console.error(
            `[ServiceOrderEmailDrain] dispatchEmailForRow threw for outbox id=${row.id}:`,
            sendError,
          );
        }

        if (sent) {
          result.sent++;
        } else {
          // 5. On failure: release back to pending for retry.
          const releaseMsg = "Send did not complete — released for retry";
          await releaseOutboxRow(row.id, releaseMsg);
          result.released++;
        }
      } catch (rowError) {
        // Best-effort: one bad row must not abort the batch.
        console.error(
          `[ServiceOrderEmailDrain] Unexpected error processing outbox row:`,
          rowError,
        );
        result.errors++;
      }
    }
  } catch (outerError) {
    // Best-effort: the SELECT itself failing must not throw out of the cron handler.
    console.error(
      "[ServiceOrderEmailDrain] Failed to fetch pending outbox rows:",
      outerError,
    );
    result.errors++;
  }

  console.log(
    `[ServiceOrderEmailDrain] Batch complete: ${JSON.stringify(result)}`,
  );

  return result;
}
