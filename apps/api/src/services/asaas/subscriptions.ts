import { getAsaasClient } from "./client";
import type {
  AsaasSubscription,
  AsaasPayment,
  AsaasPaymentList,
  AsaasPixQrCode,
  CreateSubscriptionInput,
  CreateCreditCardSubscriptionInput,
  TokenizeCreditCardInput,
  TokenizeCreditCardResponse,
} from "./types";

// =============================================================================
// SUBSCRIPTION SERVICE
// =============================================================================

/**
 * Create a subscription with Boleto or PIX (no card data needed)
 */
export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<AsaasSubscription> {
  const client = getAsaasClient();
  return client.post<AsaasSubscription>("/subscriptions", input);
}

/**
 * Create a subscription with credit card
 *
 * The card is validated at creation time, but the first charge
 * only occurs on nextDueDate.
 */
export async function createCreditCardSubscription(
  input: CreateCreditCardSubscriptionInput,
): Promise<AsaasSubscription> {
  const client = getAsaasClient();
  return client.post<AsaasSubscription>("/subscriptions", input);
}

/**
 * Tokenize a credit card for PCI-DSS compliance.
 *
 * This should be called from a dedicated endpoint that handles card data
 * transiently. The returned token can then be used for subscriptions/payments.
 */
export async function tokenizeCreditCard(
  input: TokenizeCreditCardInput,
): Promise<TokenizeCreditCardResponse> {
  const client = getAsaasClient();
  return client.post<TokenizeCreditCardResponse>("/creditCard/tokenize", input);
}

/**
 * Get a subscription by ID
 */
export async function getSubscription(
  subscriptionId: string,
): Promise<AsaasSubscription> {
  const client = getAsaasClient();
  return client.get<AsaasSubscription>(`/subscriptions/${subscriptionId}`);
}

/**
 * Update a subscription (only for BOLETO/PIX, not credit card)
 *
 * @param updatePendingPayments - If true, also updates pending payments
 */
export async function updateSubscription(
  subscriptionId: string,
  input: Partial<CreateSubscriptionInput>,
  updatePendingPayments = false,
): Promise<AsaasSubscription> {
  const client = getAsaasClient();
  return client.put<AsaasSubscription>(`/subscriptions/${subscriptionId}`, {
    ...input,
    updatePendingPayments,
  });
}

/**
 * Cancel/Inactivate a subscription
 */
export async function cancelSubscription(
  subscriptionId: string,
): Promise<AsaasSubscription> {
  const client = getAsaasClient();
  return client.delete<AsaasSubscription>(`/subscriptions/${subscriptionId}`);
}

/**
 * Get all payments for a subscription
 */
export async function getSubscriptionPayments(
  subscriptionId: string,
  options?: {
    offset?: number;
    limit?: number;
    status?: string;
  },
): Promise<AsaasPaymentList> {
  const client = getAsaasClient();
  return client.get<AsaasPaymentList>(
    `/subscriptions/${subscriptionId}/payments`,
    {
      offset: options?.offset,
      limit: options?.limit,
      status: options?.status,
    },
  );
}

// =============================================================================
// PAYMENT SERVICE (for individual payments)
// =============================================================================

/**
 * Get a payment by ID
 */
export async function getPayment(paymentId: string): Promise<AsaasPayment> {
  const client = getAsaasClient();
  return client.get<AsaasPayment>(`/payments/${paymentId}`);
}

/**
 * Get PIX QR Code for a payment
 *
 * Note: Only available for payments with billingType = PIX
 */
export async function getPaymentPixQrCode(
  paymentId: string,
): Promise<AsaasPixQrCode> {
  const client = getAsaasClient();
  return client.get<AsaasPixQrCode>(`/payments/${paymentId}/pixQrCode`);
}

/**
 * Get the barcode line (linha digitavel) for a Boleto
 *
 * Note: Only available for payments with billingType = BOLETO
 */
export async function getPaymentBoletoLine(
  paymentId: string,
): Promise<{
  identificationField: string;
  nossoNumero: string;
  barCode: string;
}> {
  const client = getAsaasClient();
  return client.get(`/payments/${paymentId}/identificationField`);
}

/**
 * List payments with optional filters
 */
export async function listPayments(options?: {
  customer?: string;
  subscription?: string;
  status?: string;
  billingType?: string;
  offset?: number;
  limit?: number;
}): Promise<AsaasPaymentList> {
  const client = getAsaasClient();
  return client.get<AsaasPaymentList>("/payments", options);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format a date for Asaas API (YYYY-MM-DD)
 */
export function formatAsaasDate(date: Date): string {
  return date.toISOString().split("T")[0]!;
}

/**
 * Calculate the next billing date based on cycle
 */
export function calculateNextBillingDate(
  startDate: Date,
  cycle: "MONTHLY" | "YEARLY",
): Date {
  const next = new Date(startDate);
  if (cycle === "MONTHLY") {
    next.setMonth(next.getMonth() + 1);
  } else {
    next.setFullYear(next.getFullYear() + 1);
  }
  return next;
}

/**
 * Calculate period end date based on billing cycle
 */
export function calculatePeriodEnd(
  startDate: Date,
  cycle: "MONTHLY" | "YEARLY",
): Date {
  const end = new Date(startDate);
  if (cycle === "MONTHLY") {
    end.setMonth(end.getMonth() + 1);
    end.setDate(end.getDate() - 1);
  } else {
    end.setFullYear(end.getFullYear() + 1);
    end.setDate(end.getDate() - 1);
  }
  return end;
}
