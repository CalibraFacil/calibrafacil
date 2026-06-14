/**
 * @calibra-facil/signing
 *
 * ICP-Brasil digital signature module for PDF certificates
 * ISO 17025 Clause 7.8.2.1(q) compliance
 *
 * @example
 * ```typescript
 * import { signPdf, getCertificateInfo, decryptPassword } from '@calibra-facil/signing';
 *
 * // Get certificate info
 * const info = getCertificateInfo(p12Buffer, password);
 * console.log(`Signer: ${info.subjectCn}`);
 * console.log(`Valid until: ${info.validUntil}`);
 *
 * // Sign a PDF
 * const { signedPdf, metadata } = await signPdf(pdfBuffer, {
 *   p12Buffer,
 *   password,
 *   reason: 'Certificado de Calibracao',
 * });
 * ```
 */

// Signing functions
export {
  signPdf,
  getCertificateInfo,
  parsePkcs12,
  validateCertificateValidity,
} from "./signer.js";

// Encryption functions for password storage
export {
  encryptPassword,
  decryptPassword,
  encryptBinary,
  decryptBinary,
  generateMasterKey,
} from "./encryption.js";

// Types
export type {
  SigningOptions,
  SigningResult,
  SignatureMetadata,
  CertificateInfo,
  SigningErrorCode,
} from "./types.js";

export { SigningError } from "./types.js";

// Chain validation against the ICP-Brasil trust anchors
export {
  validateCertificateChain,
  validatePkijsChain,
  validatePkcs12Chain,
  parsePemCertificates,
  loadTrustStore,
  getIcpBrasilTrustAnchors,
} from "./chain-validation.js";
export type {
  ChainValidationResult,
  ChainValidationOptions,
  PkijsChainValidationOptions,
} from "./chain-validation.js";

// Public PDF signature verification (powers the verification page)
export { verifyPdf } from "./verify.js";
export type {
  VerifyPdfResult,
  VerifyPdfOptions,
  VerifyPdfSigner,
  VerifyOverall,
} from "./verify.js";

// RFC-3161 timestamp (carimbo de tempo) — PAdES-T building block
export { addRfc3161Timestamp } from "./timestamp.js";
export type { TimestampConfig, TimestampOutcome } from "./timestamp.js";
