/**
 * Thin wiring helpers that bridge the four quote-action commands to the
 * send-once + dispatcher layer.
 *
 * Extracted so that command-level wiring tests can assert "the right function
 * was called with the right args" without having to mock the entire DB
 * transaction layer end-to-end.
 *
 * Pattern mirrors mini-specs B and C: fire-and-forget `void (async)()` kept
 * here so the caller stays a single-line call.
 *
 * REQ-SOEMAIL-031 — approve paths → dispatchApprovedQuoteEmailOnce
 * REQ-SOEMAIL-032 — reject paths  → dispatchRejectedQuoteEmailOnce
 */

import { db } from "@calibra-facil/db";
import { customer } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { sendServiceOrderEmailOnce } from "./service-order-email-once";
import { dispatchOrcamentoAprovadoEmail } from "./orcamento-aprovado-email-dispatch";
import { dispatchOrcamentoRecusadoEmail } from "./orcamento-recusado-email-dispatch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Common order fields needed to build both email payloads.
 * Extracted from the post-commit order row in each command.
 */
export interface QuoteEmailOrderContext {
  organizationId: string;
  serviceOrderNumber: string;
  publicId: string;
  customerId: number;
  clientContactSnapshot: Record<string, unknown> | null | undefined;
}

/**
 * Input for dispatchApprovedQuoteEmailOnce (manual path).
 * The portal path provides customerName/customerEmail directly from the
 * linkedCustomer already resolved by the tenancy guard — see the portal variant.
 */
export interface DispatchApprovedQuoteEmailOnceInput {
  serviceOrderId: number;
  quoteId: number;
  totalApprovedCents: number;
  order: QuoteEmailOrderContext;
}

/**
 * Input for dispatchApprovedQuoteEmailOnce (portal path).
 * Same as manual but customer name/email come from linkedCustomer (no extra
 * DB lookup needed — already tenant-scoped by the portal guard).
 */
export interface DispatchApprovedQuoteEmailOncePortalInput {
  serviceOrderId: number;
  quoteId: number;
  totalApprovedCents: number;
  order: QuoteEmailOrderContext;
  customerName: string;
  customerEmail: string | null | undefined;
}

/**
 * Input for dispatchRejectedQuoteEmailOnce (manual path).
 */
export interface DispatchRejectedQuoteEmailOnceInput {
  serviceOrderId: number;
  quoteId: number;
  rejectionReason: string | null | undefined;
  order: QuoteEmailOrderContext;
}

/**
 * Input for dispatchRejectedQuoteEmailOnce (portal path).
 */
export interface DispatchRejectedQuoteEmailOncePortalInput {
  serviceOrderId: number;
  quoteId: number;
  rejectionReason: string | null | undefined;
  order: QuoteEmailOrderContext;
  customerName: string;
  customerEmail: string | null | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * REQ-SOEMAIL-031 (manual path): fire-and-forget approved email after the
 * approval transaction commits. Looks up customer name/email from DB then
 * routes through sendServiceOrderEmailOnce with eventKey
 * `orcamento_approved:<quoteId>`.
 *
 * Never throws — all errors are swallowed at the send-once level.
 */
export function dispatchApprovedQuoteEmailOnce(
  input: DispatchApprovedQuoteEmailOnceInput,
): void {
  void (async () => {
    try {
      const [customerRow] = await db
        .select({ name: customer.name, email: customer.email })
        .from(customer)
        .where(
          and(
            eq(customer.id, input.order.customerId),
            eq(customer.labOrganizationId, input.order.organizationId),
          ),
        )
        .limit(1);

      await sendServiceOrderEmailOnce({
        serviceOrderId: input.serviceOrderId,
        eventKey: `orcamento_approved:${input.quoteId}`,
        dispatch: () =>
          dispatchOrcamentoAprovadoEmail({
            serviceOrderId: input.serviceOrderId,
            quoteId: input.quoteId,
            serviceOrderNumber: input.order.serviceOrderNumber,
            organizationId: input.order.organizationId,
            publicId: input.order.publicId,
            customerId: input.order.customerId,
            clientContactSnapshot: input.order.clientContactSnapshot,
            customerName: customerRow?.name ?? "",
            customerEmail: customerRow?.email ?? null,
            totalApprovedCents: input.totalApprovedCents,
          }),
      });
    } catch (error) {
      console.error(
        `[dispatchApprovedQuoteEmailOnce] Failed for OS ${input.order.serviceOrderNumber}:`,
        error,
      );
    }
  })();
}

/**
 * REQ-SOEMAIL-031 (portal path): fire-and-forget approved email after the
 * portal approval transaction commits. Customer name/email are supplied by the
 * caller (already resolved and tenant-scoped by the portal tenancy guard) so
 * no extra DB lookup is needed.
 *
 * Never throws — all errors are swallowed at the send-once level.
 */
export function dispatchApprovedQuoteEmailOncePortal(
  input: DispatchApprovedQuoteEmailOncePortalInput,
): void {
  void (async () => {
    try {
      await sendServiceOrderEmailOnce({
        serviceOrderId: input.serviceOrderId,
        eventKey: `orcamento_approved:${input.quoteId}`,
        dispatch: () =>
          dispatchOrcamentoAprovadoEmail({
            serviceOrderId: input.serviceOrderId,
            quoteId: input.quoteId,
            serviceOrderNumber: input.order.serviceOrderNumber,
            organizationId: input.order.organizationId,
            publicId: input.order.publicId,
            customerId: input.order.customerId,
            clientContactSnapshot: input.order.clientContactSnapshot,
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            totalApprovedCents: input.totalApprovedCents,
          }),
      });
    } catch (error) {
      console.error(
        `[dispatchApprovedQuoteEmailOncePortal] Failed for OS ${input.order.serviceOrderNumber}:`,
        error,
      );
    }
  })();
}

/**
 * REQ-SOEMAIL-032 (manual path): fire-and-forget rejected email after the
 * rejection transaction commits. Looks up customer name/email from DB then
 * routes through sendServiceOrderEmailOnce with eventKey
 * `orcamento_rejected:<quoteId>`.
 *
 * Never throws — all errors are swallowed at the send-once level.
 */
export function dispatchRejectedQuoteEmailOnce(
  input: DispatchRejectedQuoteEmailOnceInput,
): void {
  void (async () => {
    try {
      const [customerRow] = await db
        .select({ name: customer.name, email: customer.email })
        .from(customer)
        .where(
          and(
            eq(customer.id, input.order.customerId),
            eq(customer.labOrganizationId, input.order.organizationId),
          ),
        )
        .limit(1);

      await sendServiceOrderEmailOnce({
        serviceOrderId: input.serviceOrderId,
        eventKey: `orcamento_rejected:${input.quoteId}`,
        dispatch: () =>
          dispatchOrcamentoRecusadoEmail({
            serviceOrderId: input.serviceOrderId,
            quoteId: input.quoteId,
            serviceOrderNumber: input.order.serviceOrderNumber,
            organizationId: input.order.organizationId,
            publicId: input.order.publicId,
            customerId: input.order.customerId,
            clientContactSnapshot: input.order.clientContactSnapshot,
            customerName: customerRow?.name ?? "",
            customerEmail: customerRow?.email ?? null,
            rejectionReason: input.rejectionReason ?? null,
          }),
      });
    } catch (error) {
      console.error(
        `[dispatchRejectedQuoteEmailOnce] Failed for OS ${input.order.serviceOrderNumber}:`,
        error,
      );
    }
  })();
}

/**
 * REQ-SOEMAIL-032 (portal path): fire-and-forget rejected email after the
 * portal rejection transaction commits. Customer name/email are supplied by
 * the caller (already resolved and tenant-scoped by the portal tenancy guard).
 *
 * Never throws — all errors are swallowed at the send-once level.
 */
export function dispatchRejectedQuoteEmailOncePortal(
  input: DispatchRejectedQuoteEmailOncePortalInput,
): void {
  void (async () => {
    try {
      await sendServiceOrderEmailOnce({
        serviceOrderId: input.serviceOrderId,
        eventKey: `orcamento_rejected:${input.quoteId}`,
        dispatch: () =>
          dispatchOrcamentoRecusadoEmail({
            serviceOrderId: input.serviceOrderId,
            quoteId: input.quoteId,
            serviceOrderNumber: input.order.serviceOrderNumber,
            organizationId: input.order.organizationId,
            publicId: input.order.publicId,
            customerId: input.order.customerId,
            clientContactSnapshot: input.order.clientContactSnapshot,
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            rejectionReason: input.rejectionReason ?? null,
          }),
      });
    } catch (error) {
      console.error(
        `[dispatchRejectedQuoteEmailOncePortal] Failed for OS ${input.order.serviceOrderNumber}:`,
        error,
      );
    }
  })();
}
