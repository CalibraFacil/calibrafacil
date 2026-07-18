import { describe, expect, it } from "vitest";

import {
  LOCKED_BLOCK_KEYS,
  collectPlaceholderPaths,
  parseCertificateDocument,
  validateCertificateDocument,
} from "./document-schema.js";
import { newWysiwygStarterDocument } from "./starter-document.js";

/**
 * Mutate the starter document's BODY (between the pinned bands): appended
 * blocks land before the trailing bandPageFooter, matching what any editing
 * gesture can actually produce.
 */
function starterWithBlocks(
  mutate: (content: Record<string, unknown>[]) => Record<string, unknown>[],
): unknown {
  const raw: { type: string; content: Record<string, unknown>[] } = JSON.parse(
    JSON.stringify(newWysiwygStarterDocument()),
  );
  const [topBand, ...rest] = raw.content;
  const footerBand = rest.pop();
  if (!topBand || !footerBand) throw new Error("starter must carry both bands");
  return { ...raw, content: [topBand, ...mutate(rest), footerBand] };
}

describe("documentJson upgrades (reframe T20/T26)", () => {
  it("upgrades a v1 document (no attrs) losslessly to v3 defaults", () => {
    const v1: Record<string, unknown> = JSON.parse(
      JSON.stringify(newWysiwygStarterDocument()),
    );
    delete v1.attrs;
    const result = validateCertificateDocument(v1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.attrs.schemaVersion).toBe(3);
      expect(result.document.attrs.theme).toBe("technical-form");
      expect(result.document.content).toEqual(newWysiwygStarterDocument().content);
    }
  });

  it("upgrades a v2 document (no bands) to v3 with default band nodes first/last", () => {
    const v2: { attrs: Record<string, unknown>; content: unknown[] } = JSON.parse(
      JSON.stringify(newWysiwygStarterDocument()),
    );
    v2.attrs = { schemaVersion: 2, theme: "institute-classic" };
    v2.content = v2.content.filter((node) => {
      const type = node && typeof node === "object" ? Reflect.get(node, "type") : "";
      return type !== "bandTopIdentity" && type !== "bandPageFooter";
    });
    const result = validateCertificateDocument(v2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.attrs.schemaVersion).toBe(3);
      expect(result.document.attrs.theme).toBe("institute-classic");
      expect(result.document.content[0]?.type).toBe("bandTopIdentity");
      expect(result.document.content[result.document.content.length - 1]?.type).toBe(
        "bandPageFooter",
      );
    }
  });

  it("converts vestigial v2 pageHeader/pageFooter flow nodes into paragraphs", () => {
    const v2: { attrs: Record<string, unknown>; content: unknown[] } = JSON.parse(
      JSON.stringify(newWysiwygStarterDocument()),
    );
    v2.attrs = { schemaVersion: 2, theme: "technical-form" };
    v2.content = [
      { type: "pageHeader", content: [{ type: "text", text: "Cabeçalho antigo" }] },
      ...v2.content.filter((node) => {
        const type = node && typeof node === "object" ? Reflect.get(node, "type") : "";
        return type !== "bandTopIdentity" && type !== "bandPageFooter";
      }),
      { type: "pageFooter", content: [{ type: "text", text: "Rodapé antigo" }] },
    ];
    const result = validateCertificateDocument(v2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paragraphTexts = result.document.content
        .filter((node) => node.type === "paragraph")
        .map((node) => JSON.stringify(node.content ?? []));
      expect(paragraphTexts.some((text) => text.includes("Cabeçalho antigo"))).toBe(true);
      expect(paragraphTexts.some((text) => text.includes("Rodapé antigo"))).toBe(true);
    }
  });

  it("rejects an unknown theme", () => {
    const doc: Record<string, unknown> = JSON.parse(
      JSON.stringify(newWysiwygStarterDocument()),
    );
    doc.attrs = { schemaVersion: 2, theme: "vaporwave" };
    expect(validateCertificateDocument(doc).ok).toBe(false);
  });

  it("accepts and preserves a block layout envelope; rejects unknown layout keys", () => {
    const doc: { content: Record<string, unknown>[] } = JSON.parse(
      JSON.stringify(newWysiwygStarterDocument()),
    );
    const customer = doc.content.find(
      (block) =>
        Reflect.get(Reflect.get(block, "attrs") ?? {}, "blockKey") ===
        "customer_identification",
    );
    expect(customer).toBeDefined();
    if (!customer) return;
    Reflect.set(Reflect.get(customer, "attrs") ?? {}, "layout", {
      columns: 2,
      density: "compact",
    });
    const ok = validateCertificateDocument(doc);
    expect(ok.ok).toBe(true);

    Reflect.set(Reflect.get(customer, "attrs") ?? {}, "layout", { fontSize: 30 });
    expect(validateCertificateDocument(doc).ok).toBe(false);
  });
});

describe("certificateDocumentSchema", () => {
  it("accepts the starter document with every mandatory block exactly once", () => {
    const document = newWysiwygStarterDocument();
    const lockedKeys = document.content
      .filter((block) => block.type === "lockedBlock")
      .map((block) => (block.type === "lockedBlock" ? block.attrs.blockKey : ""));
    expect([...lockedKeys].sort()).toEqual([...LOCKED_BLOCK_KEYS].sort());
  });

  it("rejects an unknown block type (closed catalog)", () => {
    const result = validateCertificateDocument(
      starterWithBlocks((content) => [...content, { type: "htmlBlock", html: "<b>x</b>" }]),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a document missing a mandatory locked block, naming the key", () => {
    const result = validateCertificateDocument(
      starterWithBlocks((content) =>
        content.filter(
          (block) =>
            !(
              block.type === "lockedBlock" &&
              typeof block.attrs === "object" &&
              block.attrs !== null &&
              Reflect.get(block.attrs, "blockKey") === "results_table"
            ),
        ),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes('"results_table"'))).toBe(true);
      expect(result.issues.some((i) => i.message.includes("found 0"))).toBe(true);
    }
  });

  it("rejects a duplicated locked block", () => {
    const result = validateCertificateDocument(
      starterWithBlocks((content) => [
        ...content,
        { type: "lockedBlock", attrs: { blockKey: "results_table" } },
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes("found 2"))).toBe(true);
    }
  });

  it("rejects an unknown locked blockKey", () => {
    const result = validateCertificateDocument(
      starterWithBlocks((content) => [
        ...content,
        { type: "lockedBlock", attrs: { blockKey: "my_custom_block" } },
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects banned placeholder paths (§7.8.4.3) at any depth", () => {
    for (const banned of ["asset.nextCalibrationDate", "asset.calibrationIntervalMonths"]) {
      const result = validateCertificateDocument(
        starterWithBlocks((content) => [
          ...content,
          {
            type: "paragraph",
            content: [{ type: "placeholder", attrs: { path: banned } }],
          },
        ]),
      );
      expect(result.ok, banned).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((i) => i.message.includes("7.8.4.3"))).toBe(true);
      }
    }
  });

  it("accepts valid placeholders and collects their paths", () => {
    const document = parseCertificateDocument(
      starterWithBlocks((content) => [
        ...content,
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Cliente: " },
            { type: "placeholder", attrs: { path: "customer.name", label: "Razão social" } },
            { type: "text", text: " — U = " },
            { type: "placeholder", attrs: { path: "uncertainty.expanded" } },
          ],
        },
      ]),
    );
    expect(collectPlaceholderPaths(document)).toEqual([
      "customer.name",
      "uncertainty.expanded",
    ]);
  });

  it("accepts bounded merged cells in authored tables (M-C); rejects absurd spans", () => {
    const tableWith = (colspan: number, rowspan: number) => ({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { colspan, rowspan, colwidth: null },
              content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
            },
          ],
        },
      ],
    });
    expect(
      validateCertificateDocument(
        starterWithBlocks((content) => [...content, tableWith(2, 3)]),
      ).ok,
    ).toBe(true);
    expect(
      validateCertificateDocument(
        starterWithBlocks((content) => [...content, tableWith(50, 1)]),
      ).ok,
    ).toBe(false);
    expect(
      validateCertificateDocument(
        starterWithBlocks((content) => [...content, tableWith(1, 99)]),
      ).ok,
    ).toBe(false);
  });

  it("accepts a plain authored table and collects placeholders inside cells", () => {
    const document = parseCertificateDocument(
      starterWithBlocks((content) => [
        ...content,
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Campo" }] }],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "placeholder", attrs: { path: "asset.tag" } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(collectPlaceholderPaths(document)).toContain("asset.tag");
  });

  it("rejects vestigial pageHeader nodes inside v3 documents (closed catalog)", () => {
    const header = {
      type: "pageHeader",
      content: [{ type: "text", text: "Cabeçalho" }],
    };
    const result = validateCertificateDocument(
      starterWithBlocks((content) => [header, ...content]),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a duplicated band and a band out of position", () => {
    const duplicated = validateCertificateDocument(
      starterWithBlocks((content) => [
        ...content,
        {
          type: "bandTopIdentity",
          attrs: {
            enabled: true,
            showLabName: true,
            showCertificateNumber: true,
            showTitle: false,
            showSealText: true,
          },
        },
      ]),
    );
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) {
      expect(duplicated.issues.some((i) => i.message.includes("bandTopIdentity"))).toBe(true);
    }

    const raw: { content: unknown[] } = JSON.parse(
      JSON.stringify(newWysiwygStarterDocument()),
    );
    // Move the footer band away from the last position.
    const footer = raw.content.pop();
    raw.content.splice(1, 0, footer);
    const outOfPosition = validateCertificateDocument(raw);
    expect(outOfPosition.ok).toBe(false);
    if (!outOfPosition.ok) {
      expect(
        outOfPosition.issues.some((i) => i.message.includes("bandPageFooter")),
      ).toBe(true);
    }
  });

  it("rejects images with raw src instead of org mediaId", () => {
    const result = validateCertificateDocument(
      starterWithBlocks((content) => [
        ...content,
        { type: "image", attrs: { src: "https://evil.example/x.png" } },
      ]),
    );
    expect(result.ok).toBe(false);
  });
});

describe("styleTokens doc attr (roadmap item 7)", () => {
  function starterWithStyleTokens(styleTokens: unknown) {
    const document: Record<string, unknown> = JSON.parse(
      JSON.stringify(newWysiwygStarterDocument()),
    );
    const attrs = document.attrs;
    if (attrs && typeof attrs === "object") {
      document.attrs = { ...attrs, styleTokens };
    }
    return document;
  }

  it("accepts curated accent + fontScale", () => {
    const result = validateCertificateDocument(
      starterWithStyleTokens({ accent: "#7A1F1F", fontScale: 0.9 }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts null / absent styleTokens (additive attr)", () => {
    expect(validateCertificateDocument(starterWithStyleTokens(null)).ok).toBe(true);
    expect(validateCertificateDocument(newWysiwygStarterDocument()).ok).toBe(true);
  });

  it("rejects a non-hex accent (no raw CSS smuggling)", () => {
    for (const accent of ["red", "#12345", "#GGGGGG", "url(x)", "#123456;color:red"]) {
      const result = validateCertificateDocument(starterWithStyleTokens({ accent }));
      expect(result.ok, accent).toBe(false);
    }
  });

  it("rejects a fontScale outside the curated steps and unknown token keys", () => {
    expect(validateCertificateDocument(starterWithStyleTokens({ fontScale: 0.5 })).ok).toBe(false);
    expect(validateCertificateDocument(starterWithStyleTokens({ fontFamily: "Comic Sans" })).ok).toBe(false);
  });
});

describe("bilingual doc attr (roadmap item 8)", () => {
  it("accepts true/false/null and rejects non-boolean values", () => {
    const base = JSON.parse(JSON.stringify(newWysiwygStarterDocument()));
    for (const value of [true, false, null]) {
      const result = validateCertificateDocument({
        ...base,
        attrs: { ...base.attrs, bilingual: value },
      });
      expect(result.ok, String(value)).toBe(true);
    }
    const bad = validateCertificateDocument({
      ...base,
      attrs: { ...base.attrs, bilingual: "yes" },
    });
    expect(bad.ok).toBe(false);
  });
});
