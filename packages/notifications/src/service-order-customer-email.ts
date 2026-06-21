/**
 * Customer-facing service-order email dispatcher.
 *
 * This is a SIBLING to sendNotification() — it does NOT use recipientUserId.
 * Recipient is resolved from serviceOrder.clientContactSnapshot.email or
 * customer.email directly (REQ-SOEMAIL-001, 002).
 *
 * Design:
 *  - Caller supplies a renderEmail callback that returns a React element.
 *    This decouples the layout/template choice from the dispatcher.
 *  - Brand is supplied by the caller (resolved via
 *    getLabEmailBrand(serviceOrder.organizationId) before calling here) so
 *    the dispatcher never fetches data from another org (REQ-SOEMAIL-003, 004).
 *  - Resend transport errors are caught and returned as a failure result;
 *    they never propagate to the caller (REQ-SOEMAIL-005).
 */

import { Resend } from "resend";
import { render } from "@react-email/render";
import type { EmailBrand } from "@calibra-facil/email";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Minimal service-order shape required by the dispatcher.
 * Callers pass only the fields needed for recipient resolution and tenant
 * scoping — no cross-tenant data can sneak in (REQ-SOEMAIL-004).
 */
export interface ServiceOrderDispatchTarget {
  id: number;
  publicId: string;
  organizationId: string;
  customerId: number;
  serviceOrderNumber: string;
  /**
   * Stored as jsonb Record<string, unknown> — parsed defensively.
   * May contain { email, name, phone, … } or be null/undefined.
   */
  clientContactSnapshot: Record<string, unknown> | null | undefined;
}

/**
 * Minimal customer shape — only the fields needed for recipient fallback.
 */
export interface CustomerDispatchTarget {
  id: number;
  name: string;
  email: string | null | undefined;
}

/**
 * Context object passed to the renderEmail callback so the template has
 * access to all data it needs from a single typed argument.
 */
export interface ServiceOrderEmailRenderContext {
  serviceOrder: ServiceOrderDispatchTarget;
  customer: CustomerDispatchTarget;
  brand: EmailBrand | undefined;
}

/**
 * Input for sendServiceOrderCustomerEmail.
 *
 * The caller is responsible for:
 *  - Loading the service order from the correct organizationId scope.
 *  - Loading the customer that belongs to that service order.
 *  - Resolving the brand via getLabEmailBrand(serviceOrder.organizationId).
 *  - Providing a renderEmail that returns the email React element.
 */
export interface ServiceOrderEmailInput {
  serviceOrder: ServiceOrderDispatchTarget;
  customer: CustomerDispatchTarget;
  /** Brand resolved from getLabEmailBrand(serviceOrder.organizationId). */
  brand: EmailBrand | undefined;
  /** Email subject line (pt-BR). */
  subject: string;
  /**
   * Callback that renders the email React element given the context.
   * This keeps the dispatcher template-agnostic so each lifecycle event
   * (mini-specs B–G) can supply its own template while sharing this path.
   * Returns React.ReactNode (accepted by @react-email/render) or null to skip.
   */
  renderEmail: (ctx: ServiceOrderEmailRenderContext) => React.ReactNode;
}

/** Result returned by sendServiceOrderCustomerEmail (never throws). */
export type ServiceOrderCustomerEmailResult =
  | { sent: true; skipped?: false; emailId?: string; error?: undefined }
  | {
      sent: false;
      skipped: true;
      skipReason: string;
      error?: undefined;
    }
  | { sent: false; skipped?: false; error: string };

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Validate that a string is a plausible email address.
 * Minimal check: non-empty string that contains "@".
 * The full SMTP validation happens at the transport level.
 */
function isValidEmailAddress(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.includes("@")
  );
}

/**
 * REQ-SOEMAIL-001: Resolve the recipient email address.
 *
 * Priority:
 *  1. serviceOrder.clientContactSnapshot.email — parsed defensively from jsonb.
 *  2. customer.email — fallback.
 *
 * Returns undefined when neither source yields a valid address.
 */
export function resolveServiceOrderRecipient(
  serviceOrder: ServiceOrderDispatchTarget,
  customer: CustomerDispatchTarget,
): string | undefined {
  // 1. Try clientContactSnapshot.email
  const snapshot = serviceOrder.clientContactSnapshot;
  if (snapshot !== null && snapshot !== undefined) {
    const snapshotEmail = snapshot["email"];
    if (isValidEmailAddress(snapshotEmail)) {
      return snapshotEmail.trim();
    }
  }

  // 2. Fall back to customer.email
  const fallback = customer.email;
  if (isValidEmailAddress(fallback)) {
    return fallback.trim();
  }

  return undefined;
}

function sanitizeMailHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function getEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return match?.[1]?.trim() ?? value.trim();
}

function formatFromEmail(fromEmail: string, brand: EmailBrand | undefined): string {
  if (!brand?.isWhiteLabel) return fromEmail;
  return `${sanitizeMailHeader(brand.name)} via CalibraFácil <${getEmailAddress(fromEmail)}>`;
}

function getReplyToEmail(brand: EmailBrand | undefined): string | undefined {
  const email = brand?.supportEmail?.trim();
  if (!email || !email.includes("@")) return undefined;
  return sanitizeMailHeader(email);
}

// =============================================================================
// CORE DISPATCHER
// =============================================================================

/**
 * Send a customer-facing transactional email for a service-order lifecycle event.
 *
 * - REQ-SOEMAIL-001: recipient resolved from clientContactSnapshot → customer.email.
 * - REQ-SOEMAIL-002: no valid address → returns skipped result, no throw.
 * - REQ-SOEMAIL-003: brand applied via renderEmail context (caller resolved it).
 * - REQ-SOEMAIL-004: only data from the service order's own org/customer.
 * - REQ-SOEMAIL-005: Resend transport error → returns failure result, no throw.
 *
 * Never throws — always returns a ServiceOrderCustomerEmailResult.
 */
export async function sendServiceOrderCustomerEmail(
  input: ServiceOrderEmailInput,
): Promise<ServiceOrderCustomerEmailResult> {
  const { serviceOrder, customer, brand, subject, renderEmail } = input;

  // REQ-SOEMAIL-001/002: resolve recipient
  const recipientEmail = resolveServiceOrderRecipient(serviceOrder, customer);
  if (!recipientEmail) {
    console.info(
      `[ServiceOrderEmail] No recipient address for OS ${serviceOrder.serviceOrderNumber} (id=${serviceOrder.id}); skipping.`,
    );
    return {
      sent: false,
      skipped: true,
      skipReason: "No valid recipient address could be resolved",
    } satisfies ServiceOrderCustomerEmailResult;
  }

  // Check Resend configuration
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!resendApiKey || !fromEmail) {
    console.error(
      "[ServiceOrderEmail] EMAIL MISCONFIGURED: RESEND_API_KEY or RESEND_FROM_EMAIL not set.",
    );
    return {
      sent: false,
      skipped: true,
      skipReason: "Email transport not configured",
    } satisfies ServiceOrderCustomerEmailResult;
  }

  // REQ-SOEMAIL-003/004: render via caller-supplied callback.
  // Context contains only this service order's own data.
  const ctx: ServiceOrderEmailRenderContext = {
    serviceOrder,
    customer,
    brand,
  };

  const emailElement = renderEmail(ctx);

  if (!emailElement) {
    console.info(
      `[ServiceOrderEmail] renderEmail returned null for OS ${serviceOrder.serviceOrderNumber}; skipping.`,
    );
    return {
      sent: false,
      skipped: true,
      skipReason: "renderEmail returned no element",
    } satisfies ServiceOrderCustomerEmailResult;
  }

  // REQ-SOEMAIL-005: wrap Resend call in try/catch — never propagate
  try {
    const html = await render(emailElement);
    const resend = new Resend(resendApiKey);

    const response = await resend.emails.send({
      from: formatFromEmail(fromEmail, brand),
      to: recipientEmail,
      subject: sanitizeMailHeader(subject),
      html,
      replyTo: getReplyToEmail(brand),
    });

    const emailId =
      response.data && typeof response.data === "object" && "id" in response.data
        ? String(response.data.id)
        : undefined;

    return {
      sent: true,
      emailId,
    } satisfies ServiceOrderCustomerEmailResult;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown transport error";
    console.error(
      `[ServiceOrderEmail] Failed to send email for OS ${serviceOrder.serviceOrderNumber}:`,
      error,
    );
    return {
      sent: false,
      error: message,
    } satisfies ServiceOrderCustomerEmailResult;
  }
}
