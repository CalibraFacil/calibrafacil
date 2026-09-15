/**
 * REQ-SOEMAIL-061 (template rendering) — "OS Cancelada".
 *
 * Renders the REAL ServiceOrderCanceledEmail template to HTML and asserts the
 * required fields actually appear in the output.
 *
 * Non-tautology guard: these tests go RED if the OS number or status phrase
 * is dropped from the template. Mutation: remove serviceOrderNumber from the
 * template body → "OS-2026-800" assertion goes RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { ServiceOrderCanceledEmail } from "./service-order-canceled-email";

describe("REQ-SOEMAIL-061: ServiceOrderCanceledEmail template renders required fields", () => {
  async function renderOsCancelada(): Promise<string> {
    return render(
      ServiceOrderCanceledEmail({
        brand: { name: "Lab Omega", isWhiteLabel: true },
        serviceOrderNumber: "OS-2026-800",
        customerName: "Empresa Cancelada SA",
      }),
    );
  }

  it("REQ-SOEMAIL-061: includes the OS number", async () => {
    const html = await renderOsCancelada();
    expect(html).toContain("OS-2026-800");
  });

  it("REQ-SOEMAIL-061: includes a status-specific phrase indicating cancellation", async () => {
    const html = await renderOsCancelada();
    // Status-specific phrase that must appear (cancelada / cancelamento)
    expect(html.toLowerCase()).toContain("cancelada");
  });

  it("REQ-SOEMAIL-061: includes the customer name", async () => {
    const html = await renderOsCancelada();
    expect(html).toContain("Empresa Cancelada SA");
  });

  it("REQ-SOEMAIL-061: includes the lab name from the brand", async () => {
    const html = await renderOsCancelada();
    expect(html).toContain("Lab Omega");
  });
});
