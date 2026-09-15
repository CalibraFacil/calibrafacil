import { describe, expect, it } from "vitest";

import { resolvePdfRenderRequest } from "./index";

/**
 * Which page geometry a certificate is rendered with is a compliance property,
 * not a styling one: NIE-Cgcre-009 §11.5.2 needs the accreditation sentence on
 * continuation pages, and §7.8.2.1(d) needs every page identifiable on its own.
 * Both arrive through the running header, and the header only survives if the
 * certificate branch is picked AND the margin box comes from the stylesheet.
 *
 * These assert the branch, not Gotenberg — no container required.
 */

const CERTIFICATE = '<html lang="pt-BR" data-pdf-layout="certificate">';
const FULL_PAGE = '<html data-pdf-layout="full-page">';
const PLAIN = '<html lang="pt-BR">';

describe("resolvePdfRenderRequest", () => {
  it("gives the certificate its own margins and both running templates", () => {
    const { properties, extraFiles } = resolvePdfRenderRequest(CERTIFICATE, {
      headerHtml: "<div>header</div>",
      footerHtml: "<div>footer</div>",
    });
    expect(properties.preferCssPageSize).toBe("true");
    expect(extraFiles["header.html"]).toBe("<div>header</div>");
    expect(extraFiles["footer.html"]).toBe("<div>footer</div>");
    // Setting any margin* here would override the @page box the layout
    // declares, and the running header would have nowhere to render.
    expect(
      Object.keys(properties).filter((k) => k.startsWith("margin")),
    ).toEqual([]);
  });

  it("omits a running template that was not supplied", () => {
    const { extraFiles } = resolvePdfRenderRequest(CERTIFICATE, {
      footerHtml: "<div>footer</div>",
    });
    // An empty header.html makes Chromium render a blank band, not nothing.
    expect(extraFiles).not.toHaveProperty("header.html");
    expect(extraFiles).toHaveProperty("footer.html");
  });

  it("does not give the certificate the generic page footer", () => {
    // The default branch injects its own "Página X de Y". The certificate
    // supplies its own, and getting both would double the footer.
    const { extraFiles } = resolvePdfRenderRequest(CERTIFICATE, {
      footerHtml: "<div>cert footer</div>",
    });
    expect(extraFiles["footer.html"]).toBe("<div>cert footer</div>");
  });

  it("leaves the full-page branch exactly as it was", () => {
    const { properties, extraFiles } = resolvePdfRenderRequest(FULL_PAGE);
    expect(properties.preferCssPageSize).toBe("true");
    expect(properties.marginTop).toBe("0");
    expect(extraFiles).toEqual({});
  });

  it("leaves the default branch exactly as it was", () => {
    const { properties, extraFiles } = resolvePdfRenderRequest(PLAIN);
    expect(properties.preferCssPageSize).toBeUndefined();
    expect(properties.paperWidth).toBe("8.27");
    expect(extraFiles["footer.html"]).toContain("pageNumber");
  });

  it("ignores header and footer markup outside the certificate branch", () => {
    // Only the certificate layout reserves room for a running header; handing
    // one to the fixed-A4 branch would overlap the content.
    const { extraFiles } = resolvePdfRenderRequest(PLAIN, {
      headerHtml: "<div>header</div>",
    });
    expect(extraFiles).not.toHaveProperty("header.html");
  });
});
