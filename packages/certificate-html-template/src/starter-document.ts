import {
  type CertificateDocument,
  parseCertificateDocument,
} from "./document-schema.js";

/**
 * Starter document (free-canvas pivot): a BLANK page. The user composes the
 * certificate — every block is available from the '/' menu and the Bloco
 * dropdown; nothing is pre-inserted or mandatory.
 */
export function newWysiwygStarterDocument(): CertificateDocument {
  return parseCertificateDocument({
    type: "doc",
    attrs: { schemaVersion: 3, theme: "technical-form" },
    content: [{ type: "paragraph" }],
  });
}

/**
 * The COMPLETE reference layout (previous mandatory starter): every block +
 * bands in conventional order. Users insert it onto the blank canvas in one
 * action ("Modelo completo"); specs use it to exercise every renderer.
 */
export function completeWysiwygDocument(): CertificateDocument {
  return parseCertificateDocument({
    type: "doc",
    attrs: { schemaVersion: 3, theme: "technical-form" },
    content: [
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
      { type: "lockedBlock", attrs: { blockKey: "lab_identification" } },
      {
        type: "heading",
        attrs: { level: 1, textAlign: "left" },
        content: [{ type: "text", text: "Certificado de Calibração" }],
      },
      { type: "lockedBlock", attrs: { blockKey: "certificate_identification" } },
      { type: "lockedBlock", attrs: { blockKey: "customer_identification" } },
      { type: "lockedBlock", attrs: { blockKey: "item_identification" } },
      { type: "lockedBlock", attrs: { blockKey: "method_traceability" } },
      { type: "lockedBlock", attrs: { blockKey: "environmental_conditions" } },
      { type: "lockedBlock", attrs: { blockKey: "results_table" } },
      { type: "lockedBlock", attrs: { blockKey: "uncertainty_statement" } },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Observações" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Os resultados deste certificado referem-se exclusivamente ao item calibrado.",
          },
        ],
      },
      { type: "lockedBlock", attrs: { blockKey: "accreditation_seal" } },
      { type: "lockedBlock", attrs: { blockKey: "signature_block" } },
      { type: "lockedBlock", attrs: { blockKey: "verification_qr" } },
      { type: "lockedBlock", attrs: { blockKey: "end_of_document" } },
      {
        type: "bandPageFooter",
        attrs: {
          enabled: true,
          showCertificateNumber: true,
          showLabName: false,
          showIssueDate: false,
        },
      },
    ],
  });
}
