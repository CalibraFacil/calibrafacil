/**
 * "Orçamento Aprovado" email dispatch helper — mini-spec D (REQ-SOEMAIL-031).
 *
 * Called from approveServiceOrderQuoteManually() AND
 * approveServiceOrderQuoteByPortalUser() AFTER the approval transaction commits,
 * best-effort. A failed email must NEVER throw out of the approve commands.
 *
 * Uses:
 *  - sendServiceOrderCustomerEmail (mini-spec A dispatcher, already non-throwing)
 *  - getLabEmailBrand (from packages/notifications/src/service.ts)
 *  - QuoteApprovedEmail template from packages/email
 *
 * Mini-spec H note: dedup is applied by the CALLER via sendServiceOrderEmailOnce
 * with eventKey `orcamento_approved:<quoteId>`, not here — this keeps the helper
 * testable without a DB mock, exactly as mini-specs B and C do.
 */

import {
  sendServiceOrderCustomerEmail,
  getLabEmailBrand,
} from "@calibra-facil/notifications";
import type { ServiceOrderCustomerEmailResult } from "@calibra-facil/notifications";
import { QuoteApprovedEmail } from "@calibra-facil/email";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * All fields needed to dispatch the "Orçamento Aprovado" customer email.
 *
 * The caller (approve command wiring) must supply only data belonging to the
 * service order's own org/customer — tenant isolation is the caller's
 * responsibility (REQ-SOEMAIL-004).
 */
export interface OrcamentoAprovadoEmailDispatchInput {
  /** Numeric PK of the service order. */
  serviceOrderId: number;
  /**
   * Numeric PK of the quote being approved.
   * Used to build the per-quote idempotency key "orcamento_approved:<quoteId>"
   * so the send-once helper (mini-spec H) can dedup correctly.
   */
  quoteId: number;
  /** Human-readable OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** The lab's organization ID — used to resolve the white-label brand. */
  organizationId: string;
  /** Opaque public ID of the service order. */
  publicId: string;
  /** Numeric customer PK. */
  customerId: number;
  /**
   * Snapshot of the contact at intake (jsonb Record). Contains { email, name, … }
   * or null. The dispatcher resolves the recipient from this field first.
   */
  clientContactSnapshot: Record<string, unknown> | null | undefined;
  /** Customer name (for greeting). */
  customerName: string;
  /** Customer email — fallback if clientContactSnapshot has no email. */
  customerEmail: string | null | undefined;
  /**
   * REQ-SOEMAIL-031: The approved total from serviceOrder.totalApprovedCents.
   * This is the quote.totalCents value written to the service order row at
   * approval time. Passed as-is — never recomputed here.
   */
  totalApprovedCents: number;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch the "orçamento aprovado" customer email (REQ-SOEMAIL-031).
 *
 * Returns a ServiceOrderCustomerEmailResult so the CALLER can route through
 * sendServiceOrderEmailOnce (mini-spec H, REQ-SOEMAIL-007/008/009) using
 * eventKey `orcamento_approved:<quoteId>` — dedup is applied at the call site,
 * not here, so this helper remains testable without a DB mock.
 *
 * Best-effort: never throws. The CALLER wraps this in a try/catch so the
 * approve command is never affected by email failure.
 */
export async function dispatchOrcamentoAprovadoEmail(
  input: OrcamentoAprovadoEmailDispatchInput,
): Promise<ServiceOrderCustomerEmailResult> {
  try {
    // Resolve the lab white-label brand (REQ-SOEMAIL-003).
    const brand = await getLabEmailBrand(input.organizationId);

    return await sendServiceOrderCustomerEmail({
      serviceOrder: {
        id: input.serviceOrderId,
        publicId: input.publicId,
        organizationId: input.organizationId,
        customerId: input.customerId,
        serviceOrderNumber: input.serviceOrderNumber,
        clientContactSnapshot: input.clientContactSnapshot,
      },
      customer: {
        id: input.customerId,
        name: input.customerName,
        email: input.customerEmail,
      },
      brand,
      subject: `Orçamento ${input.serviceOrderNumber} aprovado`,
      renderEmail: (ctx) =>
        QuoteApprovedEmail({
          brand: ctx.brand,
          serviceOrderNumber: input.serviceOrderNumber,
          customerName: input.customerName,
          // REQ-SOEMAIL-031: pass persisted totalApprovedCents — not recomputed.
          totalApprovedCents: input.totalApprovedCents,
        }),
    });
  } catch (error) {
    // Best-effort: swallow all errors so the approve command is never affected.
    console.error(
      `[QuoteApprovedEmail] Failed to dispatch email for OS ${input.serviceOrderNumber} (id=${input.serviceOrderId}):`,
      error,
    );
    return { sent: false, error: String(error) };
  }
}
