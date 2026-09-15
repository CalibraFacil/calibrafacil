/** @jsxImportSource react */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CalibrationCertificateHtml } from "./CalibrationCertificateHtml.js";
import { certificateHeaderHtml } from "./certificate-styles.js";
import { massCertificateFixture } from "./fixtures.js";
import type { CalibrationCertificateData } from "./types.js";

/**
 * The certificate is a regulated document, so these tests pin the things that
 * are WRONG rather than merely ugly if they change: a forbidden sign in a
 * table, a seal on an unaccredited certificate, a missing mandatory statement.
 *
 * House pattern (see FleetStatusReportHtml.spec.ts and
 * apps/web/.../repair-mark-gating.test.tsx): render the real component and
 * assert on exact pt-BR strings. No snapshots — a snapshot would go green on
 * a re-record and tell us nothing about whether the norm is still satisfied.
 */

function render(data: CalibrationCertificateData): string {
  return renderToStaticMarkup(<CalibrationCertificateHtml data={data} />);
}

/**
 * The markup for assertions about what is RENDERED. The component inlines its
 * stylesheet, so every class name appears in the document as a CSS selector
 * whether or not the element exists — asserting `toContain("masthead__seal")`
 * against the whole string matches the stylesheet and always passes.
 */
function body(data: CalibrationCertificateData): string {
  const html = render(data);
  const start = html.indexOf("</style>");
  if (start === -1) throw new Error("expected an inlined stylesheet");
  return html.slice(start);
}

describe("CalibrationCertificateHtml", () => {
  it("prints the identity page before any results (§7.8.2.1 + editorial survey)", () => {
    const html = render(massCertificateFixture());
    // The reader meets the item and the dates before the numbers.
    expect(html.indexOf("Item calibrado")).toBeLessThan(
      html.indexOf("Resultados antes do ajuste"),
    );
    // The standards table belongs with the identity block, before the
    // results — that is what fills page one in the certificates surveyed.
    expect(html.indexOf("Padrões e rastreabilidade")).toBeLessThan(
      html.indexOf("Resultados antes do ajuste"),
    );
    // Ordering is the requirement; pagination is left to content volume, so
    // there is deliberately no forced page break to assert on.
  });

  it("§7.8.2.1(j): prints the issue date even when it equals the calibration date", () => {
    const data = massCertificateFixture();
    data.dates.performedAtText = "25/06/2026";
    data.dates.issuedAtText = "25/06/2026";
    const html = render(data);
    expect(html).toContain("Calibração");
    expect(html).toContain("Emissão");
    // Both labels present, i.e. the equal date is not collapsed into one row.
    expect(html.match(/25\/06\/2026/g)?.length).toBeGreaterThanOrEqual(2);
  });

  // NIT-DICLA-021 A.6.1 Nota 1: in a TABLE the ± sign is forbidden; U is
  // reported alone. This is the single easiest way to make the document
  // non-conforming while still looking right, so it gets its own test.
  it("never prints ± anywhere in the results tables", () => {
    const html = render(massCertificateFixture());
    const tablesOnly = html.slice(
      html.indexOf("Resultados antes do ajuste"),
      html.indexOf("Incerteza de medição"),
    );
    expect(tablesOnly).not.toContain("±");
    expect(tablesOnly).not.toContain("&plusmn;");
    expect(tablesOnly).not.toContain("+/-");
  });

  it("does not uppercase the coverage factor or the Greek nu", () => {
    // Uppercase K is kelvin, and text-transform turns ν into a capital Nu
    // that reads as a Latin N. Both headers must opt out of the transform.
    const html = render(massCertificateFixture());
    expect(html).toContain('class="num no-caps">k<');
    expect(html).toContain("ν(eff)");
  });

  it("§7.8.2.1(d): always ends with an explicit end-of-document mark", () => {
    expect(render(massCertificateFixture())).toContain("Fim do certificado");
  });

  it("§7.8.2.1(l): always states that results refer only to the calibrated item", () => {
    expect(render(massCertificateFixture())).toContain(
      "referem-se exclusivamente ao item calibrado",
    );
  });

  describe("accreditation seal (NIE-Cgcre-009)", () => {
    it("renders the symbol and the ILAC MRA declaration when accredited", () => {
      const html = body(massCertificateFixture());
      expect(html).toContain("masthead__seal");
      expect(html).toContain("ABNT NBR");
      expect(html).toContain(
        "A Cgcre é signatária do Acordo de Reconhecimento Mútuo da ILAC.",
      );
    });

    it("suppresses the symbol and says so when NOT accredited", () => {
      const data = massCertificateFixture();
      data.accredited = false;
      const html = body(data);
      expect(html).not.toContain("masthead__seal");
      // §11.5.7: a certificate without the symbol must not read as accredited.
      expect(html).toContain("não estão cobertos pela acreditação");
      expect(html).not.toContain(
        "A Cgcre é signatária do Acordo de Reconhecimento Mútuo da ILAC.",
      );
    });

    it("suppresses the symbol when the accreditation number is missing", () => {
      const data = massCertificateFixture();
      data.lab.accreditationNumber = null;
      const html = body(data);
      // The symbol carries the number; without one there is nothing to show.
      expect(html).not.toContain("masthead__seal");
    });
  });

  describe("conditional sections", () => {
    it("§7.8.2.1(n): prints method deviations only when there are any", () => {
      expect(render(massCertificateFixture())).not.toContain(
        "Desvios em relação ao método",
      );

      const data = massCertificateFixture();
      data.methodDeviations = "Ponto de 500 kg não executado.";
      const html = render(data);
      expect(html).toContain("Desvios em relação ao método");
      expect(html).toContain("Ponto de 500 kg não executado.");
    });

    it("§7.8.6.2: prints a conformity statement only when the method declares one", () => {
      expect(render(massCertificateFixture())).not.toContain(
        "Declaração de conformidade",
      );

      const data = massCertificateFixture();
      data.conformity = {
        verdict: "Conforme",
        appliesTo: "Todos os pontos após o ajuste",
        specification: "EMA OIML R 76-1, classe III",
        decisionRule: "Aceitação simples, banda de guarda g = 0 (ILAC-G8)",
      };
      const html = render(data);
      // All three parts the clause requires must appear, not just the verdict.
      expect(html).toContain("Conforme");
      expect(html).toContain("Todos os pontos após o ajuste");
      expect(html).toContain("EMA OIML R 76-1, classe III");
      expect(html).toContain("Aceitação simples");
    });

    it("§7.8.4.1(c): omits the traceability sentence when it cannot be evidenced", () => {
      const data = massCertificateFixture();
      data.traceabilityStatementText = null;
      const html = render(data);
      expect(html).not.toContain("metrologicamente rastreáveis");
      // The standards table still stands on its own.
      expect(html).toContain("Padrões e rastreabilidade");
    });

    // Mass-only blocks. Every other quantity in the catalogue leaves these
    // undefined, so the sections must vanish rather than render empty.
    it("prints repeatability and eccentricity only for methods that produce them", () => {
      const html = render(massCertificateFixture());
      expect(html).toContain("Repetibilidade");
      expect(html).toContain("Excentricidade");
      expect(html).toContain("Leitura 5");
      expect(html).toContain("A (centro)");

      const other = massCertificateFixture();
      other.repeatability = null;
      other.eccentricity = null;
      const bare = render(other);
      expect(bare).not.toContain("Excentricidade");
      expect(bare).not.toContain("Leitura 5");
    });

    it("renders the eccentricity diagram inline, and only once", () => {
      const data = massCertificateFixture();
      if (!data.eccentricity)
        throw new Error("fixture must carry eccentricity");
      data.eccentricity.indicatorSvg =
        '<svg xmlns="http://www.w3.org/2000/svg"><text>Posição do indicador</text></svg>';
      const html = render(data);
      expect(html).toContain("<svg");
      // The generated SVG draws its own caption; the layout must not add a
      // second one underneath it.
      expect(html.match(/Posição do indicador/g)).toHaveLength(1);
    });

    it("omits the diagram when the method declares no indicator", () => {
      const data = massCertificateFixture();
      if (!data.eccentricity)
        throw new Error("fixture must carry eccentricity");
      data.eccentricity.indicatorSvg = null;
      const html = body(data);
      expect(html).toContain("Excentricidade");
      expect(html).not.toContain("ecc__diagram");
    });

    it("keeps section numbering contiguous when sections are skipped", () => {
      const html = render(massCertificateFixture());
      const numbers = [...html.matchAll(/<h2>(\d+)\./g)].map((match) =>
        Number(match[1]),
      );
      expect(numbers.length).toBeGreaterThan(4);
      expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    });
  });

  // The running header is a raw string, not JSX, so React's escaping does not
  // reach it. The certificate number is the org-configurable value in there.
  it("escapes the certificate number in the Gotenberg running header", () => {
    const header = certificateHeaderHtml({
      certificateNumber: '<script>alert("x")</script>',
      accreditationNumberText: "CAL 9999",
    });
    expect(header).not.toContain("<script>");
    expect(header).toContain("&lt;script&gt;");
  });

  it("prints the signatory's handwritten signature when there is one", () => {
    // The data pipeline has always fetched this from member_visual_signature;
    // the layout had nowhere to put it, so every certificate dropped it.
    const data = massCertificateFixture();
    data.signatory.signatureImageDataUrl = "data:image/png;base64,AAAA";
    const html = body(data);
    expect(html).toContain("signature__image");
    expect(html).toContain("data:image/png;base64,AAAA");
  });

  it("still authorises by name when the signatory has no image", () => {
    const html = body(massCertificateFixture());
    expect(html).not.toContain("signature__image");
    // The rule, the name and the role carry the authorisation on their own.
    expect(html).toContain("signature__rule");
    expect(html).toContain("signature__name");
  });

  it("escapes customer-controlled text", () => {
    const data = massCertificateFixture();
    data.customer.name = '<script>alert("xss")</script>';
    data.methodDeviations = "<img src=x onerror=alert(1)>";
    const html = render(data);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
});
