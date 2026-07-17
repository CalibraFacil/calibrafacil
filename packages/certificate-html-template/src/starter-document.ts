import {
  type CertificateDocument,
  parseCertificateDocument,
} from "./document-schema.js";

/**
 * Starter document for a new `wysiwyg` certificate template: every mandatory
 * locked block present exactly once, in the conventional reading order, plus
 * minimal editable defaults. Created server-side when a template is created
 * with `engine: "wysiwyg"` (spec 02 §6.1). Visual polish lands in T14.
 */
export function newWysiwygStarterDocument(): CertificateDocument {
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
