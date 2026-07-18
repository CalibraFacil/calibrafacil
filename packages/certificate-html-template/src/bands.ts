import { resolvePlaceholder } from "./catalog.js";
import type {
  BandPageFooterNode,
  BandTopIdentityNode,
} from "./document-schema.js";
import { escapeHtml } from "./blocks.js";

/**
 * Band renderers (reframe M-B). Bands are page furniture that repeats on
 * EVERY printed page:
 *
 * - The top identity band renders into the `<thead>` of the document-wrapping
 *   table (`table.cf-doc`) — Chromium repeats a thead on each page the table
 *   spans, page 1 included. NIE-CGCRE-009 wants the certificate identity on
 *   every page, so page 1 showing identity band + full masthead is the
 *   intended "first page variant".
 * - The footer band renders into a Chromium footerTemplate document (the only
 *   rendering context where pageNumber/totalPages exist). It is embedded in
 *   the compiled artifact as `<template id="cf-page-footer">` and extracted by
 *   the worker via `extractCertificatePageFooterHtml`. footerTemplates cannot
 *   load @font-face, so the footer uses a system font stack — sizes stay at or
 *   above the R3 8pt floor.
 *
 * Like the locked blocks, band content derives exclusively from the frozen
 * input data + the band's config attrs. Determinism rules apply unchanged.
 */

type Data = Record<string, unknown>;

/**
 * Escaped catalog resolution. Optional fields resolve to ""; required-but-
 * missing fields throw (fail-loud, same rule as the locked blocks).
 */
function bandField(data: Data, path: string): string {
  return escapeHtml(resolvePlaceholder(data, path));
}

function accreditationTextLine(data: Data): string {
  const accredited = bandField(data, "accreditation.accredited") === "Sim";
  if (!accredited) return "";
  const number = bandField(data, "accreditation.numberFormatted");
  return number === ""
    ? "Laboratório de calibração acreditado pela Cgcre"
    : `Laboratório de calibração acreditado pela Cgcre sob o nº ${number}`;
}

/**
 * Inner HTML of the repeating top identity band. Returns "" when the band is
 * disabled or resolves to no visible content (the compiler then omits the
 * thead entirely).
 */
export function renderBandTopIdentityInner(
  attrs: BandTopIdentityNode["attrs"],
  data: Data,
): string {
  if (!attrs.enabled) return "";
  // M-C slots: absent slot attrs reproduce the M-B arrangement byte-for-byte
  // (labName/title left, certNumber right, sealText on the second line).
  const left: string[] = [];
  const right: string[] = [];
  const line2: string[] = [];
  const place = (
    slot: "left" | "right" | "line2" | null | undefined,
    fallback: "left" | "right" | "line2",
    fragment: string,
  ) => {
    if (fragment === "") return;
    const target = slot ?? fallback;
    if (target === "left") left.push(fragment);
    else if (target === "right") right.push(fragment);
    else line2.push(fragment);
  };
  if (attrs.showLabName) {
    const labName = bandField(data, "lab.name");
    place(
      attrs.labNameSlot,
      "left",
      labName === "" ? "" : `<span class="cf-band-lab">${labName}</span>`,
    );
  }
  if (attrs.showTitle) {
    place(
      attrs.titleSlot,
      "left",
      '<span class="cf-band-title">Certificado de Calibração</span>',
    );
  }
  if (attrs.showCertificateNumber) {
    const number = bandField(data, "certificate.number");
    place(
      attrs.certificateNumberSlot,
      "right",
      number === ""
        ? ""
        : `<span class="cf-band-cert">Certificado ${number}</span>`,
    );
  }
  if (attrs.showSealText) {
    const sealText = accreditationTextLine(data);
    if (sealText !== "") {
      const slot = attrs.sealTextSlot ?? "line2";
      // On the second line the text renders bare (M-B markup); inline on the
      // identity row it needs its own sizing class.
      place(
        slot,
        "line2",
        slot === "line2"
          ? sealText
          : `<span class="cf-band-seal-inline">${sealText}</span>`,
      );
    }
  }
  const sealLine =
    line2.length === 0
      ? ""
      : `<div class="cf-band-seal-text">${line2.join(" ")}</div>`;
  if (left.length === 0 && right.length === 0 && sealLine === "") return "";
  return `<div class="cf-band-identity-row"><div class="cf-band-left">${left.join(
    " ",
  )}</div><div class="cf-band-right">${right.join(" ")}</div></div>${sealLine}`;
}

/**
 * Full Chromium footerTemplate document for the footer identity band.
 * "Página X de Y" is mandatory (NIE-CGCRE-009) and always present; when the
 * band is disabled this still returns a minimal page-number-only footer so no
 * configuration can produce unnumbered pages.
 */
export function renderBandPageFooterTemplate(
  attrs: BandPageFooterNode["attrs"],
  data: Data,
): string {
  const identity: string[] = [];
  if (attrs.enabled) {
    if (attrs.showCertificateNumber) {
      const number = bandField(data, "certificate.number");
      if (number !== "") identity.push(`Certificado ${number}`);
    }
    if (attrs.showLabName) {
      const labName = bandField(data, "lab.name");
      if (labName !== "") identity.push(labName);
    }
    if (attrs.showIssueDate) {
      const issuedAt = bandField(data, "certificate.issuedAt");
      if (issuedAt !== "") identity.push(`Emitido em ${issuedAt}`);
    }
  }
  const identityHtml = identity.join(" · ");
  const pageNumbersHtml =
    'Página <span class="pageNumber"></span> de <span class="totalPages"></span>';
  // M-C slot: identity side (default left); page numbers take the other side.
  // Inline wrap containment on each cell: footerTemplates ignore external
  // CSS, so a 200-char lab name would otherwise overflow the 18mm bottom
  // margin with no stylesheet escape hatch.
  const cellStyle =
    "min-width:0;max-width:70%;overflow:hidden;overflow-wrap:anywhere;word-break:break-word;";
  const cells =
    (attrs.identitySide ?? "left") === "left"
      ? `<div style="${cellStyle}">${identityHtml}</div><div style="min-width:0;">${pageNumbersHtml}</div>`
      : `<div style="min-width:0;">${pageNumbersHtml}</div><div style="${cellStyle}">${identityHtml}</div>`;
  // Inline styles only: Chromium footerTemplates ignore external CSS and
  // @font-face. 8.5pt >= the R3 8pt print floor; near-black ink.
  const baseStyle =
    "font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:8.5pt;color:#1a1a1a;";
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body>' +
    `<div style="width:100%;box-sizing:border-box;padding:0 15mm;display:flex;justify-content:space-between;align-items:baseline;border-top:0.6pt solid #1a1a1a;padding-top:4pt;${baseStyle}">` +
    cells +
    "</div></body></html>"
  );
}

const FOOTER_TEMPLATE_OPEN = '<template id="cf-page-footer">';
const FOOTER_TEMPLATE_CLOSE = "</template>";

/** Wrap the footer document for embedding inside the compiled artifact. */
export function embedCertificatePageFooter(footerTemplateHtml: string): string {
  return `${FOOTER_TEMPLATE_OPEN}${footerTemplateHtml}${FOOTER_TEMPLATE_CLOSE}`;
}

/**
 * Extract the embedded Chromium footerTemplate from a compiled certificate
 * artifact. Returns null for pre-M-B artifacts (callers fall back to their
 * default page-number footer).
 */
export function extractCertificatePageFooterHtml(html: string): string | null {
  const start = html.indexOf(FOOTER_TEMPLATE_OPEN);
  if (start === -1) return null;
  const contentStart = start + FOOTER_TEMPLATE_OPEN.length;
  const end = html.indexOf(FOOTER_TEMPLATE_CLOSE, contentStart);
  if (end === -1) return null;
  return html.slice(contentStart, end);
}
