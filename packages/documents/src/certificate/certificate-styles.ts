/**
 * Print CSS for the fixed calibration certificate.
 *
 * Every rule here traces to the survey of real accredited certificates in
 * docs/referencias/certificados-internacionais/README.md — UKAS LAB 5 ed. 5,
 * a DAkkS certificate, a COFRAC certificate and a Brazilian RBC certificate.
 * The short version: this is a DOCUMENT, not an interface. Monochrome with
 * hairlines, no semantic colour, no icons, no cards, no status pills. Colour
 * appears only in the lab's own logo and the accreditation symbol.
 *
 * Typography is measured, not assumed — see
 * docs/referencias/certificados-internacionais/tipografia-gotenberg.md.
 * The Gotenberg Chromium container ships Liberation Serif (regular/bold/
 * italic), Liberation Sans (regular/bold) and Liberation Mono, all embedded
 * and subsetted into the PDF automatically, so nothing is @font-face'd and no
 * font bytes live in the repo. The generic aliases resolve the same way in the
 * operator's browser, so preview and PDF agree.
 */

const INK = "#111111";
const MUTED = "#4a4a4a";
const FAINT = "#6b6b6b";
const RULE = "#111111";
const HAIRLINE = "#b8b8b8";
const HEADER_FILL = "#eeeeee";

export const CERTIFICATE_PAGE_STYLES = `
  @page {
    size: A4;
    /* Room at the top for the running header Gotenberg injects on
       continuation pages, and at the foot for "Página X de Y". */
    margin: 16mm 15mm 16mm 15mm;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: ${INK};
    /* Liberation Sans for running text, as the German, French and Brazilian
       certificates all do. The serif is reserved for the display title. */
    font-family: Arial, "Liberation Sans", Helvetica, sans-serif;
    font-size: 8.4pt;
    line-height: 1.22;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── masthead (first page only) ─────────────────────────────────────── */
  .masthead {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10mm;
    padding-bottom: 2mm;
    border-bottom: 1.2pt solid ${RULE};
  }
  .masthead__logo { max-height: 18mm; max-width: 52mm; object-fit: contain; }
  .masthead__lab { flex: 1; min-width: 0; }
  .masthead__name {
    font-family: "Liberation Serif", "Times New Roman", Times, serif;
    font-size: 13pt;
    font-weight: 700;
    line-height: 1.15;
    margin: 0 0 1mm;
  }
  .masthead__meta { color: ${MUTED}; font-size: 7.6pt; line-height: 1.45; }
  .masthead__seal { flex: 0 0 auto; text-align: center; }
  .masthead__seal svg { display: block; width: 20mm; height: auto; }

  /* ── title ───────────────────────────────────────────────────────────
     Serif, caps, centred — the UKAS Fig. 1 and COFRAC convention. The
     number sits under the title, as on the Brazilian RBC certificate. */
  .title-block { text-align: center; margin: 4mm 0 3.5mm; }
  .title {
    font-family: "Liberation Serif", "Times New Roman", Times, serif;
    font-size: 15pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: 0;
  }
  .title__number {
    font-family: "Liberation Mono", "Courier New", monospace;
    font-size: 10pt;
    font-weight: 700;
    margin-top: 0.8mm;
    letter-spacing: 0.04em;
  }
  .title__pages { color: ${FAINT}; font-size: 7.4pt; margin-top: 1mm; }

  /* ── numbered sections ───────────────────────────────────────────────
     Numbered like the Brazilian RBC certificate, but set in black over a
     rule — the numbering was never the problem with the earlier attempt,
     the brand-blue eyebrow styling was. */
  .section { margin-top: 2.6mm; }
  .section > h2 {
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 0.01em;
    margin: 0 0 1.2mm;
    padding: 0.7mm 1.6mm;
    background: ${HEADER_FILL};
    border-bottom: 0.6pt solid ${RULE};
    break-after: avoid;
  }
  .section--keep { break-inside: avoid; }

  /* ── label:value grid ────────────────────────────────────────────────
     Framed blocks, not cards: hairline rules, no shadow, no radius. */
  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 6mm;
    row-gap: 0.5mm;
    padding: 0 1.6mm;
  }
  .fields--single { grid-template-columns: minmax(0, 1fr); }
  .field { display: flex; gap: 1.5mm; align-items: baseline; min-width: 0; }
  .field__label {
    flex: 0 0 27mm;
    color: ${INK};
    font-size: 8pt;
    font-weight: 700;
  }
  .field__value { flex: 1; min-width: 0; }
  .field__value--mono {
    font-family: "Liberation Mono", "Courier New", monospace;
    font-size: 8pt;
  }
  .field--wide { grid-column: 1 / -1; }

  /* ── tables ──────────────────────────────────────────────────────────
     Full grid with a light header fill and no zebra — the DAkkS and RBC
     convention. Units are factored into the header, never repeated per
     cell. Numerics are mono and right-aligned so decimals line up. */
  table { width: 100%; border-collapse: collapse; margin-top: 1mm; }
  thead { display: table-header-group; }
  tbody tr { break-inside: avoid; }
  th, td {
    border: 0.5pt solid ${HAIRLINE};
    padding: 0.8mm 1.6mm;
    text-align: left;
    vertical-align: middle;
  }
  th {
    background: ${HEADER_FILL};
    font-size: 7.2pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  /* Symbols must not be uppercased: the coverage factor is lowercase k
     (uppercase K is kelvin) and ν is a Greek nu, which text-transform turns
     into a capital Nu that reads as a Latin N. */
  th.no-caps { text-transform: none; letter-spacing: 0; }
  th .unit { display: block; font-weight: 400; text-transform: none; letter-spacing: 0; color: ${MUTED}; }
  td.num, th.num { text-align: right; }
  td.num {
    font-family: "Liberation Mono", "Courier New", monospace;
    font-variant-numeric: tabular-nums;
  }
  /* Eccentricity: table left, platform diagram right — the FOR 51 layout. */
  .ecc { display: flex; gap: 5mm; align-items: flex-start; }
  .ecc__table { flex: 1; min-width: 0; }
  /* The generated diagram is a 170×100 viewBox, so it needs real width to be
     legible at print size; at 34mm it was ~20mm tall and unreadable. */
  .ecc__diagram { flex: 0 0 48mm; margin-top: 1mm; }
  .ecc__diagram svg { width: 100%; height: auto; }

  .table-note { color: ${MUTED}; font-size: 7.2pt; margin-top: 1.2mm; }

  /* ── prose blocks ────────────────────────────────────────────────────── */
  .prose { margin: 0; }
  .prose + .prose { margin-top: 1.5mm; }
  .callout {
    border: 0.5pt solid ${HAIRLINE};
    padding: 2mm 2.4mm;
    margin-top: 1.5mm;
  }
  .callout__label {
    font-size: 7.2pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: ${MUTED};
    margin-bottom: 0.8mm;
  }

  /* ── signature ───────────────────────────────────────────────────────
     Handwritten signature (when the signatory has uploaded one) over a rule,
     with the name and role beneath. The first cut of this layout omitted the
     image, reasoning that the German and French certificates authorise by name
     alone and the file carries a PAdES signature anyway. That is true of those
     two and false here: the Brazilian RBC certificate surveyed and Exemplo's own
     legacy document both show one, and it is what laboratories expect. The
     name and role still stand on their own when there is no image.

     The image sits ON the rule (negative margin) rather than above it, so a
     missing signature does not leave a gap where one used to be. */
  .signature { margin-top: 8mm; break-inside: avoid; text-align: center; }
  .signature__place { color: ${MUTED}; margin-bottom: 7mm; }
  .signature__image {
    display: block;
    max-height: 16mm;
    max-width: 60mm;
    margin: 0 auto -1mm;
    object-fit: contain;
  }
  .signature__rule {
    width: 72mm;
    margin: 0 auto 1.2mm;
    border-top: 0.6pt solid ${RULE};
  }
  .signature__name { font-weight: 700; }
  .signature__role { color: ${MUTED}; font-size: 7.6pt; }

  /* ── standing declarations + end mark ────────────────────────────────── */
  /* ── verification (identity page) ─────────────────────────────────────
     Fills the lower area of the identity page with something load-bearing
     rather than leaving it accidentally blank: the public verification route
     (#431), which is how a reader confirms the document is genuine. */
  .verify {
    margin-top: 5mm;
    padding-top: 2.5mm;
    border-top: 0.5pt solid ${HAIRLINE};
    display: flex;
    align-items: center;
    gap: 5mm;
    break-inside: avoid;
  }
  .verify__qr { flex: 0 0 auto; width: 22mm; height: 22mm; }
  .verify__body { flex: 1; min-width: 0; }
  .verify__label {
    font-size: 7.2pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    margin-bottom: 0.8mm;
  }
  .verify__hint { color: ${MUTED}; font-size: 7.4pt; margin: 0 0 1mm; }
  .verify__url {
    font-family: "Liberation Mono", "Courier New", monospace;
    font-size: 7.6pt;
    word-break: break-all;
  }

  .declarations {
    margin-top: 6mm;
    padding-top: 2mm;
    border-top: 0.5pt solid ${HAIRLINE};
    color: ${MUTED};
    font-size: 7pt;
    line-height: 1.4;
    break-inside: avoid;
  }
  .declarations ul { margin: 0; padding: 0; list-style: none; }
  .declarations li { margin-bottom: 0.7mm; padding-left: 3.5mm; text-indent: -3.5mm; }
  .declarations li::before { content: "— "; }

  .provenance {
    margin-top: 2mm;
    color: ${FAINT};
    font-size: 6.4pt;
    font-family: "Liberation Mono", "Courier New", monospace;
    word-break: break-all;
  }

  /* §7.8.2.1(d) — "a clear identification of the end". Every surveyed
     certificate states its own extent; this is the explicit terminator. */
  .end-mark {
    margin-top: 5mm;
    padding-top: 1.5mm;
    border-top: 1.2pt solid ${RULE};
    text-align: center;
    font-size: 7.2pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    break-inside: avoid;
  }

  .page-break { break-before: page; }
`;

/**
 * Running header for continuation pages, injected by Gotenberg as an isolated
 * mini-document. It carries the NIE-Cgcre-009 §11.5.2 sentence — the norm's
 * own wording for pages after the first, where the symbol may be replaced by
 * text — plus the certificate number, so a detached sheet is still
 * identifiable (§7.8.2.1 d).
 *
 * Gotenberg header/footer templates get no page CSS and no @font-face, so
 * every style is inline and the font is a generic family.
 *
 * CAVEAT for whoever wires this in Phase 3: Chromium renders headerTemplate on
 * EVERY page, page one included — there is no first-page opt-out. So the §11.5.2
 * text form will also sit above the masthead that already carries the symbol.
 * That is redundant rather than wrong (the clause permits the text form; it
 * does not forbid it appearing alongside the symbol), but if the duplication
 * reads badly in print the fix is to move the sentence out of the running
 * header and into the body of the continuation content, not to try to suppress
 * it per page.
 */
/**
 * These two templates are raw strings, not JSX, so React's escaping does not
 * apply. The certificate number is org-configurable (prefixes come from
 * /api/certificate-numbering), which makes it the one value here a lab can put
 * a `<` into and corrupt the header markup.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function certificateHeaderHtml(params: {
  certificateNumber: string;
  accreditationNumberText: string | null;
}): string {
  const accredited = params.accreditationNumberText
    ? `Laboratório de Calibração acreditado pela Cgcre de acordo com a ABNT NBR ISO/IEC 17025, sob o número ${escapeHtml(params.accreditationNumberText)}`
    : "";
  return `<div style="width:100%;font-family:Arial,'Liberation Sans',sans-serif;font-size:6.5pt;color:#4a4a4a;padding:0 15mm;display:flex;justify-content:space-between;gap:8mm;">
  <span style="flex:1;min-width:0;">${accredited}</span>
  <span style="white-space:nowrap;font-weight:bold;">${escapeHtml(params.certificateNumber)}</span>
</div>`;
}

/** Running footer: "Página X de Y" on every page (§7.8.2.1 d). */
export function certificateFooterHtml(): string {
  return `<div style="width:100%;font-family:Arial,'Liberation Sans',sans-serif;font-size:6.5pt;color:#4a4a4a;padding:0 15mm;text-align:right;">
  Página <span class="pageNumber"></span> de <span class="totalPages"></span>
</div>`;
}
