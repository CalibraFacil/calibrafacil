/**
 * The projection from a frozen calibration job to the flat, presentation-ready
 * record a certificate is rendered from.
 *
 * This is renderer-agnostic on purpose. It used to live inside the
 * lab-authored XLSX template package, but never depended on it: it takes no
 * binding manifest and no workbook engine, and it is the one piece of that
 * package worth keeping. The fixed system layouts in
 * `@calibra-facil/documents` consume `buildCertificateData` directly.
 */
export {
  certificateImageContextFromJob,
  type CertificateJobData,
  type MethodFormula,
  type StandardSnapshot,
} from "./certificate-data.js";
export { renderEccentricityIndicatorSvgMarkup } from "./eccentricity-indicator.js";
export { formatDecimalPtBr, fractionDigitsOf } from "./decimal-format.js";
export {
  formatAtDecimals,
  roundMeasurementForReport,
} from "./reporting-rounding.js";
export {
  assembleCertificateJobData,
  buildCertificateInput,
  canonicalJson,
  CERTIFICATE_INPUT_SCHEMA_VERSION,
  CERTIFICATE_LAYOUT_KEY,
  CERTIFICATE_LAYOUT_VERSION,
  certificateContentRulesFor,
  certificateInputSha256,
  imageDataUrl,
  isCertificateInput,
  type CertificateContentRules,
  type CertificateInput,
  type CertificateJobSource,
} from "./certificate-input.js";
export {
  calibratingBodyAddressText,
  evaluateTraceability,
  freezeSignatory,
  pickSignatoryRecord,
  resolveCalibratingBody,
  type TraceabilityStandard,
} from "./frozen-content.js";
