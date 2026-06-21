/**
 * REQ-SOEMAIL-051 (template rendering) — "Pronto para Retirada".
 *
 * Renders the REAL ProntoPuraRetiradaEmail template to HTML and asserts the
 * required fields actually appear in the output.
 *
 * Non-tautology guard: these tests go RED if the OS number or status phrase
 * is dropped from the template. Mutation: remove serviceOrderNumber from the
 * template body → "OS-2026-700" assertion goes RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { ProntoParaRetiradaEmail } from "./pronto-para-retirada-email";

describe(
  "REQ-SOEMAIL-051: ProntoParaRetiradaEmail template renders required fields",
  () => {
    async function renderProntoParaRetirada(): Promise<string> {
      return render(
        ProntoParaRetiradaEmail({
          brand: { name: "Lab Delta", isWhiteLabel: true },
          serviceOrderNumber: "OS-2026-700",
          customerName: "Cliente Retirada Ltda",
        }),
      );
    }

    it("REQ-SOEMAIL-051: includes the OS number", async () => {
      const html = await renderProntoParaRetirada();
      expect(html).toContain("OS-2026-700");
    });

    it(
      "REQ-SOEMAIL-051: includes a status-specific phrase indicating ready for pickup",
      async () => {
        const html = await renderProntoParaRetirada();
        // Status-specific phrase that must appear
        expect(html).toContain("pronto para retirada");
      },
    );

    it("REQ-SOEMAIL-051: includes the customer name", async () => {
      const html = await renderProntoParaRetirada();
      expect(html).toContain("Cliente Retirada Ltda");
    });

    it("REQ-SOEMAIL-051: includes the lab name from the brand", async () => {
      const html = await renderProntoParaRetirada();
      expect(html).toContain("Lab Delta");
    });
  },
);
