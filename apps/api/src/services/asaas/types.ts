// =============================================================================
// ASAAS API TYPES
// =============================================================================

/**
 * Asaas API environment
 */
export type AsaasEnvironment = "sandbox" | "production";

/**
 * Asaas billing types
 */
export type AsaasBillingType =
  | "BOLETO"
  | "CREDIT_CARD"
  | "PIX"
  | "UNDEFINED";

/**
 * Asaas billing cycles
 */
export type AsaasCycle =
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMIANNUALLY"
  | "YEARLY";

/**
 * Asaas subscription status
 */
export type AsaasSubscriptionStatus = "ACTIVE" | "INACTIVE" | "EXPIRED";

/**
 * Asaas payment status
 */
export type AsaasPaymentStatus =
  | "PENDING"
  | "AWAITING_RISK_ANALYSIS"
  | "CONFIRMED"
  | "RECEIVED"
  | "OVERDUE"
  | "REFUNDED"
  | "REFUND_REQUESTED"
  | "CHARGEBACK_REQUESTED"
  | "CHARGEBACK_DISPUTE"
  | "AWAITING_CHARGEBACK_REVERSAL"
  | "DUNNING_REQUESTED"
  | "DUNNING_RECEIVED"
  | "DELETED";

// =============================================================================
// CUSTOMER TYPES
// =============================================================================

export interface AsaasCustomer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  cpfCnpj: string;
  postalCode?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  city?: string;
  state?: string;
  country?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
  additionalEmails?: string;
  municipalInscription?: string;
  stateInscription?: string;
  observations?: string;
  groupName?: string;
  dateCreated: string;
}

export interface CreateCustomerInput {
  name: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  cpfCnpj: string;
  postalCode?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  city?: string;
  state?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
}

// =============================================================================
// SUBSCRIPTION TYPES
// =============================================================================

export interface AsaasSubscription {
  id: string;
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  nextDueDate: string;
  cycle: AsaasCycle;
  description?: string;
  status: AsaasSubscriptionStatus;
  dateCreated: string;
  creditCard?: {
    creditCardNumber: string;
    creditCardBrand: string;
    creditCardToken: string;
  };
}

export interface CreateSubscriptionInput {
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  nextDueDate: string;
  cycle: AsaasCycle;
  description?: string;
  externalReference?: string;
}

export interface CreditCardInput {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface CreditCardHolderInfo {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  addressComplement?: string;
  phone?: string;
  mobilePhone?: string;
}

export interface CreateCreditCardSubscriptionInput extends CreateSubscriptionInput {
  billingType: "CREDIT_CARD";
  creditCard?: CreditCardInput;
  creditCardHolderInfo?: CreditCardHolderInfo;
  creditCardToken?: string;
  remoteIp?: string;
}

// =============================================================================
// TOKENIZATION TYPES
// =============================================================================

export interface TokenizeCreditCardInput {
  customer: string;
  creditCard: CreditCardInput;
  creditCardHolderInfo: CreditCardHolderInfo;
  remoteIp?: string;
}

export interface TokenizeCreditCardResponse {
  creditCardNumber: string;
  creditCardBrand: string;
  creditCardToken: string;
}

// =============================================================================
// PAYMENT TYPES
// =============================================================================

export interface AsaasPayment {
  id: string;
  customer: string;
  subscription?: string;
  billingType: AsaasBillingType;
  value: number;
  netValue?: number;
  dueDate: string;
  status: AsaasPaymentStatus;
  description?: string;
  externalReference?: string;
  confirmedDate?: string;
  paymentDate?: string;
  clientPaymentDate?: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  invoiceNumber?: string;
  creditCard?: {
    creditCardNumber: string;
    creditCardBrand: string;
    creditCardToken: string;
  };
  // PIX fields
  pixTransaction?: {
    qrCode?: string;
    qrCodePayload?: string;
    expirationDate?: string;
  };
}

export interface AsaasPaymentList {
  object: "list";
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: AsaasPayment[];
}

// =============================================================================
// WEBHOOK TYPES
// =============================================================================

export type AsaasWebhookEventType =
  // Payment events
  | "PAYMENT_CREATED"
  | "PAYMENT_AWAITING_RISK_ANALYSIS"
  | "PAYMENT_APPROVED_BY_RISK_ANALYSIS"
  | "PAYMENT_REPROVED_BY_RISK_ANALYSIS"
  | "PAYMENT_AUTHORIZED"
  | "PAYMENT_UPDATED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED"
  | "PAYMENT_ANTICIPATED"
  | "PAYMENT_OVERDUE"
  | "PAYMENT_DELETED"
  | "PAYMENT_RESTORED"
  | "PAYMENT_REFUNDED"
  | "PAYMENT_PARTIALLY_REFUNDED"
  | "PAYMENT_REFUND_IN_PROGRESS"
  | "PAYMENT_RECEIVED_IN_CASH_UNDONE"
  | "PAYMENT_CHARGEBACK_REQUESTED"
  | "PAYMENT_CHARGEBACK_DISPUTE"
  | "PAYMENT_AWAITING_CHARGEBACK_REVERSAL"
  | "PAYMENT_DUNNING_RECEIVED"
  | "PAYMENT_DUNNING_REQUESTED"
  | "PAYMENT_BANK_SLIP_VIEWED"
  | "PAYMENT_CHECKOUT_VIEWED"
  // Subscription events
  | "SUBSCRIPTION_CREATED"
  | "SUBSCRIPTION_UPDATED"
  | "SUBSCRIPTION_INACTIVATED"
  | "SUBSCRIPTION_DELETED"
  | "SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK"
  | "SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED";

export interface AsaasWebhookPayload {
  id?: string;
  event: AsaasWebhookEventType;
  dateCreated?: string;
  payment?: AsaasPayment;
  subscription?: AsaasSubscription;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export interface AsaasErrorDetail {
  code: string;
  description: string;
}

export interface AsaasErrorResponse {
  errors?: AsaasErrorDetail[];
}

// =============================================================================
// PIX TYPES
// =============================================================================

export interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}
