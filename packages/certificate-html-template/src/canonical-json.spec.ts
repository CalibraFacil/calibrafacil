import { describe, expect, it } from "vitest";

import {
  canonicalJsonStringify,
  hashCertificateDocument,
} from "./canonical-json.js";
import { newWysiwygStarterDocument } from "./starter-document.js";

describe("canonicalJsonStringify", () => {
  it("is independent of object key insertion order", () => {
    const a = { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "left" } }] };
    const b = { content: [{ attrs: { textAlign: "left" }, type: "paragraph" }], type: "doc" };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
    expect(hashCertificateDocument(a)).toBe(hashCertificateDocument(b));
  });

  it("preserves array order (order IS meaning for document blocks)", () => {
    expect(canonicalJsonStringify([1, 2])).not.toBe(canonicalJsonStringify([2, 1]));
  });

  it("omits undefined object entries and nullifies undefined array slots", () => {
    expect(canonicalJsonStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJsonStringify([1, undefined])).toBe("[1,null]");
  });

  it("throws on non-finite numbers instead of silently coercing", () => {
    expect(() => canonicalJsonStringify({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJsonStringify({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });

  it("hashes the starter document stably (64-hex sha256)", () => {
    const first = hashCertificateDocument(newWysiwygStarterDocument());
    const second = hashCertificateDocument(
      JSON.parse(JSON.stringify(newWysiwygStarterDocument())),
    );
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
  });

  it("produces different hashes for different documents", () => {
    const doc = newWysiwygStarterDocument();
    const edited = JSON.parse(JSON.stringify(doc));
    // content[0] is the top identity band; content[2] is the H1 title.
    edited.content[2].content[0].text = "Certificado de Ensaio";
    expect(hashCertificateDocument(doc)).not.toBe(hashCertificateDocument(edited));
  });
});
