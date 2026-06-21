/**
 * REQ-SOEMAIL-041 (template rendering) — "Serviço Iniciado".
 *
 * Renders the REAL ServiceStartedEmail template to HTML and asserts the
 * required fields actually appear in the output.
 *
 * Non-tautology guard: these tests go RED if the OS number or status phrase
 * is dropped from the template. Mutation: remove serviceOrderNumber from the
 * template body → "OS-2026-555" assertion goes RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { ServiceStartedEmail } from "./service-started-email";

describe(
  "REQ-SOEMAIL-041: ServiceStartedEmail template renders required fields",
  () => {
    async function renderIniciado(): Promise<string> {
      return render(
        ServiceStartedEmail({
          brand: { name: "Lab Omega", isWhiteLabel: true },
          serviceOrderNumber: "OS-2026-555",
          customerName: "Cliente Iniciado SA",
        }),
      );
    }

    it("REQ-SOEMAIL-041: includes the OS number", async () => {
      const html = await renderIniciado();
      expect(html).toContain("OS-2026-555");
    });

    it(
      "REQ-SOEMAIL-041: includes a status-specific phrase indicating service has started",
      async () => {
        const html = await renderIniciado();
        // "Serviço iniciado" appears in the badge and the detail row
        expect(html).toContain("Serviço iniciado");
      },
    );

    it("REQ-SOEMAIL-041: includes the customer name", async () => {
      const html = await renderIniciado();
      expect(html).toContain("Cliente Iniciado SA");
    });

    it(
      "REQ-SOEMAIL-041: includes the lab name from the brand",
      async () => {
        const html = await renderIniciado();
        expect(html).toContain("Lab Omega");
      },
    );
  },
);
