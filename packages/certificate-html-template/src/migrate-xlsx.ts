import {
  type CertificateDocument,
  parseCertificateDocument,
} from "./document-schema.js";
import { getPlaceholderEntry } from "./catalog.js";
import { newWysiwygStarterDocument } from "./starter-document.js";

/**
 * XLSX -> wysiwyg migration (roadmap item 5): turn a template's binding
 * manifest into a starter-based document the admin can prune. Every locked
 * block is present (the starter guarantees §7.8.2.1); each xlsx sheet becomes
 * an "Importado da planilha" section listing its bound fields as TYPED
 * placeholders — only CATALOG-KNOWN paths are imported, so the generated
 * document always validates and publishes.
 */

export type XlsxScalarBindingRef = {
  sheet: string;
  cell: string;
  fieldPath: string;
};

function cellOrder(cell: string): { row: number; col: string } {
  const match = /^([A-Z]+)(\d+)$/.exec(cell.toUpperCase());
  if (!match || !match[1] || !match[2]) {
    return { row: Number.MAX_SAFE_INTEGER, col: cell };
  }
  return { row: Number(match[2]), col: match[1].padStart(3, "0") };
}

export function buildMigratedDocumentFromXlsxBindings(
  bindings: readonly XlsxScalarBindingRef[],
): { document: CertificateDocument; importedPaths: string[]; skippedPaths: string[] } {
  const starter = newWysiwygStarterDocument();

  // catalog-known, deduped, ordered by sheet then row/col
  const seen = new Set<string>();
  const importedPaths: string[] = [];
  const skippedPaths: string[] = [];
  const bySheet = new Map<string, { path: string; label: string }[]>();

  const sorted = [...bindings].sort((left, right) => {
    if (left.sheet !== right.sheet) return left.sheet.localeCompare(right.sheet);
    const a = cellOrder(left.cell);
    const b = cellOrder(right.cell);
    return a.row !== b.row ? a.row - b.row : a.col.localeCompare(b.col);
  });

  for (const binding of sorted) {
    if (seen.has(binding.fieldPath)) continue;
    seen.add(binding.fieldPath);
    const entry = getPlaceholderEntry(binding.fieldPath);
    if (!entry) {
      skippedPaths.push(binding.fieldPath);
      continue;
    }
    importedPaths.push(binding.fieldPath);
    const bucket = bySheet.get(binding.sheet) ?? [];
    bucket.push({ path: entry.path, label: entry.label });
    bySheet.set(binding.sheet, bucket);
  }

  const sections: Record<string, unknown>[] = [];
  for (const [sheet, entries] of bySheet) {
    if (entries.length === 0) continue;
    sections.push({
      type: "heading",
      attrs: { level: 2 },
      content: [
        { type: "text", text: `Importado da planilha — ${sheet}` },
      ],
    });
    for (const entry of entries) {
      sections.push({
        type: "paragraph",
        content: [
          { type: "text", text: `${entry.label}: ` },
          {
            type: "placeholder",
            attrs: { path: entry.path, label: entry.label },
          },
        ],
      });
    }
  }

  // body sections land before the trailing bandPageFooter (pinned last)
  const document = parseCertificateDocument({
    ...starter,
    content: [
      ...starter.content.slice(0, -1),
      ...sections,
      ...starter.content.slice(-1),
    ],
  });

  return { document, importedPaths, skippedPaths };
}
