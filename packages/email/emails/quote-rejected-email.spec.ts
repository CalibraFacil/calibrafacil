/**
 * REQ-SOEMAIL-032 (template rendering) — mini-spec D "Orçamento Recusado".
 *
 * Renders the REAL QuoteRejectedEmail template to HTML and asserts the
 * required fields actually appear in the output.
 *
 * Tautology guard: mocking the template cannot prove a field reaches the
 * customer. Render to real HTML and assert the values appear.
 *
 * Mutation check: remove `serviceOrderNumber` or `rejectionReason` from the
 * template → the corresponding assertions must go RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { QuoteRejectedEmail } from "./quote-rejected-email";

describe(
  "REQ-SOEMAIL-032: QuoteRejectedEmail template renders the required fields",
  () => {
    async function renderRejected(
      overrides: Partial<{
        serviceOrderNumber: string;
        customerName: string;
        rejectionReason: string | null | undefined;
      }> = {},
    ): Promise<string> {
      return render(
        QuoteRejectedEmail({
          brand: { name: "Lab Acme", isWhiteLabel: true },
          serviceOrderNumber: "OS-2026-042",
          customerName: "Empresa Teste SA",
          rejectionReason: "Valor acima do orçamento previsto",
          ...overrides,
        }),
      );
    }

    it("REQ-SOEMAIL-032: includes the OS number", async () => {
      const html = await renderRejected();
      expect(html).toContain("OS-2026-042");
    });

    it("REQ-SOEMAIL-032: includes the customer name", async () => {
      const html = await renderRejected();
      expect(html).toContain("Empresa Teste SA");
    });

    it("REQ-SOEMAIL-032: includes the rejectionReason when present", async () => {
      const html = await renderRejected({
        rejectionReason: "Valor acima do orçamento previsto",
      });
      expect(html).toContain("Valor acima do orçamento previsto");
    });

    it(
      "REQ-SOEMAIL-032: renders without error when rejectionReason is absent",
      async () => {
        const html = await renderRejected({ rejectionReason: undefined });
        // Must still contain the OS number — and must not throw
        expect(html).toContain("OS-2026-042");
      },
    );

    it(
      "REQ-SOEMAIL-032: renders without error when rejectionReason is null",
      async () => {
        const html = await renderRejected({ rejectionReason: null });
        expect(html).toContain("OS-2026-042");
      },
    );
  },
);
