import { describe, expect, it } from "vitest";

import {
  embedCertificatePageFooter,
  extractCertificatePageFooterHtml,
  renderBandPageFooterTemplate,
  renderBandTopIdentityInner,
} from "./bands.js";
import { compileCertificateHtml } from "./compile.js";
import { sampleCertificateInputData } from "./fixtures/sample-input-data.js";
import { newWysiwygStarterDocument } from "./starter-document.js";

const TOP_DEFAULTS = {
  enabled: true,
  showLabName: true,
  showCertificateNumber: true,
  showTitle: false,
  showSealText: true,
};

const FOOTER_DEFAULTS = {
  enabled: true,
  showCertificateNumber: true,
  showLabName: false,
  showIssueDate: false,
};

describe("renderBandTopIdentityInner", () => {
  it("renders lab name, certificate number and the accreditation text line", () => {
    const html = renderBandTopIdentityInner(TOP_DEFAULTS, sampleCertificateInputData);
    expect(html).toContain("cf-band-lab");
    expect(html).toContain("Certificado CAL-2026-0042");
    expect(html).toContain("acreditado pela Cgcre");
  });

  it("returns empty when disabled (compiler then omits the thead)", () => {
    expect(
      renderBandTopIdentityInner(
        { ...TOP_DEFAULTS, enabled: false },
        sampleCertificateInputData,
      ),
    ).toBe("");
  });

  it("element toggles remove their fragment", () => {
    const html = renderBandTopIdentityInner(
      { ...TOP_DEFAULTS, showSealText: false, showLabName: false, showTitle: true },
      sampleCertificateInputData,
    );
    expect(html).not.toContain("cf-band-seal-text");
    expect(html).not.toContain("cf-band-lab");
    expect(html).toContain("Certificado de Calibração");
  });
});

describe("renderBandPageFooterTemplate", () => {
  it("always carries pageNumber/totalPages spans (NIE-CGCRE-009), even disabled", () => {
    for (const attrs of [FOOTER_DEFAULTS, { ...FOOTER_DEFAULTS, enabled: false }]) {
      const html = renderBandPageFooterTemplate(attrs, sampleCertificateInputData);
      expect(html).toContain('<span class="pageNumber"></span>');
      expect(html).toContain('<span class="totalPages"></span>');
    }
  });

  it("identity fields follow the toggles", () => {
    const full = renderBandPageFooterTemplate(
      { enabled: true, showCertificateNumber: true, showLabName: true, showIssueDate: true },
      sampleCertificateInputData,
    );
    expect(full).toContain("Certificado CAL-2026-0042");
    expect(full).toContain("Laboratório Exemplo");
    expect(full).toContain("Emitido em");

    const disabled = renderBandPageFooterTemplate(
      { ...FOOTER_DEFAULTS, enabled: false },
      sampleCertificateInputData,
    );
    expect(disabled).not.toContain("Certificado CAL-2026-0042");
  });

  it("footer type never undercuts the 8pt print floor", () => {
    const html = renderBandPageFooterTemplate(FOOTER_DEFAULTS, sampleCertificateInputData);
    const sizes = [...html.matchAll(/font-size:\s*([\d.]+)pt/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(8);
  });
});

describe("footer embed/extract", () => {
  it("round-trips the footer document through the artifact wrapper", () => {
    const footer = renderBandPageFooterTemplate(FOOTER_DEFAULTS, sampleCertificateInputData);
    const embedded = `<body>content${embedCertificatePageFooter(footer)}</body>`;
    expect(extractCertificatePageFooterHtml(embedded)).toBe(footer);
  });

  it("returns null for pre-M-B artifacts without the template", () => {
    expect(extractCertificatePageFooterHtml("<html><body>old</body></html>")).toBeNull();
  });
});

describe("compiled band structure", () => {
  it("emits exactly one repeating thead band and one embedded footer template", async () => {
    const { html } = await compileCertificateHtml(
      newWysiwygStarterDocument(),
      sampleCertificateInputData,
    );
    expect(html.match(/<thead class="cf-doc-header">/g)?.length).toBe(1);
    expect(html.match(/<template id="cf-page-footer">/g)?.length).toBe(1);
    expect(html).toContain('<table class="cf-doc">');
    const footer = extractCertificatePageFooterHtml(html);
    expect(footer).toContain('<span class="pageNumber"></span>');
  });

  it("omits the thead entirely when the top band is disabled", async () => {
    const doc: { content: { type: string; attrs?: Record<string, unknown> }[] } =
      JSON.parse(JSON.stringify(newWysiwygStarterDocument()));
    const top = doc.content[0];
    if (!top || top.type !== "bandTopIdentity") throw new Error("missing top band");
    top.attrs = { ...TOP_DEFAULTS, enabled: false };
    const { html } = await compileCertificateHtml(doc, sampleCertificateInputData);
    // the results-grid tables keep their own theads; only the BAND thead goes
    expect(html).not.toContain('<thead class="cf-doc-header">');
    // the footer template stays: page numbers are not disableable
    expect(extractCertificatePageFooterHtml(html)).toContain("pageNumber");
  });
});

describe("placement presets (M-C)", () => {
  it("seal and masthead presets emit whitelisted modifier classes only", async () => {
    const doc: { content: { type: string; attrs?: Record<string, unknown> }[] } =
      JSON.parse(JSON.stringify(newWysiwygStarterDocument()));
    for (const node of doc.content) {
      const attrs = node.attrs ?? {};
      if (Reflect.get(attrs, "blockKey") === "accreditation_seal") {
        Reflect.set(attrs, "layout", { preset: "seal-center" });
      }
      if (Reflect.get(attrs, "blockKey") === "lab_identification") {
        Reflect.set(attrs, "layout", { preset: "logo-right" });
      }
      if (Reflect.get(attrs, "blockKey") === "customer_identification") {
        // unknown preset: must NOT leak into a class
        Reflect.set(attrs, "layout", { preset: "evil injection" });
      }
    }
    const { html } = await compileCertificateHtml(doc, sampleCertificateInputData);
    expect(html).toContain("cf-accreditation-seal cf-preset-seal-center");
    expect(html).toContain("cf-masthead cf-preset-logo-right");
    expect(html).not.toContain("evil injection");
  });
});

describe("band element slots (M-C)", () => {
  it("absent slot attrs reproduce the M-B arrangement", () => {
    const html = renderBandTopIdentityInner(TOP_DEFAULTS, sampleCertificateInputData);
    // labName left, certNumber right, seal text bare on the second line
    expect(html).toMatch(
      /cf-band-left"><span class="cf-band-lab"/,
    );
    expect(html).toMatch(/cf-band-right"><span class="cf-band-cert"/);
    expect(html).toMatch(/cf-band-seal-text">Laboratório de calibração/);
  });

  it("slots move elements across the identity row", () => {
    const html = renderBandTopIdentityInner(
      {
        ...TOP_DEFAULTS,
        labNameSlot: "right",
        certificateNumberSlot: "left",
        sealTextSlot: "right",
      },
      sampleCertificateInputData,
    );
    expect(html).toMatch(/cf-band-left"><span class="cf-band-cert"/);
    expect(html).toMatch(
      /cf-band-right"><span class="cf-band-lab"[^]*cf-band-seal-inline/,
    );
    expect(html).not.toContain("cf-band-seal-text");
  });

  it("footer identitySide=right puts page numbers on the left", () => {
    const left = renderBandPageFooterTemplate(FOOTER_DEFAULTS, sampleCertificateInputData);
    expect(left.indexOf("Certificado CAL-2026-0042")).toBeLessThan(
      left.indexOf("pageNumber"),
    );
    const right = renderBandPageFooterTemplate(
      { ...FOOTER_DEFAULTS, identitySide: "right" },
      sampleCertificateInputData,
    );
    expect(right.indexOf("pageNumber")).toBeLessThan(
      right.indexOf("Certificado CAL-2026-0042"),
    );
  });
});
