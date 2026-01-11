import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import {
  webhookEventLog,
  subscription,
  paymentHistory,
  type PaymentStatus,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import type {
  AsaasWebhookPayload,
  AsaasPayment,
  AsaasSubscription,
} from "../services/asaas/types";
import { calculatePeriodEnd } from "../services/asaas";

// =============================================================================
// WEBHOOK ROUTES - Handle Asaas webhook events
// =============================================================================

export const webhooksRouter = new Hono()
  // =========================================================================
  // POST /asaas - Handle Asaas webhook events
  // =========================================================================
  .post("/asaas", async (c) => {
    let payload: AsaasWebhookPayload;

    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    // Generate event ID (Asaas sends id in payload, or we generate one)
    const eventId =
      payload.id || `${payload.event}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // =======================================================================
    // STEP 1: Idempotency check - Store event first
    // =======================================================================
    try {
      await db.insert(webhookEventLog).values({
        eventId,
        eventType: payload.event,
        payload: payload as unknown as Record<string, unknown>,
      });
    } catch (error: unknown) {
      // Check for unique constraint violation (duplicate event)
      if (isUniqueConstraintError(error)) {
        // Already processed this event - return success
        console.log(`Duplicate webhook event: ${eventId}`);
        return c.json({ received: true, duplicate: true }, 200);
      }
      // Other database errors
      console.error("Error storing webhook event:", error);
      return c.json({ error: "Failed to store event" }, 500);
    }

    // =======================================================================
    // STEP 2: Process the event
    // =======================================================================
    try {
      await processWebhookEvent(payload);

      // Mark as processed
      await db
        .update(webhookEventLog)
        .set({ processedAt: new Date() })
        .where(eq(webhookEventLog.eventId, eventId));

      console.log(`Webhook processed: ${payload.event} (${eventId})`);
    } catch (error) {
      // Log error but still return 200 to prevent retry storms
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await db
        .update(webhookEventLog)
        .set({ processingError: errorMessage })
        .where(eq(webhookEventLog.eventId, eventId));

      console.error(`Webhook processing error: ${payload.event}`, error);
    }

    // Always return 200 after storing (Asaas best practice)
    return c.json({ received: true }, 200);
  });

// =============================================================================
// EVENT PROCESSING
// =============================================================================

async function processWebhookEvent(payload: AsaasWebhookPayload) {
  const { event, payment, subscription: sub } = payload;

  switch (event) {
    // Payment events
    case "PAYMENT_CREATED":
      if (payment) await handlePaymentCreated(payment);
      break;

    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED":
      if (payment) await handlePaymentConfirmed(payment);
      break;

    case "PAYMENT_OVERDUE":
      if (payment) await handlePaymentOverdue(payment);
      break;

    case "PAYMENT_DELETED":
    case "PAYMENT_REFUNDED":
      if (payment) await handlePaymentCanceled(payment);
      break;

    // Subscription events
    case "SUBSCRIPTION_INACTIVATED":
    case "SUBSCRIPTION_DELETED":
      if (sub) await handleSubscriptionCanceled(sub);
      break;

    case "SUBSCRIPTION_UPDATED":
      if (sub) await handleSubscriptionUpdated(sub);
      break;

    default:
      console.log(`Unhandled webhook event: ${event}`);
  }
}

// =============================================================================
// PAYMENT HANDLERS
// =============================================================================

/**
 * Handle new payment created
 */
async function handlePaymentCreated(payment: AsaasPayment) {
  // Find subscription by Asaas ID
  const sub = await findSubscriptionByAsaasId(payment.subscription);
  if (!sub) {
    console.warn(`No subscription found for payment: ${payment.id}`);
    return;
  }

  // Check if payment already exists
  const existingPayment = await db.query.paymentHistory.findFirst({
    where: eq(paymentHistory.asaasPaymentId, payment.id),
  });

  if (existingPayment) {
    // Update existing payment (mark as WEBHOOK-confirmed)
    await db
      .update(paymentHistory)
      .set({
        status: mapPaymentStatus(payment.status),
        source: "WEBHOOK", // Overwrite CHECKOUT source with canonical WEBHOOK
        dueDate: payment.dueDate ? new Date(payment.dueDate) : null,
        asaasInvoiceUrl: payment.invoiceUrl,
        asaasBankSlipUrl: payment.bankSlipUrl,
      })
      .where(eq(paymentHistory.id, existingPayment.id));
  } else {
    // Create new payment record from webhook (canonical source)
    await db.insert(paymentHistory).values({
      subscriptionId: sub.id,
      organizationId: sub.organizationId,
      asaasPaymentId: payment.id,
      amount: Math.round(payment.value * 100), // Convert to centavos
      netAmount: payment.netValue ? Math.round(payment.netValue * 100) : null,
      currency: "BRL",
      paymentMethod: mapBillingType(payment.billingType),
      status: mapPaymentStatus(payment.status),
      source: "WEBHOOK",
      dueDate: payment.dueDate ? new Date(payment.dueDate) : null,
      asaasInvoiceUrl: payment.invoiceUrl,
      asaasBankSlipUrl: payment.bankSlipUrl,
      cardLast4: payment.creditCard?.creditCardNumber?.slice(-4),
      cardBrand: payment.creditCard?.creditCardBrand,
    });
  }
}

/**
 * Handle payment confirmed/received - Activate subscription
 */
async function handlePaymentConfirmed(payment: AsaasPayment) {
  // Update payment status (mark as WEBHOOK-confirmed)
  await db
    .update(paymentHistory)
    .set({
      status: "RECEIVED",
      source: "WEBHOOK",
      paidAt: new Date(),
      netAmount: payment.netValue ? Math.round(payment.netValue * 100) : null,
    })
    .where(eq(paymentHistory.asaasPaymentId, payment.id));

  // Find and activate subscription
  const sub = await findSubscriptionByAsaasId(payment.subscription);
  if (!sub) return;

  // If subscription was pending/trial, activate it
  if (sub.status === "TRIAL" || sub.status === "PAST_DUE") {
    const cycle = sub.billingCycle || "MONTHLY";
    const periodStart = new Date();
    const periodEnd = calculatePeriodEnd(periodStart, cycle);

    await db
      .update(subscription)
      .set({
        status: "ACTIVE",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
      })
      .where(eq(subscription.id, sub.id));

    console.log(`Subscription activated: ${sub.id}`);
  }
}

/**
 * Handle payment overdue - Mark subscription as past due
 */
async function handlePaymentOverdue(payment: AsaasPayment) {
  // Update payment status (mark as WEBHOOK-confirmed)
  await db
    .update(paymentHistory)
    .set({ status: "OVERDUE", source: "WEBHOOK" })
    .where(eq(paymentHistory.asaasPaymentId, payment.id));

  // Find and mark subscription as past due
  const sub = await findSubscriptionByAsaasId(payment.subscription);
  if (!sub) return;

  if (sub.status === "ACTIVE") {
    await db
      .update(subscription)
      .set({ status: "PAST_DUE" })
      .where(eq(subscription.id, sub.id));

    console.log(`Subscription marked as PAST_DUE: ${sub.id}`);
  }
}

/**
 * Handle payment canceled/refunded
 */
async function handlePaymentCanceled(payment: AsaasPayment) {
  const status = payment.status === "REFUNDED" ? "REFUNDED" : "DELETED";

  await db
    .update(paymentHistory)
    .set({ status, source: "WEBHOOK" })
    .where(eq(paymentHistory.asaasPaymentId, payment.id));
}

// =============================================================================
// SUBSCRIPTION HANDLERS
// =============================================================================

/**
 * Handle subscription canceled/deleted
 */
async function handleSubscriptionCanceled(sub: AsaasSubscription) {
  await db
    .update(subscription)
    .set({
      status: "CANCELED",
      canceledAt: new Date(),
    })
    .where(eq(subscription.asaasSubscriptionId, sub.id));

  console.log(`Subscription canceled: ${sub.id}`);
}

/**
 * Handle subscription updated
 */
async function handleSubscriptionUpdated(sub: AsaasSubscription) {
  const status = sub.status === "ACTIVE" ? "ACTIVE" : "CANCELED";

  await db
    .update(subscription)
    .set({ status })
    .where(eq(subscription.asaasSubscriptionId, sub.id));
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Find subscription by Asaas subscription ID
 */
async function findSubscriptionByAsaasId(asaasSubscriptionId?: string) {
  if (!asaasSubscriptionId) return null;

  return db.query.subscription.findFirst({
    where: eq(subscription.asaasSubscriptionId, asaasSubscriptionId),
  });
}

/**
 * Check if error is a unique constraint violation
 */
function isUniqueConstraintError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    // PostgreSQL unique violation code
    return (error as { code: string }).code === "23505";
  }
  return false;
}

/**
 * Map Asaas billing type to our PaymentMethod
 */
function mapBillingType(
  billingType: string
): "CREDIT_CARD" | "PIX" | "BOLETO" {
  switch (billingType) {
    case "CREDIT_CARD":
      return "CREDIT_CARD";
    case "PIX":
      return "PIX";
    case "BOLETO":
    default:
      return "BOLETO";
  }
}

/**
 * Map Asaas payment status to our PaymentStatus
 */
function mapPaymentStatus(status: string): PaymentStatus {
  // Most Asaas statuses map directly to our PaymentStatus type
  return status as PaymentStatus;
}
