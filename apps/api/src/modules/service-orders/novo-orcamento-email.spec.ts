/**
 * Tests for REQ-SOEMAIL-021–024 — mini-spec C "Novo Orçamento" dispatch wiring.
 *
 * Verifies:
 *  - REQ-021: WHEN sendServiceOrderQuote is called (quote status → "sent"),
 *    the "novo orçamento" email is dispatched with the required header fields.
 *  - REQ-022: Line items and persisted totals are passed to the template
 *    (the template render test in packages/email proves they appear in HTML).
 *  - REQ-023 [HIGH RISK]: The token passed to the email is EXACTLY the one
 *    returned by createPublicServiceOrderAccessToken (captured from sendServiceOrderQuote),
 *    NOT a freshly minted token. The approval URL is built from it. No internalNotes.
 *  - REQ-024: BRL formatting — proven by the template test; dispatch passes
 *    integer cents through unchanged.
 *  - Best-effort: a failed email does NOT throw out of dispatchNovoOrcamentoEmail,
 *    so sendServiceOrderQuote is not affected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NovoOrcamentoEmailDispatchInput } from "./novo-orcamento-email-dispatch";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockSendSOEmail,
  mockGetLabEmailBrand,
  mockNovoOrcamentoEmail,
} = vi.hoisted(() => ({
  mockSendSOEmail: vi
    .fn()
    .mockResolvedValue({ sent: true, emailId: "email-id-1" }),
  mockGetLabEmailBrand: vi.fn().mockResolvedValue(undefined),
  mockNovoOrcamentoEmail: vi.fn().mockReturnValue("novo-orcamento-element"),
}));

vi.mock("@calibra-facil/notifications", () => ({
  sendServiceOrderCustomerEmail: mockSendSOEmail,
  getLabEmailBrand: mockGetLabEmailBrand,
}));

vi.mock("@calibra-facil/email", () => ({
  QuoteEmail: mockNovoOrcamentoEmail,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { dispatchNovoOrcamentoEmail } from "./novo-orcamento-email-dispatch";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_ITEMS: NovoOrcamentoEmailDispatchInput["items"] = [
  {
    id: 1,
    type: "service",
    description: "Calibração",
    quantity: 1,
    unit: "un",
    unitPriceCents: 50000,
    totalPriceCents: 50000,
  },
  {
    id: 2,
    type: "part",
    description: "Peça XY",
    quantity: 2,
    unit: "un",
    unitPriceCents: 15000,
    totalPriceCents: 30000,
  },
];

function makeInput(
  overrides: Partial<NovoOrcamentoEmailDispatchInput> = {},
): NovoOrcamentoEmailDispatchInput {
  return {
    serviceOrderId: 1,
    quoteId: 42,
    serviceOrderNumber: "OS-2026-001",
    organizationId: "org-1",
    publicId: "pub-abc-123",
    customerId: 101,
    clientContactSnapshot: { email: "cliente@example.com", name: "Contato" },
    customerName: "Empresa Teste SA",
    customerEmail: "empresa@example.com",
    customerTaxId: "12.345.678/0001-99",
    assetManufacturer: "Mettler Toledo",
    assetModel: "XS205",
    assetInventoryCode: "INV-001",
    assetSerialNumber: "SN-MT-12345",
    displaySpecs: [
      { label: "Capacidade", value: "220g" },
      { label: "Divisão", value: "0,1mg" },
    ],
    openedAt: new Date("2026-06-19T00:00:00.000Z"),
    claimedDefect: "Balança descalibrada",
    items: SAMPLE_ITEMS,
    subtotalServicesCents: 50000,
    subtotalPartsCents: 30000,
    freightCents: 0,
    discountCents: 0,
    totalCents: 80000,
    // REQ-SOEMAIL-023 [HIGH RISK]: this token was returned by
    // createPublicServiceOrderAccessToken INSIDE sendServiceOrderQuote.
    // It must be passed in here — NOT reminted by the dispatch helper.
    publicAccessToken: "tok-from-sendserviceorderquote",
    portalAppUrl: "https://portal.calibrafacil.com",
    ...overrides,
  };
}

// Invoke the renderEmail callback and get the props passed to the template
function getTemplateProps(
  input: NovoOrcamentoEmailDispatchInput,
): Parameters<typeof mockNovoOrcamentoEmail>[0] {
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
  return mockNovoOrcamentoEmail.mock.calls[0][0];
}

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-021: Header fields passed to the template
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-021: novo orçamento email dispatched with header fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLabEmailBrand.mockResolvedValue({
      name: "Lab Acme",
      isWhiteLabel: true,
    });
    mockSendSOEmail.mockResolvedValue({ sent: true, emailId: "e-1" });
    mockNovoOrcamentoEmail.mockReturnValue("novo-orcamento-element");
  });

  it("calls sendServiceOrderCustomerEmail once", async () => {
    const input = makeInput();
    await dispatchNovoOrcamentoEmail(input);
    expect(mockSendSOEmail).toHaveBeenCalledTimes(1);
  });

  it("email subject contains the OS number", async () => {
    const input = makeInput({ serviceOrderNumber: "OS-2026-042" });
    await dispatchNovoOrcamentoEmail(input);
    const call = mockSendSOEmail.mock.calls[0];
    expect(call).toBeDefined();
    expect(call[0].subject).toContain("OS-2026-042");
  });

  it("template receives serviceOrderNumber", async () => {
    const input = makeInput({ serviceOrderNumber: "OS-2026-099" });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.serviceOrderNumber).toBe("OS-2026-099");
  });

  it("template receives customerName", async () => {
    const input = makeInput({ customerName: "Acme Clientes Ltda" });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.customerName).toBe("Acme Clientes Ltda");
  });

  it("template receives customerTaxId (CNPJ/CPF)", async () => {
    const input = makeInput({ customerTaxId: "99.888.777/0001-11" });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.customerTaxId).toBe("99.888.777/0001-11");
  });

  it("template receives assetManufacturer", async () => {
    const input = makeInput({ assetManufacturer: "Shimadzu" });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.assetManufacturer).toBe("Shimadzu");
  });

  it("template receives assetModel", async () => {
    const input = makeInput({ assetModel: "BX-520" });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.assetModel).toBe("BX-520");
  });

  it("template receives intakeDate formatted as pt-BR", async () => {
    const input = makeInput({
      openedAt: new Date("2026-06-19T00:00:00.000Z"),
    });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.intakeDate).toMatch(/2026/);
    expect(props.intakeDate).toMatch(/19|06/);
  });

  it("template receives assetSerialNumber", async () => {
    const input = makeInput({ assetSerialNumber: "SN-999" });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.assetSerialNumber).toBe("SN-999");
  });

  it("template receives displaySpecs (instrument-agnostic, REQ-SOEMAIL-025)", async () => {
    const specs = [{ label: "Faixa", value: "0–150 mm" }];
    const input = makeInput({ displaySpecs: specs });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.displaySpecs).toEqual(specs);
  });

  it("template receives claimedDefect", async () => {
    const input = makeInput({ claimedDefect: "Não mede corretamente" });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.claimedDefect).toBe("Não mede corretamente");
  });

  it("resolves the lab brand via getLabEmailBrand(organizationId)", async () => {
    const input = makeInput({ organizationId: "org-xyz" });
    await dispatchNovoOrcamentoEmail(input);
    expect(mockGetLabEmailBrand).toHaveBeenCalledWith("org-xyz");
  });
});

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-022: Persisted totals passed unchanged (not recomputed)
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-022: persisted totals passed to template unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLabEmailBrand.mockResolvedValue({ name: "Lab", isWhiteLabel: true });
    mockSendSOEmail.mockResolvedValue({ sent: true });
    mockNovoOrcamentoEmail.mockReturnValue("element");
  });

  it("passes items array to template", async () => {
    const input = makeInput();
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.items).toHaveLength(2);
    expect(props.items[0].description).toBe("Calibração");
    expect(props.items[1].description).toBe("Peça XY");
  });

  it("passes subtotalServicesCents as persisted (not recomputed)", async () => {
    // Persisted value differs from what items would sum to — proves no recompute
    const input = makeInput({
      subtotalServicesCents: 99999, // different from items sum
    });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.subtotalServicesCents).toBe(99999);
  });

  it("passes subtotalPartsCents as persisted (not recomputed)", async () => {
    const input = makeInput({ subtotalPartsCents: 88888 });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.subtotalPartsCents).toBe(88888);
  });

  it("passes freightCents as persisted", async () => {
    const input = makeInput({ freightCents: 5000 });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.freightCents).toBe(5000);
  });

  it("passes discountCents as persisted", async () => {
    const input = makeInput({ discountCents: 2500 });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.discountCents).toBe(2500);
  });

  it("passes totalCents as persisted (not recomputed) [HIGH RISK]", async () => {
    const input = makeInput({ totalCents: 146000 });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.totalCents).toBe(146000);
  });
});

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-023 [HIGH RISK]: token reuse + approval URL + no internalNotes
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-023: token reuse, approval URL, no internalNotes [HIGH RISK]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLabEmailBrand.mockResolvedValue({ name: "Lab", isWhiteLabel: true });
    mockSendSOEmail.mockResolvedValue({ sent: true });
    mockNovoOrcamentoEmail.mockReturnValue("element");
  });

  it("builds approvalUrl from the captured token (not a new one)", async () => {
    const input = makeInput({
      publicAccessToken: "tok-exact-from-sendserviceorderquote",
      portalAppUrl: "https://portal.example.com",
    });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.approvalUrl).toBe(
      "https://portal.example.com/service-order-access/tok-exact-from-sendserviceorderquote",
    );
  });

  it("approvalUrl uses PORTAL_APP_URL base from input (not hardcoded)", async () => {
    const input = makeInput({
      publicAccessToken: "tok-123",
      portalAppUrl: "https://custom.portal.io",
    });
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    expect(props.approvalUrl).toContain("https://custom.portal.io");
    expect(props.approvalUrl).toContain("tok-123");
  });

  it("does NOT pass internalNotes to the template props", async () => {
    const input = makeInput();
    await dispatchNovoOrcamentoEmail(input);
    const props = getTemplateProps(input);
    // internalNotes must not be a key in the template props
    expect(props).not.toHaveProperty("internalNotes");
  });

  it("if different token is passed, URL changes — proves no re-minting", async () => {
    const input1 = makeInput({ publicAccessToken: "tok-A" });
    await dispatchNovoOrcamentoEmail(input1);
    const props1 = getTemplateProps(input1);

    vi.clearAllMocks();
    mockGetLabEmailBrand.mockResolvedValue({ name: "Lab", isWhiteLabel: true });
    mockSendSOEmail.mockResolvedValue({ sent: true });
    mockNovoOrcamentoEmail.mockReturnValue("element");

    const input2 = makeInput({ publicAccessToken: "tok-B" });
    await dispatchNovoOrcamentoEmail(input2);
    const props2 = getTemplateProps(input2);

    // The two URLs must differ by the token — proving the caller's token is used
    expect(props1.approvalUrl).toContain("tok-A");
    expect(props2.approvalUrl).toContain("tok-B");
    expect(props1.approvalUrl).not.toContain("tok-B");
  });
});

// ---------------------------------------------------------------------------
// Best-effort: failed email must not throw out of dispatchNovoOrcamentoEmail
// ---------------------------------------------------------------------------

describe("best-effort containment: failed email does not propagate", () => {
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
    await expect(dispatchNovoOrcamentoEmail(input)).resolves.not.toThrow();
  });

  it("does not throw when sendServiceOrderCustomerEmail throws unexpectedly", async () => {
    mockSendSOEmail.mockRejectedValueOnce(new Error("Unexpected crash"));
    const input = makeInput();
    await expect(dispatchNovoOrcamentoEmail(input)).resolves.not.toThrow();
  });

  it("does not throw when getLabEmailBrand throws", async () => {
    mockGetLabEmailBrand.mockRejectedValueOnce(new Error("DB error"));
    const input = makeInput();
    await expect(dispatchNovoOrcamentoEmail(input)).resolves.not.toThrow();
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
    await expect(dispatchNovoOrcamentoEmail(input)).resolves.not.toThrow();
  });
});
