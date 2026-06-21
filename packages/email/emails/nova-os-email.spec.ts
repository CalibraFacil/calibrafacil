/**
 * REQ-SOEMAIL-011 (template rendering) — mini-spec B "Nova OS".
 *
 * Renders the real NovaOsEmail template to HTML and asserts the required fields
 * actually appear in the output. This is the tautology guard: asserting props
 * passed to a mocked template (as the apps/api dispatch spec does) cannot prove
 * the fields reach the customer. Mirrors mini-spec A's REQ-006 fix.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { NovaOsEmail } from "./nova-os-email";

describe("REQ-SOEMAIL-011: NovaOsEmail template renders the required fields", () => {
  async function renderNovaOs(): Promise<string> {
    return render(
      NovaOsEmail({
        brand: { name: "Lab Acme", isWhiteLabel: true },
        serviceOrderNumber: "OS-2024-001",
        customerName: "Cliente Teste",
        assetManufacturer: "Mettler Toledo",
        assetModel: "XS105",
        assetSerialNumber: "SN-9876",
        intakeDate: "19/06/2026",
        claimedDefect: "Balança não liga",
      }),
    );
  }

  it("includes OS number, asset brand/model/serial, intake date, and claimed defect", async () => {
    const html = await renderNovaOs();
    expect(html).toContain("OS-2024-001");
    expect(html).toContain("Mettler Toledo");
    expect(html).toContain("XS105");
    expect(html).toContain("SN-9876");
    expect(html).toContain("19/06/2026");
    expect(html).toContain("Balança não liga");
  });
});
