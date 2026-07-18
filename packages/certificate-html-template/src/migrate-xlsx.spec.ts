import { describe, expect, it } from "vitest";

import { buildMigratedDocumentFromXlsxBindings } from "./migrate-xlsx.js";
import { validateCertificateDocument } from "./document-schema.js";

// Exemplo-shaped subset (real manifest: sheet 'Página 1'/'Página 2', see
// docs/epics/wysiwyg/08-real-certificate-calibration.md)
const BINDINGS = [
  { sheet: "Página 2", cell: "U1", fieldPath: "certificate.number" },
  { sheet: "Página 1", cell: "D10", fieldPath: "customer.name" },
  { sheet: "Página 1", cell: "P10", fieldPath: "customer.taxId" },
  { sheet: "Página 1", cell: "L3", fieldPath: "certificate.number" },
  { sheet: "Página 1", cell: "D13", fieldPath: "asset.kind" },
  { sheet: "Página 1", cell: "A25", fieldPath: "standards.0.name" },
];

describe("buildMigratedDocumentFromXlsxBindings (roadmap item 5)", () => {
  it("produces a VALID starter-based document with per-sheet imported sections", () => {
    const { document, importedPaths, skippedPaths } =
      buildMigratedDocumentFromXlsxBindings(BINDINGS);
    expect(validateCertificateDocument(document).ok).toBe(true);
    const text = JSON.stringify(document);
    expect(text).toContain("Importado da planilha — Página 1");
    expect(text).toContain('"path":"customer.name"');
    // dedupe: certificate.number bound twice, imported once (first by order)
    expect(importedPaths.filter((p) => p === "certificate.number")).toHaveLength(1);
    // non-catalog paths are skipped, keeping the doc publishable
    expect(skippedPaths).toContain("standards.0.name");
    expect(text).not.toContain("standards.0.name");
  });

  it("row/col ordering inside a sheet follows the workbook layout", () => {
    const { document } = buildMigratedDocumentFromXlsxBindings(BINDINGS);
    const text = JSON.stringify(document);
    // L3 (row 3) before D10 (row 10) inside Página 1
    expect(text.indexOf('"certificate.number"')).toBeLessThan(
      text.indexOf('"customer.name"'),
    );
  });

  it("no bindings -> plain starter document", () => {
    const { document, importedPaths } = buildMigratedDocumentFromXlsxBindings([]);
    expect(importedPaths).toHaveLength(0);
    expect(validateCertificateDocument(document).ok).toBe(true);
    expect(JSON.stringify(document)).not.toContain("Importado da planilha");
  });
});
