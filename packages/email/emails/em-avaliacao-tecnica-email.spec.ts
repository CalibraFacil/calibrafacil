/**
 * REQ-SOEMAIL-044 (template rendering) — "Em Avaliação Técnica".
 *
 * Renders the REAL EmAvaliacaoTecnicaEmail template to HTML and asserts the
 * required fields actually appear in the output.
 *
 * Non-tautology guard: remove the OS number from the template body →
 * the "OS-2026-801" assertion goes RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { EmAvaliacaoTecnicaEmail } from "./em-avaliacao-tecnica-email";

describe(
  "REQ-SOEMAIL-044: EmAvaliacaoTecnicaEmail template renders required fields",
  () => {
    async function renderEmAvaliacao(): Promise<string> {
      return render(
        EmAvaliacaoTecnicaEmail({
          brand: { name: "Lab Zeta", isWhiteLabel: true },
          serviceOrderNumber: "OS-2026-801",
          customerName: "Empresa Tecnica Ltda",
        }),
      );
    }

    it("REQ-SOEMAIL-044: includes the OS number", async () => {
      const html = await renderEmAvaliacao();
      expect(html).toContain("OS-2026-801");
    });

    it(
      "REQ-SOEMAIL-044: includes status phrase for under_evaluation",
      async () => {
        const html = await renderEmAvaliacao();
        // The status-specific phrase that must appear in the heading
        expect(html).toContain("Avaliação técnica em andamento");
      },
    );

    it("REQ-SOEMAIL-044: includes the customer name", async () => {
      const html = await renderEmAvaliacao();
      expect(html).toContain("Empresa Tecnica Ltda");
    });

    it("REQ-SOEMAIL-044: includes the lab name from the brand", async () => {
      const html = await renderEmAvaliacao();
      expect(html).toContain("Lab Zeta");
    });
  },
);
