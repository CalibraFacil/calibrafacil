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
