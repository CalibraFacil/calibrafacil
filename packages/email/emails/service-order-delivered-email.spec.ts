/**
 * REQ-SOEMAIL-052 (template rendering) — "OS Entregue".
 *
 * Renders the REAL ServiceOrderDeliveredEmail template to HTML and asserts the
 * required fields actually appear in the output.
 *
 * Non-tautology guard: these tests go RED if the OS number or status phrase
 * is dropped from the template. Mutation: remove serviceOrderNumber from the
 * template body → "OS-2026-701" assertion goes RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { ServiceOrderDeliveredEmail } from "./service-order-delivered-email";

describe(
  "REQ-SOEMAIL-052: ServiceOrderDeliveredEmail template renders required fields",
  () => {
    async function renderOsEntregue(): Promise<string> {
      return render(
        ServiceOrderDeliveredEmail({
          brand: { name: "Lab Epsilon", isWhiteLabel: true },
          serviceOrderNumber: "OS-2026-701",
          customerName: "Empresa Entregue SA",
        }),
      );
    }

    it("REQ-SOEMAIL-052: includes the OS number", async () => {
      const html = await renderOsEntregue();
      expect(html).toContain("OS-2026-701");
    });

    it(
      "REQ-SOEMAIL-052: includes a status-specific phrase confirming delivery",
      async () => {
        const html = await renderOsEntregue();
        // Status-specific phrase that must appear (delivery receipt)
        expect(html).toContain("entregue");
      },
    );

    it("REQ-SOEMAIL-052: includes the customer name", async () => {
      const html = await renderOsEntregue();
      expect(html).toContain("Empresa Entregue SA");
    });

    it("REQ-SOEMAIL-052: includes the lab name from the brand", async () => {
      const html = await renderOsEntregue();
      expect(html).toContain("Lab Epsilon");
    });
  },
);
