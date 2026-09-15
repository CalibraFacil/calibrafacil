/**
 * REQ-SOEMAIL-053 (template rendering) — "OS Encerrada".
 *
 * Renders the REAL ServiceOrderClosedEmail template to HTML and asserts the
 * required fields actually appear in the output.
 *
 * Non-tautology guard: these tests go RED if the OS number or status phrase
 * is dropped from the template. Mutation: remove serviceOrderNumber from the
 * template body → "OS-2026-702" assertion goes RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { ServiceOrderClosedEmail } from "./service-order-closed-email";

describe("REQ-SOEMAIL-053: ServiceOrderClosedEmail template renders required fields", () => {
  async function renderOsEncerrada(): Promise<string> {
    return render(
      ServiceOrderClosedEmail({
        brand: { name: "Lab Sigma", isWhiteLabel: true },
        serviceOrderNumber: "OS-2026-702",
        customerName: "Industria Encerrada Ltda",
      }),
    );
  }

  it("REQ-SOEMAIL-053: includes the OS number", async () => {
    const html = await renderOsEncerrada();
    expect(html).toContain("OS-2026-702");
  });

  it("REQ-SOEMAIL-053: includes a status-specific phrase indicating OS is closed", async () => {
    const html = await renderOsEncerrada();
    // Status-specific phrase that must appear
    expect(html).toContain("encerrada");
  });

  it("REQ-SOEMAIL-053: includes the customer name", async () => {
    const html = await renderOsEncerrada();
    expect(html).toContain("Industria Encerrada Ltda");
  });

  it("REQ-SOEMAIL-053: includes the lab name from the brand", async () => {
    const html = await renderOsEncerrada();
    expect(html).toContain("Lab Sigma");
  });
});
