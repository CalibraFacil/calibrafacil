/**
 * "Nova OS" email dispatch helper — mini-spec B (REQ-SOEMAIL-011, REQ-SOEMAIL-012).
 *
 * Called from createServiceOrder() AFTER the creation transaction commits,
 * best-effort. A failed email must not throw out of createServiceOrder.
 *
 * Uses:
 *  - sendServiceOrderCustomerEmail (mini-spec A dispatcher, already non-throwing)
 *  - getLabEmailBrand (additively exported from packages/notifications/src/service.ts)
 *  - NovaOsEmail template from packages/email
 */

import {
  sendServiceOrderCustomerEmail,
  getLabEmailBrand,
} from "@calibra-facil/notifications";
import { NovaOsEmail } from "@calibra-facil/email";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * All fields needed to dispatch the Nova OS email.
 *
 * The caller (createServiceOrder) must supply only data belonging to the
 * service order's own org/customer — tenant isolation is the caller's
 * responsibility (REQ-SOEMAIL-004).
 */
export interface NovaOsEmailDispatchInput {
  /** Numeric PK of the created service order. */
  serviceOrderId: number;
  /** Human-readable OS number, e.g. "OS-2024-001". */
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
  /** Asset manufacturer / brand (from serviceOrderAssetSnapshot). */
  assetManufacturer: string | null | undefined;
  /** Asset model (from serviceOrderAssetSnapshot). */
  assetModel: string | null | undefined;
  /** Asset serial number (from serviceOrderAssetSnapshot). */
  assetSerialNumber: string | null | undefined;
  /** Service order intake timestamp (openedAt). */
  openedAt: Date;
  /** The claimed defect description. */
  claimedDefect: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a date as a Brazilian-locale date string (DD/MM/YYYY).
 * Uses UTC interpretation so tests using `new Date("2026-06-19T00:00:00.000Z")`
 * produce "19/06/2026" regardless of server TZ.
 */
function formatDateBR(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch the "nova OS" customer email (REQ-SOEMAIL-011).
 *
 * - REQ-SOEMAIL-012: If no contact email resolves, the dispatcher skips
 *   silently (mini-spec A's sendServiceOrderCustomerEmail already does this).
 *   This function wraps the entire operation in a try/catch so ANY unexpected
 *   error (brand resolution failure, template error, etc.) is swallowed —
 *   the OS creation must never be rolled back by email failure.
 *
 * Never throws.
 *
 * Mini-spec H note: dedup is applied by the caller (createServiceOrder) via
 * sendServiceOrderEmailOnce, not here — this keeps this function testable
 * without a DB mock.
 */
export async function dispatchNovaOsEmail(
  input: NovaOsEmailDispatchInput,
): Promise<import("@calibra-facil/notifications").ServiceOrderCustomerEmailResult> {
  try {
    // Resolve the lab white-label brand (REQ-SOEMAIL-003).
    // Wrapped here because getLabEmailBrand can fail if the DB is unavailable.
    const brand = await getLabEmailBrand(input.organizationId);

    const intakeDate = formatDateBR(input.openedAt);

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
      subject: `Ordem de Serviço ${input.serviceOrderNumber} recebida`,
      renderEmail: (ctx) =>
        NovaOsEmail({
          brand: ctx.brand,
          serviceOrderNumber: input.serviceOrderNumber,
          customerName: input.customerName,
          assetManufacturer: input.assetManufacturer,
          assetModel: input.assetModel,
          assetSerialNumber: input.assetSerialNumber,
          intakeDate,
          claimedDefect: input.claimedDefect,
        }),
    });
  } catch (error) {
    // REQ-SOEMAIL-012: email failure must never propagate to the caller.
    console.error(
      `[NovaOsEmail] Failed to dispatch email for OS ${input.serviceOrderNumber} (id=${input.serviceOrderId}):`,
      error,
    );
    return { sent: false, error: String(error) };
  }
}
