// =============================================================================
// ASAAS SERVICE - Main Exports
// =============================================================================

// Client
export {
  AsaasClient,
  AsaasError,
  getAsaasClient,
  resetAsaasClient,
} from "./client";

// Customer operations
export {
  createCustomer,
  getCustomer,
  updateCustomer,
  findCustomerByCpfCnpj,
  findCustomerByExternalReference,
  deleteCustomer,
} from "./customers";

// Subscription operations
export { createCheckout, getCheckout, cancelCheckout } from "./checkouts";

export {
  createPayment,
  getPayment,
  listPayments,
  cancelPayment,
} from "./payments";

export {
  createSubscription,
  createCreditCardSubscription,
  getSubscription,
  updateSubscription,
  cancelSubscription,
  getSubscriptionPayments,
  getPaymentPixQrCode,
  getPaymentBoletoLine,
  formatAsaasDate,
  calculateNextBillingDate,
  calculatePeriodEnd,
  tokenizeCreditCard,
} from "./subscriptions";

// Types
export type {
  AsaasEnvironment,
  AsaasBillingType,
  AsaasCycle,
  AsaasSubscriptionStatus,
  AsaasPaymentStatus,
  AsaasCheckoutChargeType,
  AsaasCustomer,
  CreateCustomerInput,
  AsaasSubscription,
  CreateSubscriptionInput,
  CreatePaymentInput,
  CreditCardInput,
  CreditCardHolderInfo,
  CreateCreditCardSubscriptionInput,
  AsaasPayment,
  AsaasPaymentList,
  AsaasCheckoutItem,
  AsaasCheckoutCustomerData,
  AsaasCheckoutCallback,
  CreateCheckoutInput,
  AsaasCheckout,
  AsaasWebhookEventType,
  AsaasWebhookPayload,
  AsaasErrorDetail,
  AsaasErrorResponse,
  AsaasPixQrCode,
  TokenizeCreditCardInput,
  TokenizeCreditCardResponse,
} from "./types";
