import { describe, expect, it } from "vitest";

import {
  LOCKED_BLOCK_KEYS,
  collectPlaceholderPaths,
  parseCertificateDocument,
  validateCertificateDocument,
} from "./document-schema.js";
import { newWysiwygStarterDocument } from "./starter-document.js";

function starterWithBlocks(
  mutate: (content: Record<string, unknown>[]) => Record<string, unknown>[],
): unknown {
  const raw: { type: string; content: Record<string, unknown>[] } = JSON.parse(
    JSON.stringify(newWysiwygStarterDocument()),
  );
  return { ...raw, content: mutate(raw.content) };
}

describe("documentJson v2 (reframe T20)", () => {
  it("upgrades a v1 document (no attrs) losslessly to v2 defaults", () => {
    const v1: Record<string, unknown> = JSON.parse(
      JSON.stringify(newWysiwygStarterDocument()),
    );
    delete v1.attrs;
    const result = validateCertificateDocument(v1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.attrs.schemaVersion).toBe(2);
      expect(result.document.attrs.theme).toBe("technical-form");
      expect(result.document.content).toEqual(newWysiwygStarterDocument().content);
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

  it("rejects merged cells in authored tables (v1)", () => {
    const result = validateCertificateDocument(
      starterWithBlocks((content) => [
        ...content,
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 2, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(result.ok).toBe(false);
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

  it("rejects more than one pageHeader", () => {
    const header = {
      type: "pageHeader",
      content: [{ type: "text", text: "Cabeçalho" }],
    };
    const result = validateCertificateDocument(
      starterWithBlocks((content) => [header, { ...header }, ...content]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes("pageHeader"))).toBe(true);
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
