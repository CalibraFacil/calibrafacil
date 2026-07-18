export {
  canonicalJsonStringify,
  hashCertificateDocument,
  sha256Hex,
} from "./canonical-json.js";
export {
  BANNED_PLACEHOLDER_SEGMENTS,
  CERTIFICATE_DOCUMENT_SCHEMA_VERSION,
  CERTIFICATE_THEMES,
  DEFAULT_BAND_PAGE_FOOTER_ATTRS,
  DEFAULT_BAND_TOP_IDENTITY_ATTRS,
  LOCKED_BLOCK_KEYS,
  OPTIONAL_BLOCK_KEYS,
  upgradeCertificateDocument,
  certificateDocumentSchema,
  collectPlaceholderPaths,
  parseCertificateDocument,
  validateCertificateDocument,
} from "./document-schema.js";
export type {
  BandPageFooterNode,
  BandTopIdentityNode,
  CertificateBlockLayout,
  CertificateDocument,
  CertificateTheme,
  CertificateDocumentBlock,
  CertificateDocumentIssue,
  LockedBlockKey,
  LockedBlockNode,
  PlaceholderNode,
} from "./document-schema.js";
export {
  MissingRequiredPlaceholderError,
  PLACEHOLDER_CATALOG,
  UnknownPlaceholderError,
  findUnknownPlaceholderPaths,
  getPlaceholderEntry,
  resolvePlaceholder,
} from "./catalog.js";
export type { PlaceholderCatalogEntry } from "./catalog.js";
export {
  BandPageFooter,
  BandTopIdentity,
  CertImage,
  CertPlaceholder,
  LockedBlock,
  certificateEditorExtensions,
} from "./extensions.js";
export { PlaceholderFormatError, applyPlaceholderFormat } from "./format.js";
export type { PlaceholderFormat } from "./format.js";
export { sampleCertificateInputData } from "./fixtures/sample-input-data.js";
export { SAMPLE_SIGNATURE_DATA_URL } from "./sample-assets.js";
export {
  LockedBlockGuard,
  createLockedBlockGuardPlugin,
  lockedBlockGuardKey,
} from "./locked-guard.js";
export {
  ACCREDITATION_SEAL_PRESETS,
  CertificateRenderDataError,
  LAB_IDENTIFICATION_PRESETS,
  escapeHtml,
  renderLockedBlockInner,
} from "./blocks.js";
export {
  embedCertificatePageFooter,
  extractCertificatePageFooterHtml,
  renderBandPageFooterTemplate,
  renderBandTopIdentityInner,
} from "./bands.js";
export type { LockedBlockRenderContext } from "./blocks.js";
export {
  CertificateDocumentInvalidError,
  CertificateImageUnresolvedError,
  compileCertificateHtml,
  validateCertificateTemplateDocument,
} from "./compile.js";
export type { CompileCertificateOptions, CompiledCertificate } from "./compile.js";
export {
  CERTIFICATE_PDF_MARGINS,
  CERTIFICATE_PRINT_CSS,
  certificateThemeClass,
  certificateThemeTokens,
} from "./print-css.js";
export { deriveResultGrids } from "./result-grid.js";
export type { ResultGrid, ResultGridColumn } from "./result-grid.js";
export { newWysiwygStarterDocument } from "./starter-document.js";
export { CERT_HTML_COMPILER_VERSION } from "./version.js";
