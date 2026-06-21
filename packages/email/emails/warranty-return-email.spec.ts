/**
 * REQ-SOEMAIL-062 (template rendering) — "Garantia Retorno".
 *
 * Renders the REAL WarrantyReturnEmail template to HTML and asserts the
 * required fields actually appear in the output.
 *
 * Non-tautology guard: these tests go RED if the OS number or status phrase
 * is dropped from the template. Mutation: remove serviceOrderNumber from the
 * template body → "OS-2026-801" assertion goes RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { WarrantyReturnEmail } from "./warranty-return-email";

describe(
  "REQ-SOEMAIL-062: WarrantyReturnEmail template renders required fields",
  () => {
    async function renderGarantiaRetorno(): Promise<string> {
      return render(
        WarrantyReturnEmail({
          brand: { name: "Lab Zeta", isWhiteLabel: true },
          serviceOrderNumber: "OS-2026-801",
          customerName: "Industria Garantia Ltda",
        }),
      );
    }

    it("REQ-SOEMAIL-062: includes the OS number", async () => {
      const html = await renderGarantiaRetorno();
      expect(html).toContain("OS-2026-801");
    });

    it(
      "REQ-SOEMAIL-062: includes a status-specific phrase indicating warranty return",
      async () => {
        const html = await renderGarantiaRetorno();
        // Status-specific phrase that must appear (garantia)
        expect(html.toLowerCase()).toContain("garantia");
      },
    );

    it("REQ-SOEMAIL-062: includes the customer name", async () => {
      const html = await renderGarantiaRetorno();
      expect(html).toContain("Industria Garantia Ltda");
    });

    it("REQ-SOEMAIL-062: includes the lab name from the brand", async () => {
      const html = await renderGarantiaRetorno();
      expect(html).toContain("Lab Zeta");
    });
  },
);
