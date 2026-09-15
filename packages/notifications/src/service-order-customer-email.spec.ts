/**
 * Tests for REQ-SOEMAIL-001 through REQ-SOEMAIL-006
 * Mini-spec A: Foundation — customer-facing dispatch + shared template
 *
 * These tests run WITHOUT a real database or Resend account.
 * All DB calls and Resend are mocked via vi.mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmailBrand } from "../../email/emails/service-order-email-layout";

// ---------------------------------------------------------------------------
// Hoist mocks before any imports that touch the module graph
// ---------------------------------------------------------------------------

// Mock DB + schema — must be hoisted so the import inside the module under
// test resolves the mock, not the real drizzle client.
vi.mock("@calibra-facil/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@calibra-facil/db/schema", () => ({
  organization: { id: "id", name: "name" },
  customer: { id: "id", email: "email", name: "name" },
}));

// Mock Resend — vi.hoisted so the variable is available inside the vi.mock factory
// (vi.mock calls are hoisted to the top of the file by Vitest's transformer).
const { resendSendMock } = vi.hoisted(() => ({
  resendSendMock: vi.fn().mockResolvedValue({ data: { id: "email_id_1" } }),
}));

vi.mock("resend", () => {
  // Use a regular function (not arrow) so `new Resend(...)` works in Vitest.
  function MockResend(_apiKey: string) {
    return { emails: { send: resendSendMock } };
  }
  return {
    Resend: vi.fn(MockResend),
  };
});

// Mock @react-email/render
vi.mock("@react-email/render", () => ({
  render: vi.fn().mockResolvedValue("<html>rendered email</html>"),
}));

// ---------------------------------------------------------------------------
// Now import the module under test
// ---------------------------------------------------------------------------
import {
  resolveServiceOrderRecipient,
  sendServiceOrderCustomerEmail,
  type ServiceOrderEmailInput,
  type ServiceOrderCustomerEmailResult,
} from "./service-order-customer-email";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSO(
  overrides: Partial<ServiceOrderEmailInput["serviceOrder"]> = {},
): ServiceOrderEmailInput["serviceOrder"] {
  return {
    id: 1,
    publicId: "pub-abc-123",
    organizationId: "org-1",
    customerId: 1,
    serviceOrderNumber: "OS-2024-001",
    clientContactSnapshot: null,
    ...overrides,
  };
}

function makeCustomer(
  overrides: Partial<ServiceOrderEmailInput["customer"]> = {},
): ServiceOrderEmailInput["customer"] {
  return {
    id: 1,
    email: "cliente@example.com",
    name: "Cliente Teste",
    ...overrides,
  };
}

function makeBrand() {
  return {
    name: "Lab Acme",
    logoSrc: "https://lab.com/logo.png",
    footerLegalLines: ["CNPJ 00.000.000/0001-00"],
    supportEmail: "lab@acme.com",
    website: "https://acme.com",
    isWhiteLabel: true as const,
  };
}

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-001: resolve recipient from clientContactSnapshot.email then
// fallback to customer.email
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-001: recipient resolution", () => {
  it("resolves from clientContactSnapshot.email when present and valid", () => {
    const so = makeSO({
      clientContactSnapshot: { email: "snapshot@example.com", name: "Contato" },
    });
    const result = resolveServiceOrderRecipient(so, makeCustomer());
    expect(result).toBe("snapshot@example.com");
  });

  it("falls back to customer.email when clientContactSnapshot.email is absent", () => {
    const so = makeSO({ clientContactSnapshot: null });
    const result = resolveServiceOrderRecipient(so, makeCustomer());
    expect(result).toBe("cliente@example.com");
  });

  it("falls back to customer.email when clientContactSnapshot has no email key", () => {
    const so = makeSO({
      clientContactSnapshot: { name: "Contato", phone: "11999" },
    });
    const result = resolveServiceOrderRecipient(so, makeCustomer());
    expect(result).toBe("cliente@example.com");
  });

  it("falls back to customer.email when snapshot email is not a string", () => {
    const so = makeSO({ clientContactSnapshot: { email: 12345 } });
    const result = resolveServiceOrderRecipient(so, makeCustomer());
    expect(result).toBe("cliente@example.com");
  });

  it("falls back to customer.email when snapshot email is an empty string", () => {
    const so = makeSO({ clientContactSnapshot: { email: "" } });
    const result = resolveServiceOrderRecipient(so, makeCustomer());
    expect(result).toBe("cliente@example.com");
  });

  it("falls back to customer.email when snapshot email has no @ (invalid)", () => {
    const so = makeSO({ clientContactSnapshot: { email: "not-an-email" } });
    const result = resolveServiceOrderRecipient(so, makeCustomer());
    expect(result).toBe("cliente@example.com");
  });

  it("returns undefined when both snapshot and customer email are absent", () => {
    const so = makeSO({ clientContactSnapshot: null });
    const c = makeCustomer({ email: null });
    const result = resolveServiceOrderRecipient(so, c);
    expect(result).toBeUndefined();
  });

  it("returns undefined when customer.email is empty", () => {
    const so = makeSO({ clientContactSnapshot: null });
    const c = makeCustomer({ email: "" });
    const result = resolveServiceOrderRecipient(so, c);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-002: no valid recipient → no-op, no throw
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-002: no valid recipient → skip, no throw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resendSendMock.mockResolvedValue({ data: { id: "email_id_1" } });
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "noreply@calibrafacil.com";
  });

  it("returns skipped result without throwing when no email can be resolved", async () => {
    const input: ServiceOrderEmailInput = {
      serviceOrder: makeSO({ clientContactSnapshot: null }),
      customer: makeCustomer({ email: null }),
      brand: makeBrand(),
      subject: "Ordem de Serviço OS-2024-001",
      renderEmail: vi.fn().mockReturnValue(null),
    };

    let result: ServiceOrderCustomerEmailResult | undefined;
    await expect(
      (async () => {
        result = await sendServiceOrderCustomerEmail(input);
      })(),
    ).resolves.not.toThrow();

    expect(result?.sent).toBe(false);
    expect(result?.skipped).toBe(true);
    // Type-narrow to the skipped variant before checking skipReason
    if (result && !result.sent && result.skipped) {
      expect(result.skipReason).toMatch(/no.*recipient|address/i);
    } else {
      throw new Error("Expected a skipped result with skipReason");
    }
  });

  it("does not call Resend send when no recipient is available", async () => {
    vi.clearAllMocks();
    resendSendMock.mockResolvedValue({ data: { id: "email_id_1" } });

    const input: ServiceOrderEmailInput = {
      serviceOrder: makeSO({ clientContactSnapshot: null }),
      customer: makeCustomer({ email: null }),
      brand: makeBrand(),
      subject: "Test Subject",
      renderEmail: vi.fn().mockReturnValue(null),
    };

    await sendServiceOrderCustomerEmail(input);

    expect(resendSendMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-003: apply lab white-label brand
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-003: apply lab white-label brand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "noreply@calibrafacil.com";
  });

  it("passes the brand to renderEmail callback", async () => {
    const brand = makeBrand();
    const renderEmail = vi.fn().mockReturnValue(null);

    const input: ServiceOrderEmailInput = {
      serviceOrder: makeSO(),
      customer: makeCustomer(),
      brand,
      subject: "Test",
      renderEmail,
    };

    await sendServiceOrderCustomerEmail(input);

    expect(renderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ brand }),
    );
  });

  it("passes the service order and customer to renderEmail callback", async () => {
    const brand = makeBrand();
    const renderEmail = vi.fn().mockReturnValue(null);
    const so = makeSO();
    const cust = makeCustomer();

    const input: ServiceOrderEmailInput = {
      serviceOrder: so,
      customer: cust,
      brand,
      subject: "Test",
      renderEmail,
    };

    await sendServiceOrderCustomerEmail(input);

    expect(renderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceOrder: so,
        customer: cust,
        brand,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-004: tenant isolation — only own org data [HIGH RISK]
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-004: tenant isolation [HIGH RISK]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "noreply@calibrafacil.com";
  });

  it("passes only fields of the service order's own org/customer to renderEmail", async () => {
    const brand = makeBrand();
    const renderEmail = vi.fn().mockReturnValue(null);

    const so = makeSO({ organizationId: "org-MINE", customerId: 42 });
    const customerData = makeCustomer({ id: 42, name: "My Customer Only" });

    const input: ServiceOrderEmailInput = {
      serviceOrder: so,
      customer: customerData,
      brand,
      subject: "Test",
      renderEmail,
    };

    await sendServiceOrderCustomerEmail(input);

    // Verify renderEmail was called with the correct scoped data
    expect(renderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceOrder: expect.objectContaining({ organizationId: "org-MINE" }),
        customer: expect.objectContaining({ id: 42, name: "My Customer Only" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-005: Resend transport throw → failure result, no propagation
// [HIGH RISK]
// ---------------------------------------------------------------------------

// A stub string — strings are valid React.ReactNode and require no type assertions.
// @react-email/render is mocked to return a string regardless, so the actual
// value does not matter as long as it is non-null/non-undefined (truthy).
const STUB_ELEMENT = "stub-email-content";

describe("REQ-SOEMAIL-005: Resend throw → failure result, no propagation [HIGH RISK]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resendSendMock.mockResolvedValue({ data: { id: "email_id_1" } });
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "noreply@calibrafacil.com";
  });

  it("returns failure result when Resend throws, does not propagate", async () => {
    resendSendMock.mockRejectedValueOnce(new Error("Resend network failure"));

    const input: ServiceOrderEmailInput = {
      serviceOrder: makeSO(),
      customer: makeCustomer(),
      brand: makeBrand(),
      subject: "Test",
      renderEmail: vi.fn().mockReturnValue(STUB_ELEMENT),
    };

    let result: ServiceOrderCustomerEmailResult | undefined;
    await expect(
      (async () => {
        result = await sendServiceOrderCustomerEmail(input);
      })(),
    ).resolves.not.toThrow();

    expect(result?.sent).toBe(false);
    expect(result?.error).toBeDefined();
  });

  it("failure result captures the transport error message", async () => {
    resendSendMock.mockRejectedValueOnce(new Error("API rate limit exceeded"));

    const input: ServiceOrderEmailInput = {
      serviceOrder: makeSO(),
      customer: makeCustomer(),
      brand: makeBrand(),
      subject: "Test",
      renderEmail: vi.fn().mockReturnValue(STUB_ELEMENT),
    };

    const result = await sendServiceOrderCustomerEmail(input);
    expect(result.error).toMatch(/rate limit/i);
  });

  it("skipped=false on transport error (different from no-recipient skip)", async () => {
    resendSendMock.mockRejectedValueOnce(new Error("timeout"));

    const input: ServiceOrderEmailInput = {
      serviceOrder: makeSO(),
      customer: makeCustomer(),
      brand: makeBrand(),
      subject: "Test",
      renderEmail: vi.fn().mockReturnValue(STUB_ELEMENT),
    };

    const result = await sendServiceOrderCustomerEmail(input);
    // A transport error returns { sent: false, error: "..." } — NOT a skip
    expect(result.skipped).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-006: shared service-order email layout renders white-label header
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-006: shared service-order email layout", () => {
  // Render to REAL HTML — vi.importActual bypasses the module-level
  // @react-email/render mock so these assertions observe actual output, not a
  // constant. (Tautology guard: a layout that dropped the brand would now fail.)
  async function renderToHtml(brand: EmailBrand | undefined): Promise<string> {
    const { ServiceOrderEmailLayout } =
      await import("../../email/emails/service-order-email-layout");
    const { render } = await vi.importActual<
      typeof import("@react-email/render")
    >("@react-email/render");
    return render(
      ServiceOrderEmailLayout({
        previewText: "OS-2024-999",
        brand,
        children: null,
      }),
    );
  }

  const labBrand: EmailBrand = {
    name: "Acme Metrologia",
    logoSrc: "https://acme.com/logo.svg",
    footerLegalLines: ["CNPJ 99.888.777/0001-11", "R. das Flores, 42 - Centro"],
    supportEmail: "contato@acme.com",
    website: "https://acme.com",
    isWhiteLabel: true,
  };

  // Platform pitch line rendered by EmailLayout when NOT white-label.
  const PLATFORM_MARKETING = "documentos e atendimento";

  it("renders the lab company header (name, CNPJ, address, website, logo) from the brand", async () => {
    const html = await renderToHtml(labBrand);
    expect(html).toContain("Acme Metrologia");
    expect(html).toContain("99.888.777/0001-11");
    expect(html).toContain("R. das Flores, 42 - Centro");
    expect(html).toContain("acme.com");
    expect(html).toContain("https://acme.com/logo.svg");
  });

  it("suppresses the CalibraFácil platform marketing branding when isWhiteLabel is set", async () => {
    const html = await renderToHtml(labBrand);
    // The platform pitch line must NOT appear on a white-label email.
    expect(html).not.toContain(PLATFORM_MARKETING);
    // White-label footer attributes the message to the lab (a minimal
    // "via CalibraFácil" attribution remains by design across all platform
    // emails — see spec REQ-SOEMAIL-006).
    expect(html).toContain("Esta mensagem foi enviada por Acme Metrologia");
  });

  it("falls back to CalibraFácil platform branding when no brand is provided", async () => {
    const html = await renderToHtml(undefined);
    expect(html).toContain(PLATFORM_MARKETING);
  });
});
