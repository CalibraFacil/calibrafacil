// =============================================================================
// ASAAS SERVICE - Main Exports
// =============================================================================

// Client
export { AsaasClient, AsaasError, getAsaasClient, resetAsaasClient } from "./client";

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
export {
  createSubscription,
  createCreditCardSubscription,
  getSubscription,
  updateSubscription,
  cancelSubscription,
  getSubscriptionPayments,
  getPayment,
  getPaymentPixQrCode,
  getPaymentBoletoLine,
  listPayments,
  formatAsaasDate,
  calculateNextBillingDate,
  calculatePeriodEnd,
} from "./subscriptions";

// Types
export type {
  AsaasEnvironment,
  AsaasBillingType,
  AsaasCycle,
  AsaasSubscriptionStatus,
  AsaasPaymentStatus,
  AsaasCustomer,
  CreateCustomerInput,
  AsaasSubscription,
  CreateSubscriptionInput,
  CreditCardInput,
  CreditCardHolderInfo,
  CreateCreditCardSubscriptionInput,
  AsaasPayment,
  AsaasPaymentList,
  AsaasWebhookEventType,
  AsaasWebhookPayload,
  AsaasErrorDetail,
  AsaasErrorResponse,
  AsaasPixQrCode,
} from "./types";
