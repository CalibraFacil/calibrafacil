import { vi } from "vitest";
import type {
  AsaasSubscription,
  AsaasPayment,
  AsaasPaymentList,
  AsaasPixQrCode,
  AsaasCustomer,
  TokenizeCreditCardResponse,
} from "../../src/services/asaas/types";

// =============================================================================
// FETCH MOCK HELPERS
// =============================================================================

/**
 * Create a mock fetch response
 */
export function mockFetchResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  } as Response;
}

/**
 * Create a mock fetch that returns the given response
 */
export function mockFetch(response: Response): typeof fetch {
  return vi.fn().mockResolvedValue(response);
}

/**
 * Create a mock fetch that fails with network error
 */
export function mockFetchNetworkError(message = "Network error"): typeof fetch {
  return vi.fn().mockRejectedValue(new TypeError(message));
}

/**
 * Create a mock fetch that succeeds after N failures
 */
export function mockFetchWithRetries(
  failCount: number,
  failStatus: number,
  successData: unknown,
): typeof fetch {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount <= failCount) {
      return Promise.resolve(mockFetchResponse({ error: "Temporary error" }, failStatus));
    }
    return Promise.resolve(mockFetchResponse(successData));
  });
}

// =============================================================================
// ASAAS RESPONSE FACTORIES
// =============================================================================

export function createMockCustomer(overrides: Partial<AsaasCustomer> = {}): AsaasCustomer {
  return {
    id: "cus_000005113026",
    name: "Test Organization",
    email: "test@example.com",
    cpfCnpj: "12345678000190",
    dateCreated: "2024-01-15",
    ...overrides,
  };
}

export function createMockSubscription(
  overrides: Partial<AsaasSubscription> = {},
): AsaasSubscription {
  return {
    id: "sub_abc123def456",
    customer: "cus_000005113026",
    billingType: "CREDIT_CARD",
    value: 99.9,
    nextDueDate: "2024-02-15",
    cycle: "MONTHLY",
    status: "ACTIVE",
    dateCreated: "2024-01-15",
    ...overrides,
  };
}

export function createMockPayment(overrides: Partial<AsaasPayment> = {}): AsaasPayment {
  return {
    id: "pay_abc123def456",
    customer: "cus_000005113026",
    subscription: "sub_abc123def456",
    billingType: "CREDIT_CARD",
    value: 99.9,
    dueDate: "2024-02-15",
    status: "PENDING",
    ...overrides,
  };
}

export function createMockPaymentList(
  payments: AsaasPayment[] = [],
  overrides: Partial<AsaasPaymentList> = {},
): AsaasPaymentList {
  return {
    object: "list",
    hasMore: false,
    totalCount: payments.length,
    limit: 10,
    offset: 0,
    data: payments,
    ...overrides,
  };
}

export function createMockPixQrCode(overrides: Partial<AsaasPixQrCode> = {}): AsaasPixQrCode {
  return {
    encodedImage: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    payload: "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426614174000",
    expirationDate: "2024-02-15T23:59:59Z",
    ...overrides,
  };
}

export function createMockBoletoLine() {
  return {
    identificationField: "23793.38128 60000.000003 00000.000400 1 84340000010000",
    nossoNumero: "1234567",
    barCode: "23791843400000100003381286000000000000000040",
  };
}

export function createMockTokenizeResponse(
  overrides: Partial<TokenizeCreditCardResponse> = {},
): TokenizeCreditCardResponse {
  return {
    creditCardToken: "tok_abc123def456ghi789",
    creditCardNumber: "************4444",
    creditCardBrand: "VISA",
    ...overrides,
  };
}

// =============================================================================
// DATABASE MOCK FACTORIES
// =============================================================================

export function createMockOrganization(overrides: Record<string, unknown> = {}) {
  return {
    id: "org_test123",
    name: "Test Organization",
    cnpj: "12345678000190",
    email: "org@example.com",
    phone: "11999999999",
    asaasCustomerId: null,
    ...overrides,
  };
}

export function createMockMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "member_test123",
    userId: "user_test123",
    organizationId: "org_test123",
    role: "ADMIN",
    ...overrides,
  };
}

export function createMockDbSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizationId: "org_test123",
    planId: "STANDARD",
    billingCycle: "MONTHLY",
    status: "TRIAL",
    asaasSubscriptionId: null,
    asaasCustomerId: null,
    currentPeriodStart: new Date("2024-01-15"),
    currentPeriodEnd: new Date("2024-02-14"),
    nextBillingDate: new Date("2024-02-14"),
    createdAt: new Date("2024-01-15"),
    updatedAt: new Date("2024-01-15"),
    ...overrides,
  };
}

export function createMockPaymentHistory(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    subscriptionId: 1,
    organizationId: "org_test123",
    asaasPaymentId: "pay_abc123def456",
    amount: 9990, // centavos
    netAmount: null,
    currency: "BRL",
    paymentMethod: "CREDIT_CARD",
    status: "PENDING",
    source: "CHECKOUT",
    dueDate: new Date("2024-02-15"),
    paidAt: null,
    createdAt: new Date("2024-01-15"),
    updatedAt: new Date("2024-01-15"),
    ...overrides,
  };
}

// =============================================================================
// WEBHOOK PAYLOAD FACTORIES
// =============================================================================

export function createMockWebhookPayload(
  event: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `evt_${Date.now()}`,
    event,
    dateCreated: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockPaymentWebhookPayload(
  event: string,
  paymentOverrides: Partial<AsaasPayment> = {},
) {
  return createMockWebhookPayload(event, {
    payment: createMockPayment(paymentOverrides),
  });
}

export function createMockSubscriptionWebhookPayload(
  event: string,
  subscriptionOverrides: Partial<AsaasSubscription> = {},
) {
  return createMockWebhookPayload(event, {
    subscription: createMockSubscription(subscriptionOverrides),
  });
}

// =============================================================================
// TEST CREDIT CARD DATA (from Asaas Sandbox)
// =============================================================================

export const TEST_CARDS = {
  valid: {
    holderName: "JOAO M SILVA",
    number: "4444444444444444",
    expiryMonth: "12",
    expiryYear: "2030",
    ccv: "123",
  },
  declined: {
    holderName: "JOAO M SILVA",
    number: "5184019740373151", // Mastercard that gets declined
    expiryMonth: "12",
    expiryYear: "2030",
    ccv: "123",
  },
};

export const TEST_CARD_HOLDER = {
  name: "JOAO M SILVA",
  email: "joao@example.com",
  cpfCnpj: "12345678901",
  postalCode: "01310100",
  addressNumber: "123",
  phone: "11999999999",
};
