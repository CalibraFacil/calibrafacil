/**
 * Print CSS contract for wysiwyg certificates (reframe T21).
 *
 * REGISTER (06-reframe §G): two documental themes —
 *   technical-form   (default) Source Sans 3 + IBM Plex Mono numerals,
 *                    full dark grid tables, near-monochrome;
 *   institute-classic Source Serif 4 body, black rules, formal.
 *
 * All sizes in PRINT POINTS with hard floors from research R3 (DIN 5008 /
 * Butterick): body >= 10pt, table cells >= 9pt, labels/captions >= 8.5pt,
 * smallest structural caption 8pt. Label ink is DARK (no faint-gray microtext).
 * A spec test enforces the floors on this file — do not undercut them.
 *
 * Constant per compiler version. Any change requires a
 * CERT_HTML_COMPILER_VERSION bump.
 */
import type {
  CertificateStyleTokens,
  CertificateTheme,
} from "./document-schema.js";

/**
 * Chromium print margins (Gotenberg form-field inches): 16mm top, 15mm sides,
 * 18mm bottom (room for the "Página X de Y" footer).
 */
export const CERTIFICATE_PDF_MARGINS = {
  marginTop: "0.6299",
  marginBottom: "0.7087",
  marginLeft: "0.5906",
  marginRight: "0.5906",
} as const;

const SHARED_TOKENS = `
  --ink:#111418; --muted:#2E3440; --label:#3B4252;
  --line:#8B93A1; --line-strong:#111418;
  --size-body:10pt; --size-cell:9pt; --size-label:8.5pt; --size-caption:8pt;
  --size-h1:17pt; --size-h2:12pt; --size-h3:10.5pt; --size-certno:13pt;
  --font-mono:"IBM Plex Mono", ui-monospace, "DejaVu Sans Mono", monospace;
`;

const THEME_TOKEN_MAP: Record<CertificateTheme, string> = {
  "technical-form": `${SHARED_TOKENS}
  --font-body:"Source Sans 3", "Segoe UI", system-ui, sans-serif;
  --accent:#1F3A5F;
  --cell-border:0.6pt solid #6B7280;
  --table-frame:0.9pt solid #111418;
  --head-bg:transparent;
`,
  "institute-classic": `${SHARED_TOKENS}
  --font-body:"Source Serif 4", "Times New Roman", serif;
  --accent:#111418;
  --cell-border:none;
  --table-frame:none;
  --head-bg:transparent;
`,
};

/** Token declarations for a theme (used by :root in print, `.cf-page` in the editor). */
export function certificateThemeTokens(theme: CertificateTheme): string {
  return THEME_TOKEN_MAP[theme];
}

/**
 * Size tokens the `fontScale` style token multiplies, with the R3 print
 * floors. Scaled values are rounded to one decimal and clamped at the floor,
 * so a 0.9 scale can never undercut the legibility contract enforced by
 * `print-css.spec.ts`.
 */
const SCALABLE_SIZE_TOKENS: Array<{
  token: string;
  basePt: number;
  floorPt: number;
}> = [
  { token: "--size-body", basePt: 10, floorPt: 10 },
  { token: "--size-cell", basePt: 9, floorPt: 9 },
  { token: "--size-label", basePt: 8.5, floorPt: 8.5 },
  { token: "--size-caption", basePt: 8, floorPt: 8 },
  { token: "--size-h1", basePt: 17, floorPt: 10 },
  { token: "--size-h2", basePt: 12, floorPt: 10 },
  { token: "--size-h3", basePt: 10.5, floorPt: 10 },
  { token: "--size-certno", basePt: 13, floorPt: 10 },
];

/**
 * CSS custom-property OVERRIDES for the optional template style tokens.
 * Emitted AFTER `certificateThemeTokens` so later declarations win. Returns
 * "" when nothing deviates from the theme defaults.
 */
export function certificateStyleTokenOverrides(
  styleTokens: CertificateStyleTokens | null | undefined,
): string {
  if (!styleTokens) return "";
  const declarations: string[] = [];
  if (styleTokens.accent) {
    declarations.push(`--accent:${styleTokens.accent};`);
  }
  const scale = styleTokens.fontScale;
  if (scale !== undefined && scale !== 1) {
    for (const { token, basePt, floorPt } of SCALABLE_SIZE_TOKENS) {
      const scaled = Math.max(
        floorPt,
        Math.round(basePt * scale * 10) / 10,
      );
      declarations.push(`${token}:${scaled}pt;`);
    }
  }
  if (declarations.length === 0) return "";
  return `\n  ${declarations.join(" ")}\n`;
}

/** Body class the compiler stamps so structural per-theme rules can hook in. */
export function certificateThemeClass(theme: CertificateTheme): string {
  return `cf-theme-${theme}`;
}

export const CERTIFICATE_PRINT_CSS = `
@page { size: A4; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body{
  font-family: var(--font-body);
  color: var(--ink); font-size: var(--size-body); line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
.cf-mono, .cf-num{
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
}

/* ── editable prose ── */
h1 { font-size: var(--size-h1); font-weight: 700; line-height: 1.15; margin: 9pt 0 3pt; }
h2 { font-size: var(--size-h2); font-weight: 700; margin: 10pt 0 3pt; }
h3, h4 { font-size: var(--size-h3); font-weight: 700; margin: 8pt 0 2pt; }
p { margin: 0 0 5pt; }
ul, ol { margin: 0 0 5pt; padding-left: 14pt; }
li { margin: 0 0 1.5pt; }
hr { border: none; border-top: 0.75pt solid var(--line); margin: 8pt 0; }
strong { font-weight: 700; }

/* ── tables ── */
table { border-collapse: collapse; width: 100%; margin: 0 0 7pt; border: var(--table-frame); }
thead { display: table-header-group; }
th{
  font-family: var(--font-body);
  font-size: var(--size-label); font-weight: 700;
  color: var(--ink); text-align: left;
  padding: 3pt 5pt; border: var(--cell-border);
  border-bottom: 0.9pt solid var(--line-strong);
  background: var(--head-bg); vertical-align: bottom;
}
th.cf-unit-row{ font-weight: 400; font-size: var(--size-caption); color: var(--muted); }
td { padding: 3pt 5pt; border: var(--cell-border); font-size: var(--size-cell); overflow-wrap: anywhere; }
tr { break-inside: avoid; }
tbody tr:last-child td { border-bottom: var(--cell-border); }
td.cf-num, th.cf-num { text-align: right; }

/* institute-classic: rule-only tables (no vertical grid) */
.cf-theme-institute-classic td{ border-bottom: 0.5pt solid var(--line); }
.cf-theme-institute-classic tbody tr:last-child td{ border-bottom: 0.9pt solid var(--line-strong); }
.cf-theme-institute-classic table{ border-top: 0.9pt solid var(--line-strong); }

/* ── locked blocks ── */
/* No blanket break-inside: results_table can be arbitrarily long and MUST
   paginate row-by-row; the small fixed blocks declare their own avoid. */
.cf-locked-block { margin: 0 0 9pt; }

/* section label */
.cf-locked-block .cf-block-title{
  font-family: var(--font-body);
  font-size: var(--size-label); font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink);
  border-bottom: 0.9pt solid var(--line-strong);
  margin: 0 0 4pt; padding: 0 0 1.5pt;
}

/* key/value grid */
.cf-field-list{ display: grid; grid-template-columns: max-content 1fr; gap: 2pt 10pt; }
.cf-field-list dt, .cf-field-list dd{ min-width: 0; overflow-wrap: anywhere; }
.cf-field-list dt{
  font-family: var(--font-body);
  font-size: var(--size-label); font-weight: 700; color: var(--label);
  align-self: baseline;
}
.cf-field-list dd{ margin: 0; font-size: var(--size-body); }
.cf-layout-cols-2 .cf-field-list, .cf-field-list.cf-cols-2{ grid-template-columns: max-content 1fr max-content 1fr; }
.cf-layout-cols-3 .cf-field-list, .cf-field-list.cf-cols-3{ grid-template-columns: max-content 1fr max-content 1fr max-content 1fr; }
.cf-layout-compact .cf-field-list{ gap: 1pt 8pt; }
.cf-layout-compact .cf-field-list dd{ font-size: var(--size-cell); }

/* masthead */
.cf-masthead{ display: flex; align-items: flex-start; gap: 14pt; }
.cf-lab-logo{ max-height: 16mm; max-width: 44mm; object-fit: contain; display: block; }
.cf-masthead-id{ flex: 1; min-width: 0; padding-top: 1pt; }
.cf-masthead-name{ font-size: 13pt; font-weight: 700; overflow-wrap: anywhere; }
.cf-masthead-lines{ color: var(--muted); font-size: var(--size-label); line-height: 1.55; margin-top: 2pt; }
.cf-masthead-lines b{ font-weight: 700; color: var(--ink); }
.cf-rule{ height: 1.6pt; background: var(--ink); margin-top: 7pt; }

/* certificate identification */
.cf-certrow{ display: flex; justify-content: space-between; gap: 14pt; align-items: flex-start; }
.cf-certno-label{
  font-size: var(--size-label); font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--label);
}
.cf-certno{
  font-family: var(--font-mono);
  font-size: var(--size-certno); font-weight: 600; color: var(--accent);
  margin-top: 1pt;
  overflow-wrap: anywhere;
}
.cf-certrow .cf-field-list{ flex: 1; }

.cf-placeholder { white-space: pre-wrap; }

/* signature */
.cf-signature-block{ break-inside: avoid; min-height: 30mm; margin-top: 12mm; text-align: center; }
.cf-signature-block img { max-height: 16mm; display: block; margin: 0 auto; }
.cf-signature-line{
  display: inline-block; min-width: 70mm;
  border-top: 0.9pt solid var(--ink); padding-top: 4pt; margin-top: 3pt;
}
.cf-signature-name{ font-weight: 700; font-size: var(--size-body); }
.cf-signature-title{ font-size: var(--size-label); color: var(--muted); margin-top: 1pt; }

/* accreditation seal */
.cf-accreditation-seal{ break-inside: avoid; min-height: 24mm; display: flex; flex-direction: column; align-items: flex-end; }
.cf-accreditation-seal img { height: 22mm; }
.cf-accreditation-seal .cf-seal-caption{
  font-family: var(--font-mono);
  font-size: var(--size-caption); color: var(--muted); margin-top: 2pt;
}

/* verification */
.cf-verification{ break-inside: avoid; display: flex; align-items: center; gap: 5mm; margin-top: 6pt; }
.cf-verification img { width: 20mm; height: 20mm; }
.cf-verification .cf-verification-text{ font-size: var(--size-label); color: var(--muted); line-height: 1.5; }
.cf-verification .cf-verification-text strong{
  font-family: var(--font-mono);
  font-weight: 600; color: var(--ink); word-break: break-all;
}

/* end of document */
.cf-end-of-document{ margin-top: 14pt; padding-top: 6pt; border-top: 0.75pt solid var(--line); }
.cf-end-of-document .cf-end-marker{
  font-size: var(--size-label); font-weight: 700; letter-spacing: 0.06em;
  text-align: center; color: var(--ink); margin-bottom: 4pt;
}
.cf-end-of-document .cf-end-note{
  font-size: var(--size-label); color: var(--muted); line-height: 1.5;
  padding-left: 10pt; position: relative;
}
.cf-end-of-document .cf-end-note::before{ content: "—"; position: absolute; left: 0; color: var(--muted); }

/* explicit border-mode overrides (template layout envelope) — AFTER theme rules */
table.cf-borders-grid{ border: 0.9pt solid var(--line-strong); }
table.cf-borders-grid th, table.cf-borders-grid td{ border: 0.6pt solid #6B7280; }
table.cf-borders-grid th{ border-bottom: 0.9pt solid var(--line-strong); }
table.cf-borders-rules{ border: none; border-top: 0.9pt solid var(--line-strong); }
table.cf-borders-rules th, table.cf-borders-rules td{ border: none; }
table.cf-borders-rules th{ border-bottom: 0.9pt solid var(--line-strong); }
table.cf-borders-rules td{ border-bottom: 0.5pt solid var(--line); }
.cf-grid-caption{ font-size: var(--size-label); font-weight: 700; margin: 0 0 2pt; }

.cf-image { margin: 0 0 7pt; }
.cf-image img { max-width: 100%; }

/* ── document band structure (M-B) ──
   The whole document rides inside table.cf-doc so Chromium repeats the thead
   (top identity band) on every printed page. The structural table must be
   invisible: kill every generic/theme table rule with higher-specificity
   selectors, keep these LAST in the sheet. */
.cf-certificate table.cf-doc{ border: none; margin: 0; width: 100%; }
.cf-certificate table.cf-doc > thead > tr,
.cf-certificate table.cf-doc > tbody > tr{ break-inside: auto; }
.cf-certificate table.cf-doc > thead > tr > td,
.cf-certificate table.cf-doc > tbody > tr > td{
  border: none; padding: 0; font-size: var(--size-body); vertical-align: top;
}
.cf-certificate.cf-theme-institute-classic table.cf-doc{ border-top: none; }

/* top identity band (repeats via thead) */
.cf-band-top-identity{
  padding: 0 0 3pt; border-bottom: 0.9pt solid var(--line-strong);
  margin: 0 0 8pt;
}
.cf-band-identity-row{
  display: flex; justify-content: space-between; align-items: baseline; gap: 10pt;
}
.cf-band-lab{ font-weight: 700; font-size: var(--size-label); overflow-wrap: anywhere; }
.cf-band-title{ font-size: var(--size-label); color: var(--muted); }
.cf-band-cert{
  font-family: var(--font-mono);
  font-size: var(--size-label); font-weight: 600;
}
.cf-band-seal-text{ font-size: var(--size-caption); color: var(--muted); margin-top: 1pt; }
.cf-band-seal-inline{ font-size: var(--size-caption); color: var(--muted); }

/* eccentricity indicator (weighing methods) */
.cf-eccentricity-indicator{ break-inside: avoid; margin: 4pt 0 7pt; }
.cf-eccentricity-indicator img{ width: 52mm; max-width: 100%; display: block; }

/* verdict + decision rule (optional blocks) */
td.cf-verdict{ font-weight: 700; }
td.cf-verdict--ok{ color: #14532D; }
td.cf-verdict--critical{ color: #7F1D1D; }
.cf-decision-rule{ font-size: var(--size-label); line-height: 1.5; }

/* calibration curve charts */
.cf-result-chart{ break-inside: avoid; margin: 4pt 0 8pt; }
.cf-result-chart svg{ width: 150mm; max-width: 100%; display: block; }

/* ── placement presets (M-C) ── */
.cf-accreditation-seal.cf-preset-seal-left{ align-items: flex-start; }
.cf-accreditation-seal.cf-preset-seal-center{ align-items: center; }
.cf-masthead.cf-preset-logo-right{ flex-direction: row-reverse; }
.cf-masthead.cf-preset-logo-top{ flex-direction: column; align-items: center; text-align: center; gap: 4pt; }
`;
