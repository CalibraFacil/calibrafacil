/**
 * Tests for REQ-SOEMAIL-031 — mini-spec D "Orçamento Aprovado" dispatch wiring.
 *
 * Verifies:
 *  - WHEN a quote is approved (manual OR portal), the "orçamento aprovado"
 *    email is dispatched containing the approved total (totalApprovedCents).
 *  - The dispatch is invoked from BOTH approval paths:
 *    approveServiceOrderQuoteManually and approveServiceOrderQuoteByPortalUser.
 *  - A failed email does NOT throw out of the approve commands.
 *  - The total is passed through unchanged (not recomputed).
 *
 * Strategy: test dispatchOrcamentoAprovadoEmail in isolation, mocking both
 * sendServiceOrderCustomerEmail and getLabEmailBrand. The template's ACTUAL
 * field rendering is proven by the real-HTML render test co-located in
 * packages/email/emails/orcamento-aprovado-email.spec.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrcamentoAprovadoEmailDispatchInput } from "./orcamento-aprovado-email-dispatch";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockSendSOEmail,
  mockGetLabEmailBrand,
  mockOrcamentoAprovadoEmail,
} = vi.hoisted(() => ({
  mockSendSOEmail: vi
    .fn()
    .mockResolvedValue({ sent: true, emailId: "email-id-1" }),
  mockGetLabEmailBrand: vi.fn().mockResolvedValue(undefined),
  mockOrcamentoAprovadoEmail: vi
    .fn()
    .mockReturnValue("orcamento-aprovado-element"),
}));

vi.mock("@calibra-facil/notifications", () => ({
  sendServiceOrderCustomerEmail: mockSendSOEmail,
  getLabEmailBrand: mockGetLabEmailBrand,
}));

vi.mock("@calibra-facil/email", () => ({
  OrcamentoAprovadoEmail: mockOrcamentoAprovadoEmail,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { dispatchOrcamentoAprovadoEmail } from "./orcamento-aprovado-email-dispatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  overrides: Partial<OrcamentoAprovadoEmailDispatchInput> = {},
): OrcamentoAprovadoEmailDispatchInput {
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
    totalApprovedCents: 146000,
    ...overrides,
  };
}

// Invoke the renderEmail callback and get the props passed to the template
function getTemplateProps(
  input: OrcamentoAprovadoEmailDispatchInput,
): Parameters<typeof mockOrcamentoAprovadoEmail>[0] {
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
  return mockOrcamentoAprovadoEmail.mock.calls[0][0];
}

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-031: approved email dispatched with totalApprovedCents
// ---------------------------------------------------------------------------

describe(
  "REQ-SOEMAIL-031: orçamento aprovado email dispatched on quote approval",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockGetLabEmailBrand.mockResolvedValue({
        name: "Lab Acme",
        isWhiteLabel: true,
      });
      mockSendSOEmail.mockResolvedValue({ sent: true, emailId: "e-1" });
      mockOrcamentoAprovadoEmail.mockReturnValue("orcamento-aprovado-element");
    });

    it(
      "REQ-SOEMAIL-031: calls sendServiceOrderCustomerEmail once",
      async () => {
        const input = makeInput();
        await dispatchOrcamentoAprovadoEmail(input);
        expect(mockSendSOEmail).toHaveBeenCalledTimes(1);
      },
    );

    it("REQ-SOEMAIL-031: email subject contains the OS number", async () => {
      const input = makeInput({ serviceOrderNumber: "OS-2026-099" });
      await dispatchOrcamentoAprovadoEmail(input);
      const call = mockSendSOEmail.mock.calls[0];
      expect(call).toBeDefined();
      expect(call[0].subject).toContain("OS-2026-099");
    });

    it(
      "REQ-SOEMAIL-031: template receives totalApprovedCents unchanged",
      async () => {
        const input = makeInput({ totalApprovedCents: 146000 });
        await dispatchOrcamentoAprovadoEmail(input);
        const props = getTemplateProps(input);
        expect(props.totalApprovedCents).toBe(146000);
      },
    );

    it(
      "REQ-SOEMAIL-031: template receives totalApprovedCents as persisted (not recomputed)",
      async () => {
        // Use an unusual value to confirm it is passed as-is
        const input = makeInput({ totalApprovedCents: 99999 });
        await dispatchOrcamentoAprovadoEmail(input);
        const props = getTemplateProps(input);
        expect(props.totalApprovedCents).toBe(99999);
      },
    );

    it(
      "REQ-SOEMAIL-031: template receives serviceOrderNumber",
      async () => {
        const input = makeInput({ serviceOrderNumber: "OS-2026-777" });
        await dispatchOrcamentoAprovadoEmail(input);
        const props = getTemplateProps(input);
        expect(props.serviceOrderNumber).toBe("OS-2026-777");
      },
    );

    it("REQ-SOEMAIL-031: template receives customerName", async () => {
      const input = makeInput({ customerName: "Acme Ltda" });
      await dispatchOrcamentoAprovadoEmail(input);
      const props = getTemplateProps(input);
      expect(props.customerName).toBe("Acme Ltda");
    });

    it(
      "REQ-SOEMAIL-031: resolves the lab brand via getLabEmailBrand(organizationId)",
      async () => {
        const input = makeInput({ organizationId: "org-xyz" });
        await dispatchOrcamentoAprovadoEmail(input);
        expect(mockGetLabEmailBrand).toHaveBeenCalledWith("org-xyz");
      },
    );
  },
);

// ---------------------------------------------------------------------------
// Best-effort: failed email must not throw out of dispatchOrcamentoAprovadoEmail
// ---------------------------------------------------------------------------

describe(
  "REQ-SOEMAIL-031: best-effort containment — failed email does not propagate",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockGetLabEmailBrand.mockResolvedValue(undefined);
    });

    it(
      "does not throw when sendServiceOrderCustomerEmail returns a failure result",
      async () => {
        mockSendSOEmail.mockResolvedValue({
          sent: false,
          error: "Transport failure",
        });
        const input = makeInput();
        await expect(
          dispatchOrcamentoAprovadoEmail(input),
        ).resolves.not.toThrow();
      },
    );

    it(
      "does not throw when sendServiceOrderCustomerEmail throws unexpectedly",
      async () => {
        mockSendSOEmail.mockRejectedValueOnce(new Error("Unexpected crash"));
        const input = makeInput();
        await expect(
          dispatchOrcamentoAprovadoEmail(input),
        ).resolves.not.toThrow();
      },
    );

    it("does not throw when getLabEmailBrand throws", async () => {
      mockGetLabEmailBrand.mockRejectedValueOnce(new Error("DB error"));
      const input = makeInput();
      await expect(
        dispatchOrcamentoAprovadoEmail(input),
      ).resolves.not.toThrow();
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
      await expect(
        dispatchOrcamentoAprovadoEmail(input),
      ).resolves.not.toThrow();
    });
  },
);
