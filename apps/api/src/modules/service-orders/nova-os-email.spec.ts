/**
 * Tests for REQ-SOEMAIL-011 and REQ-SOEMAIL-012 — mini-spec B "Nova OS"
 *
 * Verifies:
 *  - REQ-011: WHEN a service order is created, a "nova OS" email is sent
 *    containing serviceOrderNumber, asset brand/model/serial, intake date, and
 *    claimedDefect.
 *  - REQ-012: IF no contact email resolves, creation still succeeds and the
 *    email is skipped (no throw).
 *
 * Strategy: test the helper `dispatchNovaOsEmail` in isolation, mocking both
 * the dispatcher (sendServiceOrderCustomerEmail) and getLabEmailBrand.
 * The helper is the testable unit; it is called in createServiceOrder after
 * the transaction commits.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NovaOsEmailDispatchInput } from "./nova-os-email-dispatch";

// ---------------------------------------------------------------------------
// Hoist mocks
// ---------------------------------------------------------------------------

// All mock functions must be hoisted so they are available inside vi.mock
// factory callbacks (vi.mock is hoisted by Vitest's transformer).
const { mockSendSOEmail, mockGetLabEmailBrand, mockNovaOsEmail } = vi.hoisted(
  () => ({
    mockSendSOEmail: vi
      .fn()
      .mockResolvedValue({ sent: true, emailId: "email-id-1" }),
    mockGetLabEmailBrand: vi.fn().mockResolvedValue(undefined),
    mockNovaOsEmail: vi.fn().mockReturnValue("nova-os-element"),
  }),
);

vi.mock("@calibra-facil/notifications", () => ({
  sendServiceOrderCustomerEmail: mockSendSOEmail,
  getLabEmailBrand: mockGetLabEmailBrand,
}));

// Mock @calibra-facil/email — we only care that ServiceOrderCreatedEmail is a function
// that gets called with the right props; we don't need real rendering.
vi.mock("@calibra-facil/email", () => ({
  ServiceOrderCreatedEmail: mockNovaOsEmail,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { dispatchNovaOsEmail } from "./nova-os-email-dispatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  overrides: Partial<NovaOsEmailDispatchInput> = {},
): NovaOsEmailDispatchInput {
  return {
    serviceOrderId: 1,
    serviceOrderNumber: "OS-2024-001",
    organizationId: "org-1",
    publicId: "pub-abc-123",
    customerId: 101,
    clientContactSnapshot: { email: "cliente@example.com", name: "Contato" },
    customerName: "Cliente Teste",
    customerEmail: "customer@example.com",
    assetManufacturer: "Mettler Toledo",
    assetModel: "XS105",
    assetSerialNumber: "SN-9876",
    openedAt: new Date("2026-06-19T12:00:00.000Z"),
    claimedDefect: "Não liga",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-011 (dispatch wiring): the helper passes the required fields to
// the template. The template's ACTUAL field rendering is proven by a real-HTML
// render test co-located with the template in
// packages/email/emails/nova-os-email.spec.ts (tautology guard, mirrors A's REQ-006).
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-011: nova OS email sent on service order creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendSOEmail.mockResolvedValue({ sent: true, emailId: "email-id-1" });
    mockGetLabEmailBrand.mockResolvedValue({
      name: "Lab Acme",
      isWhiteLabel: true,
    });
    mockNovaOsEmail.mockReturnValue("nova-os-element");
  });

  it("REQ-SOEMAIL-011: calls sendServiceOrderCustomerEmail after creation", async () => {
    const input = makeInput();
    await dispatchNovaOsEmail(input);

    expect(mockSendSOEmail).toHaveBeenCalledTimes(1);
  });

  it("REQ-SOEMAIL-011: email subject contains the OS number", async () => {
    const input = makeInput({ serviceOrderNumber: "OS-2026-099" });
    await dispatchNovaOsEmail(input);

    const call = mockSendSOEmail.mock.calls[0];
    expect(call).toBeDefined();
    const emailInput = call[0];
    expect(emailInput.subject).toContain("OS-2026-099");
  });

  it("REQ-SOEMAIL-011: renderEmail callback passes serviceOrderNumber to ServiceOrderCreatedEmail", async () => {
    const input = makeInput({ serviceOrderNumber: "OS-2024-042" });
    await dispatchNovaOsEmail(input);

    // The renderEmail callback is passed to sendServiceOrderCustomerEmail.
    // Invoke it to see what props ServiceOrderCreatedEmail receives.
    const call = mockSendSOEmail.mock.calls[0];
    expect(call).toBeDefined();
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
    expect(mockNovaOsEmail).toHaveBeenCalledWith(
      expect.objectContaining({ serviceOrderNumber: "OS-2024-042" }),
    );
  });

  it("REQ-SOEMAIL-011: renderEmail passes asset brand/manufacturer to ServiceOrderCreatedEmail", async () => {
    const input = makeInput({
      assetManufacturer: "Shimadzu",
      assetModel: "BX-520",
      assetSerialNumber: "SN-1111",
    });
    await dispatchNovaOsEmail(input);

    const call = mockSendSOEmail.mock.calls[0];
    expect(call).toBeDefined();
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
      brand: undefined,
    };
    emailInput.renderEmail(ctx);
    expect(mockNovaOsEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        assetManufacturer: "Shimadzu",
        assetModel: "BX-520",
        assetSerialNumber: "SN-1111",
      }),
    );
  });

  it("REQ-SOEMAIL-011: renderEmail passes intake date (pt-BR formatted) to ServiceOrderCreatedEmail", async () => {
    // 2026-06-19 → "19/06/2026"
    const input = makeInput({
      openedAt: new Date("2026-06-19T00:00:00.000Z"),
    });
    await dispatchNovaOsEmail(input);

    const call = mockSendSOEmail.mock.calls[0];
    expect(call).toBeDefined();
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
      brand: undefined,
    };
    emailInput.renderEmail(ctx);
    // intakeDate must be a pt-BR date string containing "2026" — the exact
    // locale format depends on the TZ, but the year must be present.
    const callArgs = mockNovaOsEmail.mock.calls[0][0];
    expect(callArgs.intakeDate).toMatch(/2026/);
    expect(callArgs.intakeDate).toMatch(/19|06/); // day or month present
  });

  it("REQ-SOEMAIL-011: renderEmail passes claimedDefect to ServiceOrderCreatedEmail", async () => {
    const input = makeInput({ claimedDefect: "Balança descalibrada" });
    await dispatchNovaOsEmail(input);

    const call = mockSendSOEmail.mock.calls[0];
    expect(call).toBeDefined();
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
      brand: undefined,
    };
    emailInput.renderEmail(ctx);
    expect(mockNovaOsEmail).toHaveBeenCalledWith(
      expect.objectContaining({ claimedDefect: "Balança descalibrada" }),
    );
  });

  it("REQ-SOEMAIL-011: resolves the lab brand via getLabEmailBrand(organizationId)", async () => {
    const input = makeInput({ organizationId: "org-xyz" });
    await dispatchNovaOsEmail(input);

    expect(mockGetLabEmailBrand).toHaveBeenCalledWith("org-xyz");
  });
});

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-012: no email → creation still succeeds, email skipped
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-012: no contact email → skip, creation success unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLabEmailBrand.mockResolvedValue(undefined);
  });

  it("REQ-SOEMAIL-012: does not throw when sendServiceOrderCustomerEmail returns skipped", async () => {
    mockSendSOEmail.mockResolvedValue({
      sent: false,
      skipped: true,
      skipReason: "No valid recipient address could be resolved",
    });

    const input = makeInput({
      clientContactSnapshot: null,
      customerEmail: null,
    });

    await expect(dispatchNovaOsEmail(input)).resolves.not.toThrow();
  });

  it("REQ-SOEMAIL-012: does not throw when sendServiceOrderCustomerEmail returns an error result", async () => {
    mockSendSOEmail.mockResolvedValue({
      sent: false,
      error: "Transport failure",
    });

    const input = makeInput();

    await expect(dispatchNovaOsEmail(input)).resolves.not.toThrow();
  });

  it("REQ-SOEMAIL-012: does not throw when sendServiceOrderCustomerEmail throws unexpectedly", async () => {
    mockSendSOEmail.mockRejectedValueOnce(new Error("Unexpected crash"));

    const input = makeInput();

    await expect(dispatchNovaOsEmail(input)).resolves.not.toThrow();
  });

  it("REQ-SOEMAIL-012: does not throw when getLabEmailBrand throws", async () => {
    mockGetLabEmailBrand.mockRejectedValueOnce(new Error("DB error"));

    const input = makeInput();

    await expect(dispatchNovaOsEmail(input)).resolves.not.toThrow();
  });
});
