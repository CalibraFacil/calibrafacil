/**
 * REQ-SOEMAIL-031 (template rendering) — mini-spec D "Orçamento Aprovado".
 *
 * Renders the REAL OrcamentoAprovadoEmail template to HTML and asserts the
 * required fields actually appear in the output.
 *
 * Tautology guard: mocking the template and asserting props passed to it cannot
 * prove the fields reach the customer — a dropped field still passes that test.
 * This test renders to real HTML and asserts the values appear.
 *
 * Mutation check: remove `totalApprovedCents` from the template → the
 * corresponding `R$ 1.460,00` assertion must go RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { OrcamentoAprovadoEmail } from "./orcamento-aprovado-email";

describe(
  "REQ-SOEMAIL-031: OrcamentoAprovadoEmail template renders the required fields",
  () => {
    async function renderApproved(): Promise<string> {
      return render(
        OrcamentoAprovadoEmail({
          brand: { name: "Lab Acme", isWhiteLabel: true },
          serviceOrderNumber: "OS-2026-042",
          customerName: "Empresa Teste SA",
          totalApprovedCents: 146000,
        }),
      );
    }

    it("REQ-SOEMAIL-031: includes the OS number", async () => {
      const html = await renderApproved();
      expect(html).toContain("OS-2026-042");
    });

    it("REQ-SOEMAIL-031: includes the approved total formatted as BRL", async () => {
      const html = await renderApproved();
      // 146000 cents → "R$ 1.460,00"
      expect(html).toContain("1.460,00");
    });

    it("REQ-SOEMAIL-031: includes the customer name", async () => {
      const html = await renderApproved();
      expect(html).toContain("Empresa Teste SA");
    });

    it(
      "REQ-SOEMAIL-031: totalApprovedCents=0 renders R$ 0,00 (zero case)",
      async () => {
        const html = await render(
          OrcamentoAprovadoEmail({
            brand: { name: "Lab Acme", isWhiteLabel: true },
            serviceOrderNumber: "OS-2026-001",
            customerName: "Cliente",
            totalApprovedCents: 0,
          }),
        );
        expect(html).toContain("0,00");
      },
    );
  },
);
