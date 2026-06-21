/**
 * "Novo Orçamento" email dispatch helper — mini-spec C
 * (REQ-SOEMAIL-021, REQ-SOEMAIL-022, REQ-SOEMAIL-023, REQ-SOEMAIL-024).
 *
 * Called from sendServiceOrderQuote() AFTER the quote status transitions to
 * "sent" and the token has been created, best-effort. A failed email must
 * NEVER throw out of sendServiceOrderQuote.
 *
 * Key design constraints:
 *  - REQ-023 [HIGH RISK]: The publicAccessToken is the RAW token returned by
 *    createPublicServiceOrderAccessToken inside sendServiceOrderQuote. The
 *    CALLER captures and passes it; this helper does NOT mint a new token.
 *  - REQ-022 [HIGH RISK]: Persisted totals (subtotalServicesCents,
 *    subtotalPartsCents, freightCents, discountCents, totalCents) are passed
 *    straight through to the template. The template MUST NOT recompute them.
 *  - REQ-023: internalNotes is NOT a field on this input or the template.
 *  - REQ-024: BRL formatting from integer cents is done inside the template
 *    via formatMoney from @calibra-facil/shared (no float drift).
 */

import {
  sendServiceOrderCustomerEmail,
  getLabEmailBrand,
} from "@calibra-facil/notifications";
import type { ServiceOrderCustomerEmailResult } from "@calibra-facil/notifications";
import { NovoOrcamentoEmail } from "@calibra-facil/email";
import type { NovoOrcamentoEmailItem } from "@calibra-facil/email";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { NovoOrcamentoEmailItem };

/**
 * All fields needed to dispatch the "Novo Orçamento" customer email.
 *
 * The caller (sendServiceOrderQuote wiring) must supply only data belonging
 * to the service order's own org/customer — tenant isolation is the caller's
 * responsibility (REQ-SOEMAIL-004).
 *
 * REQ-SOEMAIL-023 [HIGH RISK]: `publicAccessToken` is the raw token returned
 * by `createPublicServiceOrderAccessToken` inside `sendServiceOrderQuote`.
 * It must be captured before this function is called and passed in directly.
 * This function does NOT create or re-mint tokens.
 */
export interface NovoOrcamentoEmailDispatchInput {
  /** Numeric PK of the service order. */
  serviceOrderId: number;
  /**
   * Numeric PK of the quote being sent.
   * Used to build the per-quote idempotency key "orcamento_sent:<quoteId>"
   * so a genuinely new quote version still sends (mini-spec H, REQ-SOEMAIL-008).
   */
  quoteId: number;
  /** Human-readable OS number, e.g. "OS-2026-001". */
  serviceOrderNumber: string;
  /** The lab's organization ID — used to resolve the white-label brand. */
  organizationId: string;
  /** Opaque public ID of the service order (used for URL building). */
  publicId: string;
  /** Numeric customer PK. */
  customerId: number;
  /**
   * Snapshot of the contact at intake (jsonb Record). Contains { email, name, … }
   * or null. The dispatcher resolves the recipient from this field first.
   */
  clientContactSnapshot: Record<string, unknown> | null | undefined;
  /** Customer name (Razão Social). */
  customerName: string;
  /** Customer email — fallback if clientContactSnapshot has no email. */
  customerEmail: string | null | undefined;
  /** Customer CNPJ/CPF (taxId). */
  customerTaxId?: string | null;

  // ---- Asset / Instrument fields (REQ-SOEMAIL-021) ----
  /** Asset manufacturer / brand. */
  assetManufacturer?: string | null;
  /** Asset model. */
  assetModel?: string | null;
  /** Asset inventory code (tag / cliente code). */
  assetInventoryCode?: string | null;
  /** Service order intake timestamp (openedAt). */
  openedAt: Date;
  /** Asset serial number. */
  assetSerialNumber?: string | null;
  /**
   * REQ-SOEMAIL-025: instrument-agnostic spec rows from
   * `serviceOrderAssetSnapshot.displaySpecs` (`[{label,value}]`). Passed as-is
   * to the template — NO hardcoded weighing fields.
   */
  displaySpecs?: { label: string; value: string }[] | null;
  /** Claimed defect description. */
  claimedDefect: string;

  // ---- Quote items (REQ-SOEMAIL-022) ----
  /**
   * All quote items. Passed straight through to the template for grouping.
   * REQ-022: totals are NOT recomputed from items — use the persisted *Cents fields.
   */
  items: NovoOrcamentoEmailItem[];

  // ---- Persisted totals (REQ-SOEMAIL-022) [HIGH RISK] ----
  /** From serviceOrderQuote.subtotalServicesCents — passed as-is. */
  subtotalServicesCents: number;
  /** From serviceOrderQuote.subtotalPartsCents — passed as-is. */
  subtotalPartsCents: number;
  /** From serviceOrderQuote.freightCents — passed as-is. */
  freightCents: number;
  /** From serviceOrderQuote.discountCents — passed as-is. */
  discountCents: number;
  /** From serviceOrderQuote.totalCents — passed as-is. */
  totalCents: number;

  // ---- Approval URL (REQ-SOEMAIL-023) [HIGH RISK] ----
  /**
   * The raw token returned by createPublicServiceOrderAccessToken inside
   * sendServiceOrderQuote. MUST be the same token — do not re-mint.
   *
   * The approval URL is composed as:
   *   `${portalAppUrl}/service-order-access/${publicAccessToken}`
   */
  publicAccessToken: string;
  /**
   * Base URL for the portal, e.g. "https://portal.calibrafacil.com".
   * Comes from PORTAL_APP_URL env var. The caller resolves this.
   */
  portalAppUrl: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as a Brazilian locale date string (DD/MM/YYYY).
 * Uses UTC to be consistent with test assertions using new Date("...T00:00:00.000Z").
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
 * Dispatch the "novo orçamento" customer email (mini-spec C).
 *
 * Returns a ServiceOrderCustomerEmailResult so the CALLER can route through
 * sendServiceOrderEmailOnce (mini-spec H, REQ-SOEMAIL-007/008/009) using
 * eventKey `orcamento_sent:<quoteId>` — dedup is applied at the call site,
 * not here, so this helper remains testable without a DB mock.
 *
 * Best-effort: the CALLER wraps this in a try/catch so sendServiceOrderQuote
 * is never affected by email failure. Never throws.
 */
export async function dispatchNovoOrcamentoEmail(
  input: NovoOrcamentoEmailDispatchInput,
): Promise<ServiceOrderCustomerEmailResult> {
  try {
    // Resolve the lab white-label brand (REQ-SOEMAIL-003).
    const brand = await getLabEmailBrand(input.organizationId);

    const intakeDate = formatDateBR(input.openedAt);

    // REQ-SOEMAIL-023 [HIGH RISK]: build approval URL from the captured token.
    // The token was returned by createPublicServiceOrderAccessToken inside
    // sendServiceOrderQuote. We use it directly — no new token is minted here.
    const portalBase = input.portalAppUrl.replace(/\/$/, "");
    const approvalUrl = `${portalBase}/service-order-access/${input.publicAccessToken}`;

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
      subject: `Orçamento ${input.serviceOrderNumber} aguardando sua aprovação`,
      renderEmail: (ctx) =>
        NovoOrcamentoEmail({
          brand: ctx.brand,
          serviceOrderNumber: input.serviceOrderNumber,
          customerName: input.customerName,
          customerTaxId: input.customerTaxId,
          assetManufacturer: input.assetManufacturer,
          assetModel: input.assetModel,
          assetInventoryCode: input.assetInventoryCode,
          intakeDate,
          assetSerialNumber: input.assetSerialNumber,
          displaySpecs: input.displaySpecs,
          claimedDefect: input.claimedDefect,
          // REQ-SOEMAIL-022 [HIGH RISK]: pass persisted totals directly —
          // do NOT recompute from items.
          items: input.items,
          subtotalServicesCents: input.subtotalServicesCents,
          subtotalPartsCents: input.subtotalPartsCents,
          freightCents: input.freightCents,
          discountCents: input.discountCents,
          totalCents: input.totalCents,
          // REQ-SOEMAIL-023 [HIGH RISK]: approval URL from captured token.
          approvalUrl,
          // internalNotes is NOT passed — it is intentionally absent (REQ-023).
        }),
    });
  } catch (error) {
    // Best-effort: swallow all errors so sendServiceOrderQuote is never affected.
    console.error(
      `[NovoOrcamentoEmail] Failed to dispatch email for OS ${input.serviceOrderNumber} (id=${input.serviceOrderId}):`,
      error,
    );
    return { sent: false, error: String(error) };
  }
}
