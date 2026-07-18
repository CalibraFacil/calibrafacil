import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { certificateEditorExtensions } from "./extensions.js";
import { validateCertificateDocument } from "./document-schema.js";
import { completeWysiwygDocument } from "./starter-document.js";

const schema = getSchema(certificateEditorExtensions());

/** Splice body blocks in before the trailing bandPageFooter. */
function starterWithBody(extra: Record<string, unknown>[]): Record<string, unknown> {
  const starter = completeWysiwygDocument();
  return {
    ...starter,
    content: [...starter.content.slice(0, -1), ...extra, ...starter.content.slice(-1)],
  };
}

describe("certificateEditorExtensions <-> document-schema round-trip", () => {
  it("the TipTap schema exposes EXACTLY the closed block catalog", () => {
    const nodeNames = Object.keys(schema.nodes).sort();
    expect(nodeNames).toEqual(
      [
        "doc",
        "text",
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "horizontalRule",
        "table",
        "tableRow",
        "tableCell",
        "tableHeader",
        "lockedBlock",
        "placeholder",
        "bandTopIdentity",
        "bandPageFooter",
        "image",
      ].sort(),
    );
    expect(Object.keys(schema.marks).sort()).toEqual(["bold", "italic"].sort());
  });

  it("the doc content expression pins bands first and last", () => {
    expect(schema.nodes.doc?.spec.content).toBe("bandTopIdentity? block+ bandPageFooter?");
  });

  it("starter document round-trips: Zod -> ProseMirror -> toJSON -> Zod", () => {
    const starter = completeWysiwygDocument();
    const pmDoc = schema.nodeFromJSON(starter);
    const roundTripped = pmDoc.toJSON();
    const result = validateCertificateDocument(roundTripped);
    expect(result.ok, JSON.stringify(!result.ok && result.issues, null, 2)).toBe(true);
  });

  it("a richer document (placeholders, lists, tables) also round-trips", () => {
    const richer = starterWithBody([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Cliente: " },
          { type: "placeholder", attrs: { path: "customer.name", label: "Razão social" } },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "item um" }] },
            ],
          },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Campo" }] },
                ],
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
      { type: "image", attrs: { mediaId: 7, alt: "selo interno", widthMm: 40 } },
    ]);
    const zodFirst = validateCertificateDocument(richer);
    expect(zodFirst.ok, JSON.stringify(!zodFirst.ok && zodFirst.issues, null, 2)).toBe(true);
    const roundTripped = schema.nodeFromJSON(richer).toJSON();
    const zodAfter = validateCertificateDocument(roundTripped);
    expect(zodAfter.ok, JSON.stringify(!zodAfter.ok && zodAfter.issues, null, 2)).toBe(true);
  });

  it("band config attrs survive the round-trip", () => {
    const starter: { content: Record<string, unknown>[] } = JSON.parse(
      JSON.stringify(completeWysiwygDocument()),
    );
    const top = starter.content[0];
    if (!top) throw new Error("starter missing top band");
    Reflect.set(top, "attrs", {
      enabled: true,
      showLabName: false,
      showCertificateNumber: true,
      showTitle: true,
      showSealText: false,
    });
    const roundTripped = schema.nodeFromJSON(starter).toJSON();
    const result = validateCertificateDocument(roundTripped);
    expect(result.ok, JSON.stringify(!result.ok && result.issues, null, 2)).toBe(true);
    if (result.ok) {
      const band = result.document.content[0];
      expect(band?.type).toBe("bandTopIdentity");
      if (band?.type === "bandTopIdentity") {
        expect(band.attrs.showTitle).toBe(true);
        expect(band.attrs.showLabName).toBe(false);
      }
    }
  });

  it("marks survive the round-trip and stay within the allowed set", () => {
    const withMarks = starterWithBody([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "negrito", marks: [{ type: "bold" }] },
          { type: "text", text: " e ", marks: [] },
          { type: "text", text: "itálico", marks: [{ type: "italic" }] },
        ],
      },
    ]);
    const roundTripped = schema.nodeFromJSON(withMarks).toJSON();
    const result = validateCertificateDocument(roundTripped);
    expect(result.ok, JSON.stringify(!result.ok && result.issues, null, 2)).toBe(true);
  });
});
