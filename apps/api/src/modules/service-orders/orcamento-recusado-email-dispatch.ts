/**
 * "Orçamento Recusado" email dispatch helper — mini-spec D (REQ-SOEMAIL-032).
 *
 * Called from rejectServiceOrderQuoteManually() AND
 * rejectServiceOrderQuoteByPortalUser() AFTER the rejection transaction commits,
 * best-effort. A failed email must NEVER throw out of the reject commands.
 *
 * Uses:
 *  - sendServiceOrderCustomerEmail (mini-spec A dispatcher, already non-throwing)
 *  - getLabEmailBrand (from packages/notifications/src/service.ts)
 *  - OrcamentoRecusadoEmail template from packages/email
 *
 * Mini-spec H note: dedup is applied by the CALLER via sendServiceOrderEmailOnce
 * with eventKey `orcamento_rejected:<quoteId>`, not here — this keeps the helper
 * testable without a DB mock, exactly as mini-specs B and C do.
 */

import {
  sendServiceOrderCustomerEmail,
  getLabEmailBrand,
} from "@calibra-facil/notifications";
import type { ServiceOrderCustomerEmailResult } from "@calibra-facil/notifications";
import { OrcamentoRecusadoEmail } from "@calibra-facil/email";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * All fields needed to dispatch the "Orçamento Recusado" customer email.
 *
 * The caller (reject command wiring) must supply only data belonging to the
 * service order's own org/customer — tenant isolation is the caller's
 * responsibility (REQ-SOEMAIL-004).
 */
export interface OrcamentoRecusadoEmailDispatchInput {
  /** Numeric PK of the service order. */
  serviceOrderId: number;
  /**
   * Numeric PK of the quote being rejected.
   * Used to build the per-quote idempotency key "orcamento_rejected:<quoteId>"
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
   * REQ-SOEMAIL-032: The rejection reason — rendered when present; passed as
   * null/undefined when not provided (e.g. portal rejections without a reason).
   */
  rejectionReason?: string | null;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch the "orçamento recusado" customer email (REQ-SOEMAIL-032).
 *
 * Returns a ServiceOrderCustomerEmailResult so the CALLER can route through
 * sendServiceOrderEmailOnce (mini-spec H, REQ-SOEMAIL-007/008/009) using
 * eventKey `orcamento_rejected:<quoteId>` — dedup is applied at the call site,
 * not here, so this helper remains testable without a DB mock.
 *
 * Best-effort: never throws. The CALLER wraps this in a try/catch so the
 * reject command is never affected by email failure.
 */
export async function dispatchOrcamentoRecusadoEmail(
  input: OrcamentoRecusadoEmailDispatchInput,
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
      subject: `Orçamento ${input.serviceOrderNumber} não aprovado`,
      renderEmail: (ctx) =>
        OrcamentoRecusadoEmail({
          brand: ctx.brand,
          serviceOrderNumber: input.serviceOrderNumber,
          customerName: input.customerName,
          // REQ-SOEMAIL-032: pass the rejection reason when present.
          rejectionReason: input.rejectionReason,
        }),
    });
  } catch (error) {
    // Best-effort: swallow all errors so the reject command is never affected.
    console.error(
      `[OrcamentoRecusadoEmail] Failed to dispatch email for OS ${input.serviceOrderNumber} (id=${input.serviceOrderId}):`,
      error,
    );
    return { sent: false, error: String(error) };
  }
}
