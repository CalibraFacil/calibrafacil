/**
 * Audit pack ready email (#738) — renders the REAL template to HTML and
 * asserts the values a customer needs actually appear in the output (same
 * tautology guard as the service-order email specs: mocking the template and
 * asserting props cannot prove the fields reach the customer).
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { AuditPackReadyEmail } from "./audit-pack-ready-email";

describe("AuditPackReadyEmail template renders the required fields", () => {
  async function renderReady(): Promise<string> {
    return render(
      AuditPackReadyEmail({
        recipientName: "Maria Qualidade",
        customerName: "Empresa Teste SA",
        periodLabel: "01/01/2026 a 30/06/2026",
        certificateCount: 42,
        expiresAtLabel: "17/07/2026",
        portalUrl: "https://portal.example.com/certificates",
        brand: { name: "Lab Acme", isWhiteLabel: true },
      }),
    );
  }

  it("includes the recipient greeting and customer name", async () => {
    const html = await renderReady();
    expect(html).toContain("Maria Qualidade");
    expect(html).toContain("Empresa Teste SA");
  });

  it("includes the requested period and certificate count", async () => {
    const html = await renderReady();
    expect(html).toContain("01/01/2026 a 30/06/2026");
    expect(html).toContain("42");
  });

  it("includes the download-availability deadline", async () => {
    const html = await renderReady();
    expect(html).toContain("17/07/2026");
  });

  it("links to the portal certificates page", async () => {
    const html = await renderReady();
    expect(html).toContain("https://portal.example.com/certificates");
  });
});
