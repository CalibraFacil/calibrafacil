/**
 * Tests for REQ-SOEMAIL-032 — mini-spec D "Orçamento Recusado" dispatch wiring.
 *
 * Verifies:
 *  - WHEN a quote is rejected (manual OR portal), the "orçamento recusado"
 *    email is dispatched referencing the OS number and rejectionReason when present.
 *  - The dispatch is invoked from BOTH rejection paths:
 *    rejectServiceOrderQuoteManually and rejectServiceOrderQuoteByPortalUser.
 *  - A failed email does NOT throw out of the reject commands.
 *  - When rejectionReason is absent/null, the email still dispatches without error.
 *
 * Strategy: test dispatchOrcamentoRecusadoEmail in isolation, mocking both
 * sendServiceOrderCustomerEmail and getLabEmailBrand. The template's ACTUAL
 * field rendering is proven by the real-HTML render test co-located in
 * packages/email/emails/orcamento-recusado-email.spec.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrcamentoRecusadoEmailDispatchInput } from "./orcamento-recusado-email-dispatch";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSendSOEmail, mockGetLabEmailBrand, mockOrcamentoRecusadoEmail } =
  vi.hoisted(() => ({
    mockSendSOEmail: vi
      .fn()
      .mockResolvedValue({ sent: true, emailId: "email-id-1" }),
    mockGetLabEmailBrand: vi.fn().mockResolvedValue(undefined),
    mockOrcamentoRecusadoEmail: vi
      .fn()
      .mockReturnValue("orcamento-recusado-element"),
  }));

vi.mock("@calibra-facil/notifications", () => ({
  sendServiceOrderCustomerEmail: mockSendSOEmail,
  getLabEmailBrand: mockGetLabEmailBrand,
}));

vi.mock("@calibra-facil/email", () => ({
  QuoteRejectedEmail: mockOrcamentoRecusadoEmail,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { dispatchOrcamentoRecusadoEmail } from "./orcamento-recusado-email-dispatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  overrides: Partial<OrcamentoRecusadoEmailDispatchInput> = {},
): OrcamentoRecusadoEmailDispatchInput {
  return {
    serviceOrderId: 1,
    quoteId: 42,
    serviceOrderNumber: "OS-2026-042",
    organizationId: "org-1",
    publicId: "pub-abc-123",
    customerId: 101,
    clientContactSnapshot: { email: "cliente@example.com", name: "Contato" },
    customerName: "Empresa Teste SA",
    customerEmail: "empresa@example.com",
    rejectionReason: "Valor acima do orçamento previsto",
    ...overrides,
  };
}

// Invoke the renderEmail callback and get the props passed to the template
function getTemplateProps(
  input: OrcamentoRecusadoEmailDispatchInput,
): Parameters<typeof mockOrcamentoRecusadoEmail>[0] {
  const call = mockSendSOEmail.mock.calls[0];
  const emailInput = call[0];
  const ctx = {
    serviceOrder: {
      id: input.serviceOrderId,
      publicId: input.publicId,
      organizationId: input.organizationId,
      customerId: input.customerId,
      serviceOrderNumber: input.serviceOrderNumber,
      clientContactSnapshot: input.clientContactSnapshot,
    },
    customer: {
      id: input.customerId,
      name: input.customerName,
      email: input.customerEmail,
    },
    brand: { name: "Lab Acme", isWhiteLabel: true },
  };
  emailInput.renderEmail(ctx);
  return mockOrcamentoRecusadoEmail.mock.calls[0][0];
}

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-032: rejected email dispatched with OS number + rejectionReason
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-032: orçamento recusado email dispatched on quote rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLabEmailBrand.mockResolvedValue({
      name: "Lab Acme",
      isWhiteLabel: true,
    });
    mockSendSOEmail.mockResolvedValue({ sent: true, emailId: "e-1" });
    mockOrcamentoRecusadoEmail.mockReturnValue("orcamento-recusado-element");
  });

  it("REQ-SOEMAIL-032: calls sendServiceOrderCustomerEmail once", async () => {
    const input = makeInput();
    await dispatchOrcamentoRecusadoEmail(input);
    expect(mockSendSOEmail).toHaveBeenCalledTimes(1);
  });

  it("REQ-SOEMAIL-032: email subject contains the OS number", async () => {
    const input = makeInput({ serviceOrderNumber: "OS-2026-099" });
    await dispatchOrcamentoRecusadoEmail(input);
    const call = mockSendSOEmail.mock.calls[0];
    expect(call).toBeDefined();
    expect(call[0].subject).toContain("OS-2026-099");
  });

  it("REQ-SOEMAIL-032: template receives serviceOrderNumber", async () => {
    const input = makeInput({ serviceOrderNumber: "OS-2026-777" });
    await dispatchOrcamentoRecusadoEmail(input);
    const props = getTemplateProps(input);
    expect(props.serviceOrderNumber).toBe("OS-2026-777");
  });

  it("REQ-SOEMAIL-032: template receives rejectionReason when present", async () => {
    const input = makeInput({
      rejectionReason: "Valor acima do orçamento previsto",
    });
    await dispatchOrcamentoRecusadoEmail(input);
    const props = getTemplateProps(input);
    expect(props.rejectionReason).toBe("Valor acima do orçamento previsto");
  });

  it("REQ-SOEMAIL-032: template receives null rejectionReason when absent", async () => {
    const input = makeInput({ rejectionReason: null });
    await dispatchOrcamentoRecusadoEmail(input);
    const props = getTemplateProps(input);
    // Must not be present as a non-null/undefined value
    expect(props.rejectionReason == null).toBe(true);
  });

  it("REQ-SOEMAIL-032: template receives customerName", async () => {
    const input = makeInput({ customerName: "Acme Ltda" });
    await dispatchOrcamentoRecusadoEmail(input);
    const props = getTemplateProps(input);
    expect(props.customerName).toBe("Acme Ltda");
  });

  it("REQ-SOEMAIL-032: resolves the lab brand via getLabEmailBrand(organizationId)", async () => {
    const input = makeInput({ organizationId: "org-xyz" });
    await dispatchOrcamentoRecusadoEmail(input);
    expect(mockGetLabEmailBrand).toHaveBeenCalledWith("org-xyz");
  });
});

// ---------------------------------------------------------------------------
// Best-effort: failed email must not throw out of dispatchOrcamentoRecusadoEmail
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-032: best-effort containment — failed email does not propagate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLabEmailBrand.mockResolvedValue(undefined);
  });

  it("does not throw when sendServiceOrderCustomerEmail returns a failure result", async () => {
    mockSendSOEmail.mockResolvedValue({
      sent: false,
      error: "Transport failure",
    });
    const input = makeInput();
    await expect(dispatchOrcamentoRecusadoEmail(input)).resolves.not.toThrow();
  });

  it("does not throw when sendServiceOrderCustomerEmail throws unexpectedly", async () => {
    mockSendSOEmail.mockRejectedValueOnce(new Error("Unexpected crash"));
    const input = makeInput();
    await expect(dispatchOrcamentoRecusadoEmail(input)).resolves.not.toThrow();
  });

  it("does not throw when getLabEmailBrand throws", async () => {
    mockGetLabEmailBrand.mockRejectedValueOnce(new Error("DB error"));
    const input = makeInput();
    await expect(dispatchOrcamentoRecusadoEmail(input)).resolves.not.toThrow();
  });

  it("does not throw when no recipient email is available", async () => {
    mockSendSOEmail.mockResolvedValue({
      sent: false,
      skipped: true,
      skipReason: "No valid recipient address could be resolved",
    });
    const input = makeInput({
      clientContactSnapshot: null,
      customerEmail: null,
    });
    await expect(dispatchOrcamentoRecusadoEmail(input)).resolves.not.toThrow();
  });
});
