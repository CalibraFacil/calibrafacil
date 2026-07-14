/**
 * Outbox drain for service-order lifecycle emails (mini-spec E2 + mini-spec I).
 *
 * Drains the `service_order_email_outbox` table and sends the matching
 * customer email template for each pending row. The drain is designed for
 * best-effort, idempotent delivery:
 *
 *  1. SELECT pending rows: processed_at IS NULL (not yet done) AND attempts <
 *     maxAttempts AND the row is not currently leased (claimed_at IS NULL OR
 *     claimed_at older than the lease window), ordered by created_at (uses the
 *     pending index), bounded by batch size.
 *  2. ATOMICALLY CLAIM each row by taking a short lease:
 *       UPDATE ... SET claimed_at = now()
 *       WHERE id = $1 AND processed_at IS NULL
 *         AND (claimed_at IS NULL OR claimed_at < now() - lease)
 *       RETURNING id
 *     Only proceed if a row was returned — this is the idempotency guard, and it
 *     also lets a row whose previous lease expired (a drain killed mid-send) be
 *     reclaimed instead of stranded.
 *  3. Re-load service order + customer data, resolve the template, send email.
 *  4. On success (or a graceful skip): MARK DONE (processed_at = now()).
 *  5. On send failure: RELEASE the lease (claimed_at = NULL, attempts++,
 *     last_error set) so the row is retried.
 *  6. Best-effort: one bad row never aborts the batch; function never throws. A
 *     row that throws after being claimed is NOT marked done, so its lease
 *     simply expires and the next drain reclaims it.
 *
 * Template selection / routing:
 *
 *   eventKey namespace       → path
 *   ──────────────────────────────────────────────────────────────────
 *   "status_email:*"         → STATUS_EMAIL_MAP (E/F/G), sent via sendServiceOrderEmailOnce
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
import { isReleaseExhausting } from "./observability-alerts";

// =============================================================================
// CONSTANTS
// =============================================================================

// Each row reloads the service order + customer, renders a template, and sends
// an email (network) sequentially, all inside the cron's 30s maxDuration. A
// batch sized so the whole drain reliably finishes well under 30s minimises the
// chance of being killed mid-batch. If that does happen, the claimed_at lease
// (see below) lets the in-flight row recover on a later drain, and the
// at-most-once ledger keeps a recovered-but-already-sent row from being
// re-emailed. At the */30min cadence (kept sparse so the Neon compute can
// suspend between runs), 20 rows/run keeps the backlog draining with margin
// to spare.
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_ATTEMPTS = 3;
// How long a claim lease is held before another drain may reclaim the row. Must
// exceed the worst-case time to process one row (re-load + render + send) but be
// short enough that a row stranded by a killed run recovers within a few drain
// cycles. The cron runs every 30 min and its function maxDuration is 30s, so
// 120s comfortably covers an in-flight row while bounding strand recovery.
const CLAIM_LEASE_SECONDS = 120;

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
 * Atomically claim a single outbox row by taking a short lease.
 * Returns the row id when claimed, undefined if it is already done or another
 * drain holds a live lease. The WHERE clause is the idempotency guard:
 *   - `processed_at IS NULL` — never re-send a row already marked done.
 *   - `claimed_at IS NULL OR claimed_at < now() - lease` — a fresh lease blocks
 *     concurrent drains, but an expired lease (a run killed mid-send) is
 *     reclaimable, so the row recovers instead of stranding.
 */
async function claimOutboxRow(rowId: number): Promise<ClaimResult | undefined> {
  const result = await db.execute(
    sql`UPDATE service_order_email_outbox
        SET claimed_at = now()
        WHERE id = ${rowId}
          AND processed_at IS NULL
          AND (claimed_at IS NULL OR claimed_at < now() - (${CLAIM_LEASE_SECONDS}::int * interval '1 second'))
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
 * Clears the lease (claimed_at), increments attempts, records the error. The
 * row stays pending (processed_at is still NULL) so the next drain retries it.
 *
 * REQ-REL-OBS-003: when this release EXHAUSTS the row (the incremented attempts
 * reach maxAttempts, so the drain will never select it again), also stamp
 * `dead_letter_at = now()`. That turns the previously-silent exhaustion into a
 * queryable state the backoffice surfaces and the operator-alert engine pages
 * on. The stamp is written in the SAME UPDATE (one statement) so nothing else in
 * the drain's call sequence changes. Two SQL variants (rather than a CASE with a
 * bound flag) keep the dead-letter write assertable in the drain's SQL-text unit
 * tests.
 */
async function releaseOutboxRow(
  rowId: number,
  errorMessage: string,
  deadLetter: boolean,
): Promise<void> {
  if (deadLetter) {
    await db.execute(
      sql`UPDATE service_order_email_outbox
          SET claimed_at = NULL,
              attempts = attempts + 1,
              last_error = ${errorMessage},
              dead_letter_at = now()
          WHERE id = ${rowId}`,
    );
    return;
  }
  await db.execute(
    sql`UPDATE service_order_email_outbox
        SET claimed_at = NULL,
            attempts = attempts + 1,
            last_error = ${errorMessage}
        WHERE id = ${rowId}`,
  );
}

/**
 * Mark a claimed row as terminally done. Set on a successful send and on a
 * graceful skip (e.g. the service order / customer no longer exists), so the
 * row is never re-leased. The `processed_at IS NULL` guard in the claim ensures
 * a done row is never picked up again.
 *
 * REQ-QPUB-008 [HIGH RISK]: with `redactCredentials`, the raw credential
 * fields (`publicAccessToken`, `approvalCode`) are overwritten with
 * "[REDACTED]" in the SAME statement that marks the row sent, so a sent row
 * never keeps a live credential at rest while a retry-eligible (released) row
 * keeps its payload intact for the retry. `jsonb_set(..., false)` is a no-op
 * per missing key, so legacy rows and other namespaces pass through unchanged.
 * The placeholder (not key removal) keeps the payload valid for
 * parseOutboxPayloadByNamespace's z.string().min(1) on any later read. Two SQL
 * variants (not a CASE) keep the redaction assertable in SQL-text unit tests,
 * mirroring releaseOutboxRow.
 */
async function markOutboxRowProcessed(
  rowId: number,
  options: { redactCredentials: boolean },
): Promise<void> {
  if (options.redactCredentials) {
    await db.execute(
      sql`UPDATE service_order_email_outbox
          SET processed_at = now(),
              payload = jsonb_set(
                jsonb_set(payload, '{publicAccessToken}', '"[REDACTED]"', false),
                '{approvalCode}', '"[REDACTED]"', false)
          WHERE id = ${rowId}`,
    );
    return;
  }
  await db.execute(
    sql`UPDATE service_order_email_outbox
        SET processed_at = now()
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
    const outcome = await sendServiceOrderEmailOnce({
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
    // "sent"/"deduped" → done; "failed" → release the outbox row for retry.
    return outcome !== "failed";
  }

  if (parseResult.namespace === "orcamento_sent") {
    const p = parseResult.payload;
    const outcome = await sendServiceOrderEmailOnce({
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
          approvalCode: p.approvalCode ?? null,
          portalAppUrl: p.portalAppUrl,
        }),
    });
    // "sent"/"deduped" → done; "failed" → release for retry BEFORE any
    // credential redaction (REQ-QPUB-008 keeps retryable payloads intact).
    return outcome !== "failed";
  }

  if (parseResult.namespace === "quote_approved") {
    const p = parseResult.payload;
    const outcome = await sendServiceOrderEmailOnce({
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
    return outcome !== "failed";
  }

  if (parseResult.namespace === "quote_rejected") {
    const p = parseResult.payload;
    const outcome = await sendServiceOrderEmailOnce({
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
    return outcome !== "failed";
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

  // Route through the at-most-once ledger (service_order_email_log keyed by
  // serviceOrderId + eventKey) — same as the B/C/D path. This is what makes the
  // lease-based strand recovery safe for status emails: if a drain delivered the
  // email but died before marking the outbox row done, the lease expires and the
  // row is reclaimed, but the ledger key is already recorded → dispatch is
  // skipped ("deduped"), so the customer is NOT emailed twice.
  const outcome = await sendServiceOrderEmailOnce({
    serviceOrderId: so.id,
    eventKey: row.eventKey ?? `status_email:${row.targetStatus}`,
    dispatch: () =>
      sendServiceOrderCustomerEmail({
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
      }),
  });

  // "sent"/"deduped" → terminal success (mark the outbox row done).
  // "failed" → release the outbox row for retry (transient send/DB failure).
  return outcome !== "failed";
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
          // Not currently leased: never claimed, or the lease has expired (a
          // prior drain was killed mid-send) so the row is reclaimable.
          sql`(${serviceOrderEmailOutbox.claimedAt} IS NULL OR ${serviceOrderEmailOutbox.claimedAt} < now() - (${CLAIM_LEASE_SECONDS}::int * interval '1 second'))`,
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
            // Terminal success — mark done so the lease isn't reclaimed.
            // orcamento_sent payloads carry raw credentials → redact on send.
            await markOutboxRowProcessed(row.id, {
              redactCredentials: eventKey.startsWith("orcamento_sent:"),
            });
            result.sent++;
          } else {
            // Dispatch failed — release for retry (or dead-letter if exhausted).
            const releaseMsg =
              "B/C/D dispatch did not complete — released for retry";
            try {
              await releaseOutboxRow(
                row.id,
                releaseMsg,
                isReleaseExhausting(row.attempts, maxAttempts),
              );
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
            `[ServiceOrderEmailDrain] Service order ${row.serviceOrderId} not found for org ${row.organizationId} (outbox id=${row.id}); marking processed.`,
          );
          // Graceful terminal skip — the SO is gone, so mark done (don't let the
          // lease expire and re-pick it forever).
          await markOutboxRowProcessed(row.id, { redactCredentials: false });
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
            `[ServiceOrderEmailDrain] Customer ${soRow.customerId} not found (outbox id=${row.id}); marking processed.`,
          );
          // Graceful terminal skip — mark done so the lease isn't re-claimed.
          await markOutboxRowProcessed(row.id, { redactCredentials: false });
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
          // Terminal success — mark done so the lease isn't reclaimed.
          await markOutboxRowProcessed(row.id, { redactCredentials: false });
          result.sent++;
        } else {
          // 5. On failure: release the lease back to pending for retry (or
          // dead-letter the row if this failure exhausts its attempts).
          const releaseMsg = "Send did not complete — released for retry";
          await releaseOutboxRow(
            row.id,
            releaseMsg,
            isReleaseExhausting(row.attempts, maxAttempts),
          );
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
