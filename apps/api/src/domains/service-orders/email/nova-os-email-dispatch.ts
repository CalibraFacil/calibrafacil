/**
 * "Nova OS" email dispatch helper (REQ-SOEMAIL-011, REQ-SOEMAIL-012).
 *
 * Called from createServiceOrder() AFTER the creation transaction commits,
 * best-effort. A failed email must not throw out of createServiceOrder.
 *
 * Uses:
 *  - sendServiceOrderCustomerEmail (the dispatcher, already non-throwing)
 *  - getLabEmailBrand (additively exported from packages/notifications/src/service.ts)
 *  - ServiceOrderCreatedEmail template from packages/email
 */

import {
  sendServiceOrderCustomerEmail,
  getLabEmailBrand,
} from "@calibra-facil/notifications";
import { formatInstant } from "@calibra-facil/shared/format";
import { ServiceOrderCreatedEmail } from "@calibra-facil/email";

/**
 * All fields needed to dispatch the Nova OS email.
 *
 * The caller (createServiceOrder) must supply only data belonging to the
 * service order's own org/customer — tenant isolation is the caller's
 * responsibility (REQ-SOEMAIL-004).
 */
export interface NovaOsEmailDispatchInput {
  serviceOrderId: number;
  /** Human-readable OS number, e.g. "OS-2024-001". */
  serviceOrderNumber: string;
  /** The lab's organization ID — used to resolve the white-label brand. */
  organizationId: string;
  publicId: string;
  customerId: number;
  /**
   * Snapshot of the contact at intake (jsonb Record). Contains { email, name, … }
   * or null. The dispatcher resolves the recipient from this field first.
   */
  clientContactSnapshot: Record<string, unknown> | null | undefined;
  customerName: string;
  /** Customer email — fallback if clientContactSnapshot has no email. */
  customerEmail: string | null | undefined;
  /** Asset manufacturer / brand (from serviceOrderAssetSnapshot). */
  assetManufacturer: string | null | undefined;
  /** Asset model (from serviceOrderAssetSnapshot). */
  assetModel: string | null | undefined;
  /** Asset serial number (from serviceOrderAssetSnapshot). */
  assetSerialNumber: string | null | undefined;
  openedAt: Date;
  claimedDefect: string;
}

/**
 * Dispatch the "nova OS" customer email (REQ-SOEMAIL-011).
 *
 * - REQ-SOEMAIL-012: If no contact email resolves, the dispatcher skips
 *   silently (sendServiceOrderCustomerEmail already does this).
 *   This function wraps the entire operation in a try/catch so ANY unexpected
 *   error (brand resolution failure, template error, etc.) is swallowed —
 *   the OS creation must never be rolled back by email failure.
 *
 * Never throws.
 *
 * Dedup is applied by the caller (createServiceOrder) via
 * sendServiceOrderEmailOnce, not here — this keeps this function testable
 * without a DB mock.
 */
export async function dispatchNovaOsEmail(
  input: NovaOsEmailDispatchInput,
): Promise<
  import("@calibra-facil/notifications").ServiceOrderCustomerEmailResult
> {
  try {
    // Resolve the lab white-label brand (REQ-SOEMAIL-003).
    // Wrapped here because getLabEmailBrand can fail if the DB is unavailable.
    const brand = await getLabEmailBrand(input.organizationId);

    const intakeDate = formatInstant(input.openedAt);

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
        ServiceOrderCreatedEmail({
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
      `[ServiceOrderCreatedEmail] Failed to dispatch email for OS ${input.serviceOrderNumber} (id=${input.serviceOrderId}):`,
      error,
    );
    return { sent: false, error: String(error) };
  }
}
