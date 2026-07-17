import { describe, expect, it } from "vitest";

import { UnknownPlaceholderError, MissingRequiredPlaceholderError } from "./catalog.js";
import { CertificateRenderDataError } from "./blocks.js";
import {
  CertificateDocumentInvalidError,
  CertificateImageUnresolvedError,
  compileCertificateHtml,
  validateCertificateTemplateDocument,
} from "./compile.js";
import { sampleCertificateInputData } from "./fixtures/sample-input-data.js";
import { newWysiwygStarterDocument } from "./starter-document.js";
import { CERT_HTML_COMPILER_VERSION } from "./version.js";

// Deep-clone with a deliberately loose type: specs mutate nested fixture data
// to simulate broken/hostile inputs, which Record<string, unknown> forbids.
type LooseData = { [key: string]: any };
const clone = (value: unknown): LooseData => JSON.parse(JSON.stringify(value));

function starterPlus(blocks: Record<string, unknown>[]): Record<string, unknown> {
  const starter = clone(newWysiwygStarterDocument());
  // Body blocks land before the trailing bandPageFooter (pinned last).
  return {
    ...starter,
    content: [...starter.content.slice(0, -1), ...blocks, ...starter.content.slice(-1)],
  };
}

describe("compileCertificateHtml", () => {
  it("compiles the starter document against the sample data (full-document snapshot)", async () => {
    const compiled = await compileCertificateHtml(
      newWysiwygStarterDocument(),
      sampleCertificateInputData,
    );
    expect(compiled.compilerVersion).toBe(CERT_HTML_COMPILER_VERSION);
    expect(compiled.html).toMatchSnapshot();
  });

  it("themes: institute-classic compiles with serif body + theme class; technical-form is default", async () => {
    const classic = clone(newWysiwygStarterDocument())
    classic.attrs.theme = "institute-classic"
    const compiled = await compileCertificateHtml(classic, sampleCertificateInputData)
    expect(compiled.html).toContain("cf-theme-institute-classic")
    expect(compiled.html).toContain("Source Serif 4")
    expect(compiled.html).not.toContain("Source Sans 3")

    const standard = await compileCertificateHtml(
      newWysiwygStarterDocument(),
      sampleCertificateInputData,
    )
    expect(standard.html).toContain("cf-theme-technical-form")
    expect(standard.html).toContain("Source Sans 3")
  })

  it("is deterministic: 10 compiles, one sha256", async () => {
    const hashes = new Set<string>();
    for (let index = 0; index < 10; index += 1) {
      const compiled = await compileCertificateHtml(
        clone(newWysiwygStarterDocument()),
        clone(sampleCertificateInputData),
      );
      hashes.add(compiled.sha256);
    }
    expect(hashes.size).toBe(1);
  });

  it("renders every locked block with its data-locked-block anchor", async () => {
    const { html } = await compileCertificateHtml(
      newWysiwygStarterDocument(),
      sampleCertificateInputData,
    );
    for (const key of [
      "certificate_identification",
      "lab_identification",
      "customer_identification",
      "item_identification",
      "method_traceability",
      "environmental_conditions",
      "results_table",
      "uncertainty_statement",
      "signature_block",
      "accreditation_seal",
      "verification_qr",
      "end_of_document",
    ]) {
      expect(html).toContain(`data-locked-block="${key}"`);
    }
  });

  it("results table honors includeInCertificate and group filtering", async () => {
    const { html } = await compileCertificateHtml(
      newWysiwygStarterDocument(),
      sampleCertificateInputData,
    );
    expect(html).toContain("Erro de indicação (10 kg)");
    expect(html).toContain("0,0001 kg");
    // uncertainty_budget row is excluded from the results table
    expect(html).not.toContain("Incerteza do padrão");
  });

  it("results table fails loud when neither grids nor scalar rows are certifiable", async () => {
    const data = clone(sampleCertificateInputData);
    data.resultRows = data.resultRows.map((row: LooseData) => ({
      ...row,
      includeInCertificate: false,
    }));
    // remove the multi-point table too — no grids AND no scalar rows
    data.methodSnapshot = { dataFields: [], formulas: [] };
    await expect(
      compileCertificateHtml(newWysiwygStarterDocument(), data),
    ).rejects.toThrow(CertificateRenderDataError);
  });

  it("multi-point grid renders DOQ-shape: two-row unit header, phase order, no ±", async () => {
    const { html } = await compileCertificateHtml(
      newWysiwygStarterDocument(),
      sampleCertificateInputData,
    );
    expect(html).toContain("Carga nominal");
    expect(html).toContain("Indicação como recebido");
    expect(html).toContain('class="cf-unit-row"');
    expect(html).toContain("[kg]");
    expect(html).toContain("1.499,5");
    expect(html).not.toContain("±");
    // excluded internal formula never renders
    expect(html).not.toContain("debug_interno");
  });

  it("metadata layout presets: columns + density classes land on the block section", async () => {
    const doc = clone(newWysiwygStarterDocument());
    const customer = doc.content.find(
      (block: LooseData) => block.attrs?.blockKey === "customer_identification",
    );
    customer.attrs.layout = { columns: 2, density: "compact" };
    const { html } = await compileCertificateHtml(doc, sampleCertificateInputData);
    expect(html).toMatch(
      /data-locked-block="customer_identification" class="cf-locked-block cf-layout-cols-2 cf-layout-compact"/,
    );
  });

  it("template hiddenColumns + borders override apply via the block layout envelope", async () => {
    const doc = clone(newWysiwygStarterDocument());
    const resultsBlock = doc.content.find(
      (block: LooseData) => block.attrs?.blockKey === "results_table",
    );
    resultsBlock.attrs.layout = {
      hiddenColumns: ["leitura_antes"],
      borders: "rules",
    };
    const { html } = await compileCertificateHtml(doc, sampleCertificateInputData);
    expect(html).not.toContain("Indicação como recebido");
    expect(html).toContain('class="cf-borders-rules"');
  });

  it("uncertainty statement carries U and k; fails loud when they are missing", async () => {
    const { html } = await compileCertificateHtml(
      newWysiwygStarterDocument(),
      sampleCertificateInputData,
    );
    expect(html).toContain("U = 0,0004 kg");
    expect(html).toContain("k = 2");

    const data = clone(sampleCertificateInputData);
    data.uncertainty = { expanded: null, coverageFactor: null, budget: [] };
    await expect(
      compileCertificateHtml(newWysiwygStarterDocument(), data),
    ).rejects.toThrow(CertificateRenderDataError);
  });

  it("accreditation seal renders only when accredited; box is layout-stable", async () => {
    const accredited = await compileCertificateHtml(
      newWysiwygStarterDocument(),
      {
        ...clone(sampleCertificateInputData),
        lab: {
          ...clone(sampleCertificateInputData).lab,
          accreditationSealPng: "data:image/png;base64,AAAA",
        },
      },
    );
    expect(accredited.html).toContain('alt="Selo de acreditação"');

    const data = clone(sampleCertificateInputData);
    data.accreditation.accredited = false;
    data.lab.accreditationSealPng = null;
    const notAccredited = await compileCertificateHtml(newWysiwygStarterDocument(), data);
    expect(notAccredited.html).not.toContain('alt="Selo de acreditação"');
    expect(notAccredited.html).toContain('class="cf-accreditation-seal"');
  });

  it("lab logo renders as letterhead when the worker resolved it; absent -> no img", async () => {
    const withLogo = clone(sampleCertificateInputData)
    withLogo.lab.logoDataUrl = "data:image/png;base64,AAAA"
    const { html } = await compileCertificateHtml(newWysiwygStarterDocument(), withLogo)
    expect(html).toContain('class="cf-lab-logo"')
    expect(html).toContain('src="data:image/png;base64,AAAA"')

    const withoutLogo = await compileCertificateHtml(
      newWysiwygStarterDocument(),
      sampleCertificateInputData,
    )
    // the print CSS always carries the .cf-lab-logo selector; assert on the ELEMENT
    expect(withoutLogo.html).not.toContain('class="cf-lab-logo"')
  })

  it("inline placeholders resolve with formatting", async () => {
    const document = starterPlus([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "CNPJ do cliente: " },
          { type: "placeholder", attrs: { path: "customer.taxId" } },
        ],
      },
    ]);
    const { html } = await compileCertificateHtml(document, sampleCertificateInputData);
    expect(html).toContain("CNPJ do cliente: ");
    expect(html).toContain("98.765.432/0001-10");
  });

  it("throws CertificateDocumentInvalidError for a structurally invalid document", async () => {
    const starter = clone(newWysiwygStarterDocument());
    starter.content = starter.content.filter(
      (block: LooseData) => block.attrs?.blockKey !== "results_table",
    );
    await expect(
      compileCertificateHtml(starter, sampleCertificateInputData),
    ).rejects.toThrow(CertificateDocumentInvalidError);
  });

  it("throws UnknownPlaceholderError for uncataloged placeholders", async () => {
    const document = starterPlus([
      {
        type: "paragraph",
        content: [{ type: "placeholder", attrs: { path: "made.up" } }],
      },
    ]);
    await expect(
      compileCertificateHtml(document, sampleCertificateInputData),
    ).rejects.toThrow(UnknownPlaceholderError);
  });

  it("throws MissingRequiredPlaceholderError when required data is absent (fail-loud)", async () => {
    const data = clone(sampleCertificateInputData);
    delete data.approval.approvedBy.name;
    await expect(
      compileCertificateHtml(newWysiwygStarterDocument(), data),
    ).rejects.toThrow(MissingRequiredPlaceholderError);
  });

  it("escapes hostile data — no markup injection through customer fields", async () => {
    const data = clone(sampleCertificateInputData);
    data.customer.name = `<script>alert("xss")</script> & Cia`;
    const { html } = await compileCertificateHtml(newWysiwygStarterDocument(), data);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; Cia");
  });

  it("images require caller-resolved mediaUrls; unresolved id is fail-loud", async () => {
    const document = starterPlus([
      { type: "image", attrs: { mediaId: 7, alt: "selo interno", widthMm: 40 } },
    ]);
    await expect(
      compileCertificateHtml(document, sampleCertificateInputData),
    ).rejects.toThrow(CertificateImageUnresolvedError);

    const { html } = await compileCertificateHtml(document, sampleCertificateInputData, {
      mediaUrls: { 7: "https://media.example/org/7.png" },
    });
    expect(html).toContain('src="https://media.example/org/7.png"');
    expect(html).toContain("width:40mm");
  });
});

describe("validateCertificateTemplateDocument", () => {
  it("accepts the starter document", () => {
    expect(validateCertificateTemplateDocument(newWysiwygStarterDocument()).ok).toBe(true);
  });

  it("reports unknown placeholder paths as issues (no throw)", () => {
    const document = starterPlus([
      {
        type: "paragraph",
        content: [{ type: "placeholder", attrs: { path: "nope.nope" } }],
      },
    ]);
    const result = validateCertificateTemplateDocument(document);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toContain("nope.nope");
    }
  });
});
