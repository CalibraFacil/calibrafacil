/**
 * Mini-spec I — Payload schemas for B/C/D outbox emails.
 *
 * Defines Zod schemas for the `payload` column of `service_order_email_outbox`
 * rows whose `eventKey` belongs to one of the B/C/D namespaces:
 *
 *   nova_os           → NovaOsOutboxPayloadSchema
 *   orcamento_sent:*  → OrcamentoSentOutboxPayloadSchema
 *   quote_approved:*  → QuoteApprovedOutboxPayloadSchema
 *   quote_rejected:*  → QuoteRejectedOutboxPayloadSchema
 *
 * These schemas are the contract that:
 *  - PART 2 (command wiring) fills when it enqueues the row
 *  - The drain router reads when it dispatches the email
 *
 * Each schema mirrors the corresponding dispatch-helper input interface
 * (`NovaOsEmailDispatchInput`, `NovoOrcamentoEmailDispatchInput`,
 * `OrcamentoAprovadoEmailDispatchInput`, `OrcamentoRecusadoEmailDispatchInput`)
 * so the drain can pass the parsed payload directly to the helper.
 *
 * No `as` type assertions — use `.safeParse()` + type guards throughout.
 */

import { z } from "zod";
import { db } from "@calibra-facil/db";
import { serviceOrderEmailOutbox } from "@calibra-facil/db/schema";

// =============================================================================
// Helpers
// =============================================================================

/**
 * A nullable, optional string field — common to several dispatch inputs.
 */
const nullableString = z.string().nullable().optional();

/**
 * clientContactSnapshot: a record of unknown values or null, serialised to
 * JSON in the outbox payload. The drain passes it to the dispatcher as-is.
 */
const clientContactSnapshotSchema = z
  .record(z.string(), z.unknown())
  .nullable()
  .optional();

// =============================================================================
// nova_os payload schema (matches NovaOsEmailDispatchInput)
// =============================================================================

/**
 * Payload stored for a `nova_os` outbox row.
 *
 * Field list (mirrors NovaOsEmailDispatchInput):
 *  serviceOrderId       number
 *  serviceOrderNumber   string
 *  organizationId       string
 *  publicId             string
 *  customerId           number
 *  clientContactSnapshot  Record<string,unknown> | null | undefined
 *  customerName         string
 *  customerEmail        string | null | undefined
 *  assetManufacturer    string | null | undefined
 *  assetModel           string | null | undefined
 *  assetSerialNumber    string | null | undefined
 *  openedAt             string (ISO-8601; deserialized to Date by the drain)
 *  claimedDefect        string
 */
export const NovaOsOutboxPayloadSchema = z.object({
  serviceOrderId: z.number().int(),
  serviceOrderNumber: z.string().min(1),
  organizationId: z.string().min(1),
  publicId: z.string().min(1),
  customerId: z.number().int(),
  clientContactSnapshot: clientContactSnapshotSchema,
  customerName: z.string().min(1),
  customerEmail: nullableString,
  assetManufacturer: nullableString,
  assetModel: nullableString,
  assetSerialNumber: nullableString,
  openedAt: z.string().min(1), // ISO-8601; drain converts to Date
  claimedDefect: z.string(),
});

export type NovaOsOutboxPayload = z.infer<typeof NovaOsOutboxPayloadSchema>;

// =============================================================================
// orcamento_sent payload schema (matches NovoOrcamentoEmailDispatchInput)
// =============================================================================

/**
 * A single quote item stored in the orcamento_sent payload.
 * Mirrors QuoteEmailItem from @calibra-facil/email.
 */
const orcamentoItemSchema = z.object({
  id: z.number().int(),
  type: z.string(),
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  unitPriceCents: z.number().int(),
  totalPriceCents: z.number().int(),
});

/**
 * Payload stored for an `orcamento_sent:<quoteId>` outbox row.
 *
 * Field list (mirrors NovoOrcamentoEmailDispatchInput):
 *  serviceOrderId           number
 *  quoteId                  number
 *  serviceOrderNumber       string
 *  organizationId           string
 *  publicId                 string
 *  customerId               number
 *  clientContactSnapshot    Record<string,unknown> | null | undefined
 *  customerName             string
 *  customerEmail            string | null | undefined
 *  customerTaxId            string | null | undefined
 *  assetManufacturer        string | null | undefined
 *  assetModel               string | null | undefined
 *  assetInventoryCode       string | null | undefined
 *  openedAt                 string (ISO-8601)
 *  assetSerialNumber        string | null | undefined
 *  displaySpecs             {label:string;value:string}[] | null | undefined
 *  claimedDefect            string
 *  items                    QuoteEmailItem[]
 *  subtotalServicesCents    number
 *  subtotalPartsCents       number
 *  freightCents             number
 *  discountCents            number
 *  totalCents               number
 *  publicAccessToken        string
 *  portalAppUrl             string
 */
export const OrcamentoSentOutboxPayloadSchema = z.object({
  serviceOrderId: z.number().int(),
  quoteId: z.number().int(),
  serviceOrderNumber: z.string().min(1),
  organizationId: z.string().min(1),
  publicId: z.string().min(1),
  customerId: z.number().int(),
  clientContactSnapshot: clientContactSnapshotSchema,
  customerName: z.string().min(1),
  customerEmail: nullableString,
  customerTaxId: nullableString,
  assetManufacturer: nullableString,
  assetModel: nullableString,
  assetInventoryCode: nullableString,
  openedAt: z.string().min(1),
  assetSerialNumber: nullableString,
  displaySpecs: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .nullable()
    .optional(),
  claimedDefect: z.string(),
  items: z.array(orcamentoItemSchema),
  subtotalServicesCents: z.number().int(),
  subtotalPartsCents: z.number().int(),
  freightCents: z.number().int(),
  discountCents: z.number().int(),
  totalCents: z.number().int(),
  publicAccessToken: z.string().min(1),
  // REQ-QPUB-020/021: human-typeable approval code captured at send time.
  // OPTIONAL on purpose — rows enqueued before the code feature shipped carry
  // none and must still send (the template renders the code conditionally).
  approvalCode: z.string().min(1).optional(),
  portalAppUrl: z.string().min(1),
});

export type OrcamentoSentOutboxPayload = z.infer<
  typeof OrcamentoSentOutboxPayloadSchema
>;

// =============================================================================
// quote_approved payload schema (matches OrcamentoAprovadoEmailDispatchInput)
// =============================================================================

/**
 * Payload stored for a `quote_approved:<quoteId>` outbox row.
 *
 * Field list (mirrors OrcamentoAprovadoEmailDispatchInput):
 *  serviceOrderId       number
 *  quoteId              number
 *  serviceOrderNumber   string
 *  organizationId       string
 *  publicId             string
 *  customerId           number
 *  clientContactSnapshot  Record<string,unknown> | null | undefined
 *  customerName         string
 *  customerEmail        string | null | undefined
 *  totalApprovedCents   number
 */
export const QuoteApprovedOutboxPayloadSchema = z.object({
  serviceOrderId: z.number().int(),
  quoteId: z.number().int(),
  serviceOrderNumber: z.string().min(1),
  organizationId: z.string().min(1),
  publicId: z.string().min(1),
  customerId: z.number().int(),
  clientContactSnapshot: clientContactSnapshotSchema,
  customerName: z.string().min(1),
  customerEmail: nullableString,
  totalApprovedCents: z.number().int(),
});

export type QuoteApprovedOutboxPayload = z.infer<
  typeof QuoteApprovedOutboxPayloadSchema
>;

// =============================================================================
// quote_rejected payload schema (matches OrcamentoRecusadoEmailDispatchInput)
// =============================================================================

/**
 * Payload stored for a `quote_rejected:<quoteId>` outbox row.
 *
 * Field list (mirrors OrcamentoRecusadoEmailDispatchInput):
 *  serviceOrderId       number
 *  quoteId              number
 *  serviceOrderNumber   string
 *  organizationId       string
 *  publicId             string
 *  customerId           number
 *  clientContactSnapshot  Record<string,unknown> | null | undefined
 *  customerName         string
 *  customerEmail        string | null | undefined
 *  rejectionReason      string | null | undefined
 */
export const QuoteRejectedOutboxPayloadSchema = z.object({
  serviceOrderId: z.number().int(),
  quoteId: z.number().int(),
  serviceOrderNumber: z.string().min(1),
  organizationId: z.string().min(1),
  publicId: z.string().min(1),
  customerId: z.number().int(),
  clientContactSnapshot: clientContactSnapshotSchema,
  customerName: z.string().min(1),
  customerEmail: nullableString,
  rejectionReason: nullableString,
});

export type QuoteRejectedOutboxPayload = z.infer<
  typeof QuoteRejectedOutboxPayloadSchema
>;

// =============================================================================
// Discriminated parse helper
// =============================================================================

/**
 * Result type for parseOutboxPayloadByNamespace.
 */
export type OutboxPayloadParseResult =
  | { namespace: "nova_os"; payload: NovaOsOutboxPayload }
  | { namespace: "orcamento_sent"; payload: OrcamentoSentOutboxPayload }
  | { namespace: "quote_approved"; payload: QuoteApprovedOutboxPayload }
  | { namespace: "quote_rejected"; payload: QuoteRejectedOutboxPayload }
  | { namespace: "unknown" }
  | { namespace: "invalid"; error: string };

/**
 * Determine the eventKey namespace and parse the payload with the matching schema.
 *
 * Routing rules (keyed by the start of `eventKey`):
 *   "nova_os"        → NovaOsOutboxPayloadSchema
 *   "orcamento_sent" → OrcamentoSentOutboxPayloadSchema
 *   "quote_approved" → QuoteApprovedOutboxPayloadSchema
 *   "quote_rejected" → QuoteRejectedOutboxPayloadSchema
 *   other            → { namespace: "unknown" }
 *
 * Returns `{ namespace: "invalid", error }` when the schema parse fails —
 * the drain treats this as a graceful skip.
 *
 * No `as` assertions — uses `.safeParse()` + tagged result objects.
 */
export function parseOutboxPayloadByNamespace(
  eventKey: string,
  rawPayload: unknown,
): OutboxPayloadParseResult {
  if (eventKey === "nova_os") {
    const result = NovaOsOutboxPayloadSchema.safeParse(rawPayload);
    if (!result.success) {
      return { namespace: "invalid", error: result.error.message };
    }
    return { namespace: "nova_os", payload: result.data };
  }

  if (eventKey.startsWith("orcamento_sent:")) {
    const result = OrcamentoSentOutboxPayloadSchema.safeParse(rawPayload);
    if (!result.success) {
      return { namespace: "invalid", error: result.error.message };
    }
    return { namespace: "orcamento_sent", payload: result.data };
  }

  if (eventKey.startsWith("quote_approved:")) {
    const result = QuoteApprovedOutboxPayloadSchema.safeParse(rawPayload);
    if (!result.success) {
      return { namespace: "invalid", error: result.error.message };
    }
    return { namespace: "quote_approved", payload: result.data };
  }

  if (eventKey.startsWith("quote_rejected:")) {
    const result = QuoteRejectedOutboxPayloadSchema.safeParse(rawPayload);
    if (!result.success) {
      return { namespace: "invalid", error: result.error.message };
    }
    return { namespace: "quote_rejected", payload: result.data };
  }

  return { namespace: "unknown" };
}

// =============================================================================
// Typed enqueue helper
// =============================================================================

/**
 * The executor type accepted by enqueueServiceOrderEmail — matches the
 * `ServiceOrderDbExecutor` used throughout service-order-workflow.ts so PART 2
 * can pass a transaction executor directly.
 */
type DbExecutor = Pick<typeof db, "insert" | "select" | "update" | "delete">;

/**
 * Parameters for enqueueServiceOrderEmail.
 */
export interface EnqueueServiceOrderEmailParams {
  organizationId: string;
  unitId: number | null | undefined;
  serviceOrderId: number;
  /**
   * Stable per-transition dedup key, e.g.:
   *   "nova_os"
   *   "orcamento_sent:42"
   *   "quote_approved:42"
   *   "quote_rejected:42"
   *
   * PART 2 constructs this from the event type and the quoteId (for C/D).
   */
  eventKey: string;
  /**
   * The current service order status (or empty string) at enqueue time.
   * Stored in targetStatus for visibility; NOT used for routing in the drain
   * (routing is by eventKey namespace, not targetStatus, for B/C/D rows).
   */
  targetStatus: string;
  /**
   * The per-email payload. Must satisfy the schema for the given eventKey
   * namespace so the drain can parse and dispatch correctly. PART 2 constructs
   * this from live command data.
   */
  payload: Record<string, unknown>;
}

/**
 * Insert ONE `serviceOrderEmailOutbox` row using the provided executor.
 *
 * The `executor` parameter MUST be passed by PART 2 (command wiring) so that
 * when the triggering command runs inside a database transaction, the outbox
 * row commits atomically with the command's effect (REQ-SOEMAIL-072).
 *
 * `onConflictDoNothing` on UNIQUE(serviceOrderId, eventKey) deduplicates
 * concurrent enqueues (REQ-SOEMAIL-074).
 *
 * Does NOT validate the payload — the caller (PART 2) is responsible for
 * constructing a valid payload that matches the eventKey namespace schema.
 */
export async function enqueueServiceOrderEmail(
  params: EnqueueServiceOrderEmailParams,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .insert(serviceOrderEmailOutbox)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId ?? null,
      serviceOrderId: params.serviceOrderId,
      eventKey: params.eventKey,
      targetStatus: params.targetStatus,
      payload: params.payload,
      attempts: 0,
    })
    .onConflictDoNothing({
      target: [
        serviceOrderEmailOutbox.serviceOrderId,
        serviceOrderEmailOutbox.eventKey,
      ],
    });
}
