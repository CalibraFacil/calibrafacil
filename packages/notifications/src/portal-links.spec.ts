import { describe, expect, it } from "vitest";
import { buildCertificateAmendedLinks } from "./portal-links";

describe("buildCertificateAmendedLinks", () => {
  it("deep-links to the superseded certificate's portal detail page", () => {
    const links = buildCertificateAmendedLinks({
      portalBaseUrl: "https://portal.calibrafacil.com",
      supersededJobIdentifier: "CAL-2026-0123",
    });

    expect(links.actionUrl).toBe("/portal/certificates/CAL-2026-0123");
    expect(links.portalUrl).toBe(
      "https://portal.calibrafacil.com/certificates/CAL-2026-0123",
    );
  });

  it("URL-encodes unusual certificate identifiers", () => {
    const links = buildCertificateAmendedLinks({
      portalBaseUrl: "https://portal.calibrafacil.com",
      supersededJobIdentifier: "CAL 2026/0123",
    });

    expect(links.actionUrl).toBe("/portal/certificates/CAL%202026%2F0123");
    expect(links.portalUrl).toBe(
      "https://portal.calibrafacil.com/certificates/CAL%202026%2F0123",
    );
  });
});
