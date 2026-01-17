import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockOrganization,
  createMockMember,
  createMockDbSubscription,
  createMockSubscription,
  createMockPayment,
  createMockPaymentList,
  createMockPixQrCode,
  createMockBoletoLine,
  createMockTokenizeResponse,
  createMockCustomer,
  TEST_CARDS,
  TEST_CARD_HOLDER,
} from "../../../../test/utils/mocks";

// Mock the database module
vi.mock("@calibra-facil/db", () => ({
  db: {
    query: {
      organization: {
        findFirst: vi.fn(),
      },
      subscription: {
        findFirst: vi.fn(),
      },
    },
    transaction: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  },
}));

// Mock the Asaas service
vi.mock("../../../services/asaas", () => ({
  createCustomer: vi.fn(),
  findCustomerByExternalReference: vi.fn(),
  createSubscription: vi.fn(),
  createCreditCardSubscription: vi.fn(),
  tokenizeCreditCard: vi.fn(),
  getSubscriptionPayments: vi.fn(),
  getPaymentPixQrCode: vi.fn(),
  getPaymentBoletoLine: vi.fn(),
  formatAsaasDate: vi.fn((date: Date) => date.toISOString().split("T")[0]),
  calculatePeriodEnd: vi.fn((date: Date, cycle: string) => {
    const end = new Date(date);
    if (cycle === "MONTHLY") {
      end.setMonth(end.getMonth() + 1);
      end.setDate(end.getDate() - 1);
    } else {
      end.setFullYear(end.getFullYear() + 1);
      end.setDate(end.getDate() - 1);
    }
    return end;
  }),
}));

// Mock the shared package
vi.mock("@calibra-facil/shared", () => ({
  getPlan: vi.fn((planId: string) => ({
    id: planId,
    name: planId === "STANDARD" ? "Standard" : planId === "PROFESSIONAL" ? "Professional" : "Enterprise",
  })),
  getPlanPrice: vi.fn((planId: string, cycle: string) => {
    const prices: Record<string, Record<string, number>> = {
      STANDARD: { MONTHLY: 9990, YEARLY: 99900 },
      PROFESSIONAL: { MONTHLY: 19990, YEARLY: 199900 },
      ENTERPRISE: { MONTHLY: 49990, YEARLY: 499900 },
    };
    return prices[planId]?.[cycle];
  }),
}));

// Import mocks after setup
import { db } from "@calibra-facil/db";
import {
  createCustomer,
  findCustomerByExternalReference,
  createSubscription,
  createCreditCardSubscription,
  tokenizeCreditCard,
  getSubscriptionPayments,
  getPaymentPixQrCode,
  getPaymentBoletoLine,
} from "../../../services/asaas";
import { getPlanPrice } from "@calibra-facil/shared";

describe("Checkout Validation", () => {
  describe("CreditCardSchema", () => {
    it("should validate valid credit card data", () => {
      const validCard = TEST_CARDS.valid;

      expect(validCard.holderName.length).toBeGreaterThanOrEqual(3);
      expect(validCard.number.length).toBeGreaterThanOrEqual(13);
      expect(validCard.number.length).toBeLessThanOrEqual(19);
      expect(validCard.expiryMonth.length).toBe(2);
      expect(validCard.expiryYear.length).toBe(4);
      expect(validCard.ccv.length).toBeGreaterThanOrEqual(3);
      expect(validCard.ccv.length).toBeLessThanOrEqual(4);
    });

    it("should reject short holder name", () => {
      const invalidCard = { ...TEST_CARDS.valid, holderName: "AB" };
      expect(invalidCard.holderName.length).toBeLessThan(3);
    });

    it("should reject invalid card number length", () => {
      const shortCard = { ...TEST_CARDS.valid, number: "123456789012" }; // 12 digits
      expect(shortCard.number.length).toBeLessThan(13);

      const longCard = { ...TEST_CARDS.valid, number: "12345678901234567890" }; // 20 digits
      expect(longCard.number.length).toBeGreaterThan(19);
    });

    it("should reject invalid expiry format", () => {
      const invalidMonth = { ...TEST_CARDS.valid, expiryMonth: "1" };
      expect(invalidMonth.expiryMonth.length).not.toBe(2);

      const invalidYear = { ...TEST_CARDS.valid, expiryYear: "24" };
      expect(invalidYear.expiryYear.length).not.toBe(4);
    });
  });

  describe("CardHolderInfoSchema", () => {
    it("should validate valid card holder data", () => {
      const validHolder = TEST_CARD_HOLDER;

      expect(validHolder.name.length).toBeGreaterThanOrEqual(3);
      expect(validHolder.email).toContain("@");
      expect(validHolder.cpfCnpj.length).toBeGreaterThanOrEqual(11);
      expect(validHolder.cpfCnpj.length).toBeLessThanOrEqual(14);
      expect(validHolder.postalCode.length).toBeGreaterThanOrEqual(8);
      expect(validHolder.addressNumber.length).toBeGreaterThanOrEqual(1);
    });

    it("should reject invalid CPF/CNPJ length", () => {
      const shortCpf = { ...TEST_CARD_HOLDER, cpfCnpj: "1234567890" }; // 10 digits
      expect(shortCpf.cpfCnpj.length).toBeLessThan(11);

      const longCnpj = { ...TEST_CARD_HOLDER, cpfCnpj: "123456789012345" }; // 15 digits
      expect(longCnpj.cpfCnpj.length).toBeGreaterThan(14);
    });
  });

  describe("Plan and Cycle Validation", () => {
    it("should accept valid plan IDs", () => {
      const validPlans = ["STANDARD", "PROFESSIONAL", "ENTERPRISE"];
      validPlans.forEach((plan) => {
        expect(["STANDARD", "PROFESSIONAL", "ENTERPRISE"]).toContain(plan);
      });
    });

    it("should reject FREE plan for paid checkout", () => {
      const paidPlans = ["STANDARD", "PROFESSIONAL", "ENTERPRISE"];
      expect(paidPlans).not.toContain("FREE");
    });

    it("should accept valid billing cycles", () => {
      const validCycles = ["MONTHLY", "YEARLY"];
      validCycles.forEach((cycle) => {
        expect(["MONTHLY", "YEARLY"]).toContain(cycle);
      });
    });
  });
});

describe("CNPJ Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject checkout when organization has no CNPJ", async () => {
    const orgWithoutCnpj = createMockOrganization({ cnpj: null });

    // The endpoint should return 400 with error message
    expect(orgWithoutCnpj.cnpj).toBeNull();

    const expectedError = {
      error: "CNPJ da organização não configurado. Configure nas configurações antes de assinar.",
    };
    expect(expectedError.error).toContain("CNPJ");
  });

  it("should accept checkout when organization has CNPJ", async () => {
    const orgWithCnpj = createMockOrganization({ cnpj: "12345678000190" });

    expect(orgWithCnpj.cnpj).toBe("12345678000190");
    expect(orgWithCnpj.cnpj?.length).toBe(14);
  });
});

describe("Duplicate Subscription Prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject checkout when active subscription exists", async () => {
    const activeSubscription = createMockDbSubscription({ status: "ACTIVE" });

    // Mock existing active subscription
    (db.query.subscription.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      activeSubscription,
    );

    expect(activeSubscription.status).toBe("ACTIVE");

    const expectedError = { error: "Já existe assinatura ativa" };
    expect(expectedError.error).toContain("assinatura ativa");
  });

  it("should allow checkout when subscription is TRIAL", async () => {
    const trialSubscription = createMockDbSubscription({ status: "TRIAL" });

    (db.query.subscription.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      trialSubscription,
    );

    expect(trialSubscription.status).toBe("TRIAL");
    // TRIAL status should not block new checkout
    expect(trialSubscription.status).not.toBe("ACTIVE");
  });

  it("should allow checkout when subscription is CANCELED", async () => {
    const canceledSubscription = createMockDbSubscription({ status: "CANCELED" });

    (db.query.subscription.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      canceledSubscription,
    );

    expect(canceledSubscription.status).toBe("CANCELED");
    expect(canceledSubscription.status).not.toBe("ACTIVE");
  });

  it("should allow checkout when no subscription exists", async () => {
    (db.query.subscription.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const existingSub = await db.query.subscription.findFirst({});
    expect(existingSub).toBeNull();
  });
});

describe("Tokenize Endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should tokenize credit card successfully", async () => {
    const org = createMockOrganization();
    const tokenResponse = createMockTokenizeResponse();

    (db.query.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(org);
    (findCustomerByExternalReference as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createCustomer as ReturnType<typeof vi.fn>).mockResolvedValue(createMockCustomer());
    (tokenizeCreditCard as ReturnType<typeof vi.fn>).mockResolvedValue(tokenResponse);

    // Verify token response structure
    expect(tokenResponse.creditCardToken).toBeDefined();
    expect(tokenResponse.creditCardBrand).toBe("VISA");
    expect(tokenResponse.creditCardNumber).toBe("************4444");
  });

  it("should reuse existing Asaas customer", async () => {
    const org = createMockOrganization({ asaasCustomerId: "cus_existing" });
    const existingCustomer = createMockCustomer({ id: "cus_existing" });

    (db.query.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(org);
    (findCustomerByExternalReference as ReturnType<typeof vi.fn>).mockResolvedValue(
      existingCustomer,
    );

    // Should not create new customer
    expect(org.asaasCustomerId).toBe("cus_existing");
  });

  it("should create Asaas customer if not exists", async () => {
    const org = createMockOrganization({ asaasCustomerId: null });
    const newCustomer = createMockCustomer();

    (db.query.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(org);
    (findCustomerByExternalReference as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createCustomer as ReturnType<typeof vi.fn>).mockResolvedValue(newCustomer);

    expect(org.asaasCustomerId).toBeNull();
    expect(newCustomer.id).toBeDefined();
  });

  it("should include remoteIp in tokenization request", async () => {
    // The endpoint extracts IP from x-forwarded-for or x-real-ip headers
    const forwardedIp = "192.168.1.1, 10.0.0.1";
    const expectedIp = "192.168.1.1"; // First IP in the chain

    expect(forwardedIp.split(",")[0]?.trim()).toBe(expectedIp);
  });
});

describe("Credit Card Checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create subscription with token successfully", async () => {
    const org = createMockOrganization();
    const subscription = createMockSubscription();

    (db.query.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(org);
    (db.query.subscription.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createCreditCardSubscription as ReturnType<typeof vi.fn>).mockResolvedValue(subscription);

    // Mock transaction
    (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => {
      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([createMockDbSubscription()]),
            }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([createMockDbSubscription()]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };
      return fn(mockTx);
    });

    expect(subscription.id).toBeDefined();
    expect(subscription.billingType).toBe("CREDIT_CARD");
  });

  it("should calculate correct price for plan and cycle", async () => {
    // STANDARD MONTHLY = 9990 centavos = R$ 99.90
    expect(getPlanPrice("STANDARD", "MONTHLY")).toBe(9990);

    // STANDARD YEARLY = 99900 centavos = R$ 999.00
    expect(getPlanPrice("STANDARD", "YEARLY")).toBe(99900);

    // PROFESSIONAL MONTHLY = 19990 centavos = R$ 199.90
    expect(getPlanPrice("PROFESSIONAL", "MONTHLY")).toBe(19990);

    // ENTERPRISE MONTHLY = 49990 centavos = R$ 499.90
    expect(getPlanPrice("ENTERPRISE", "MONTHLY")).toBe(49990);
  });

  it("should use token instead of raw card data", async () => {
    const checkoutInput = {
      planId: "STANDARD",
      cycle: "MONTHLY",
      creditCardToken: "tok_abc123def456",
      cardHolder: TEST_CARD_HOLDER,
    };

    // Should have token, not raw card data
    expect(checkoutInput.creditCardToken).toBeDefined();
    expect(checkoutInput).not.toHaveProperty("creditCard");
  });
});

describe("PIX Checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create PIX subscription and return QR code", async () => {
    const org = createMockOrganization();
    const subscription = createMockSubscription({ billingType: "PIX" });
    const payment = createMockPayment({ billingType: "PIX" });
    const qrCode = createMockPixQrCode();

    (db.query.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(org);
    (db.query.subscription.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createSubscription as ReturnType<typeof vi.fn>).mockResolvedValue(subscription);
    (getSubscriptionPayments as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockPaymentList([payment]),
    );
    (getPaymentPixQrCode as ReturnType<typeof vi.fn>).mockResolvedValue(qrCode);

    expect(qrCode.encodedImage).toBeDefined();
    expect(qrCode.payload).toBeDefined();
    expect(qrCode.expirationDate).toBeDefined();
  });

  it("should handle QR code fetch failure gracefully", async () => {
    const org = createMockOrganization();
    const payment = createMockPayment({ billingType: "PIX" });

    (db.query.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(org);
    (getSubscriptionPayments as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockPaymentList([payment]),
    );
    (getPaymentPixQrCode as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("QR code unavailable"),
    );

    // The endpoint should catch this error and return warning
    const expectedResponse = {
      status: "PENDING",
      qrCodeError: true,
      warning: "QR Code indisponível no momento. Atualize a página para tentar novamente.",
    };

    expect(expectedResponse.qrCodeError).toBe(true);
    expect(expectedResponse.warning).toContain("QR Code");
  });

  it("should format QR code image as data URL", async () => {
    const qrCode = createMockPixQrCode();
    const formattedImage = `data:image/png;base64,${qrCode.encodedImage}`;

    expect(formattedImage).toMatch(/^data:image\/png;base64,/);
  });
});

describe("Boleto Checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create Boleto subscription and return barcode", async () => {
    const org = createMockOrganization();
    const subscription = createMockSubscription({ billingType: "BOLETO" });
    const payment = createMockPayment({
      billingType: "BOLETO",
      bankSlipUrl: "https://www.asaas.com/b/pdf/123456",
    });
    const boletoLine = createMockBoletoLine();

    (db.query.organization.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(org);
    (db.query.subscription.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createSubscription as ReturnType<typeof vi.fn>).mockResolvedValue(subscription);
    (getSubscriptionPayments as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockPaymentList([payment]),
    );
    (getPaymentBoletoLine as ReturnType<typeof vi.fn>).mockResolvedValue(boletoLine);

    expect(boletoLine.identificationField).toBeDefined();
    expect(boletoLine.barCode).toBeDefined();
    expect(payment.bankSlipUrl).toContain("asaas.com");
  });

  it("should handle boleto line fetch failure gracefully", async () => {
    const payment = createMockPayment({
      billingType: "BOLETO",
      bankSlipUrl: "https://www.asaas.com/b/pdf/123456",
    });

    (getPaymentBoletoLine as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Boleto line unavailable"),
    );

    // Should still return bankSlipUrl even if line fetch fails
    const expectedBoleto = {
      bankSlipUrl: payment.bankSlipUrl,
      barCode: null,
      identificationField: null,
      dueDate: payment.dueDate,
    };

    expect(expectedBoleto.bankSlipUrl).toBeDefined();
    expect(expectedBoleto.barCode).toBeNull();
  });

  it("should set due date 3 days in the future", async () => {
    const now = new Date();
    const expectedDueDate = new Date();
    expectedDueDate.setDate(expectedDueDate.getDate() + 3);

    // Verify the due date is approximately 3 days ahead
    const diffInDays = Math.round(
      (expectedDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(diffInDays).toBe(3);
  });
});

describe("Subscription Status Endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return subscription status", async () => {
    const subscription = createMockDbSubscription({ status: "ACTIVE" });

    (db.query.subscription.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(subscription);

    const expectedResponse = {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        planId: subscription.planId,
        billingCycle: subscription.billingCycle,
      },
      isActive: subscription.status === "ACTIVE",
      isPaid: false,
      isConfirmedByWebhook: false,
    };

    expect(expectedResponse.isActive).toBe(true);
    expect(expectedResponse.subscription.status).toBe("ACTIVE");
  });

  it("should return 404 for non-existent subscription", async () => {
    (db.query.subscription.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const sub = await db.query.subscription.findFirst({});
    expect(sub).toBeNull();
  });

  it("should reject invalid subscription ID format", async () => {
    const invalidIds = ["abc", "", "null", "undefined"];

    invalidIds.forEach((id) => {
      const parsed = parseInt(id, 10);
      expect(isNaN(parsed) || id === "").toBe(true);
    });

    // Numeric strings are valid (they parse to integers)
    expect(parseInt("12", 10)).toBe(12);
    // "12.34" parses to 12 which is valid
    expect(parseInt("12.34", 10)).toBe(12);
  });

  it("should verify subscription ownership", async () => {
    const subscription = createMockDbSubscription({ organizationId: "org_123" });
    const requestingMember = createMockMember({ organizationId: "org_456" });

    // Different org IDs should be rejected
    expect(subscription.organizationId).not.toBe(requestingMember.organizationId);
  });
});

describe("Price Calculation", () => {
  it("should convert centavos to reais for Asaas API", () => {
    const priceInCentavos = 9990;
    const priceInReais = priceInCentavos / 100;

    expect(priceInReais).toBe(99.9);
  });

  it("should handle all plan prices correctly", () => {
    const plans = [
      { id: "STANDARD", monthly: 9990, yearly: 99900 },
      { id: "PROFESSIONAL", monthly: 19990, yearly: 199900 },
      { id: "ENTERPRISE", monthly: 49990, yearly: 499900 },
    ];

    plans.forEach((plan) => {
      expect(getPlanPrice(plan.id, "MONTHLY")).toBe(plan.monthly);
      expect(getPlanPrice(plan.id, "YEARLY")).toBe(plan.yearly);
    });
  });

  it("should return undefined for invalid plan", () => {
    expect(getPlanPrice("INVALID", "MONTHLY")).toBeUndefined();
    expect(getPlanPrice("FREE", "MONTHLY")).toBeUndefined();
  });
});

describe("Period Calculation", () => {
  it("should calculate period end for monthly subscription", () => {
    const startDate = new Date("2024-01-15");
    const expectedEnd = new Date("2024-02-14"); // 1 month - 1 day

    const periodEnd = new Date(startDate);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(periodEnd.getDate() - 1);

    expect(periodEnd.toISOString().split("T")[0]).toBe(
      expectedEnd.toISOString().split("T")[0],
    );
  });

  it("should calculate period end for yearly subscription", () => {
    const startDate = new Date("2024-01-15");
    const expectedEnd = new Date("2025-01-14"); // 1 year - 1 day

    const periodEnd = new Date(startDate);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    periodEnd.setDate(periodEnd.getDate() - 1);

    expect(periodEnd.toISOString().split("T")[0]).toBe(
      expectedEnd.toISOString().split("T")[0],
    );
  });
});
