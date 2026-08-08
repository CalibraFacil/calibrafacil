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
  buildCertificateData,
  certificateImageContextFromJob,
  type AssetSnapshot,
  type BuildCertificateDataOptions,
  type CalibrationLocationSnapshot,
  type CalibrationPhaseSnapshot,
  type CertificateJobData,
  type CertifiedValue,
  type CustomerAddress,
  type EnvironmentalSnapshot,
  type MethodCertificateContent,
  type MethodFormula,
  type MethodFormulaReporting,
  type MethodFormulaScope,
  type MethodInputField,
  type MethodSnapshot,
  type StandardSnapshot,
} from "./certificate-data.js";
export {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  renderEccentricityIndicatorSvgMarkup,
  type CertificateImageContext,
} from "./eccentricity-indicator.js";
export { formatValue, getPath } from "./formatters.js";
export { formatDecimalPtBr, fractionDigitsOf } from "./decimal-format.js";
export {
  formatAtDecimals,
  roundMeasurementForReport,
  UNCERTAINTY_SIGNIFICANT_FIGURES,
  type RoundedMeasurement,
} from "./reporting-rounding.js";
