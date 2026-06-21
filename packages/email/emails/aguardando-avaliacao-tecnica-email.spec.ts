/**
 * REQ-SOEMAIL-043 (template rendering) — "Aguardando Avaliação Técnica".
 *
 * Renders the REAL AguardandoAvaliacaoTecnicaEmail template to HTML and
 * asserts the required fields actually appear in the output.
 *
 * Non-tautology guard: remove the OS number from the template body →
 * the "OS-2026-701" assertion goes RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { AguardandoAvaliacaoTecnicaEmail } from "./aguardando-avaliacao-tecnica-email";

describe(
  "REQ-SOEMAIL-043: AguardandoAvaliacaoTecnicaEmail template renders required fields",
  () => {
    async function renderAguardando(): Promise<string> {
      return render(
        AguardandoAvaliacaoTecnicaEmail({
          brand: { name: "Lab Sigma", isWhiteLabel: true },
          serviceOrderNumber: "OS-2026-701",
          customerName: "Empresa Avaliacao ME",
        }),
      );
    }

    it("REQ-SOEMAIL-043: includes the OS number", async () => {
      const html = await renderAguardando();
      expect(html).toContain("OS-2026-701");
    });

    it(
      "REQ-SOEMAIL-043: includes status phrase for awaiting_tech_evaluation",
      async () => {
        const html = await renderAguardando();
        // The status-specific phrase that must appear in this email
        expect(html).toContain("avaliação técnica");
      },
    );

    it("REQ-SOEMAIL-043: includes the customer name", async () => {
      const html = await renderAguardando();
      expect(html).toContain("Empresa Avaliacao ME");
    });

    it("REQ-SOEMAIL-043: includes the lab name from the brand", async () => {
      const html = await renderAguardando();
      expect(html).toContain("Lab Sigma");
    });
  },
);
