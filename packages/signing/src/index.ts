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
export { signPdf, parsePkcs12 } from "./signer.js";

// Encryption functions for password storage
export {
  encryptPassword,
  decryptPassword,
  encryptBinary,
  generateMasterKey,
} from "./encryption.js";

// Types
export type { SignatureMetadata } from "./types.js";

export { SigningError } from "./types.js";

// Chain validation against the ICP-Brasil trust anchors
export { getIcpBrasilTrustAnchors } from "./chain-validation.js";

// Public PDF signature verification (powers the verification page)
export { verifyPdf } from "./verify.js";
export type { VerifyPdfResult, VerifyPdfTimestamp } from "./verify.js";

// RFC-3161 timestamp (carimbo de tempo) — PAdES-T building block
export type { TimestampConfig } from "./timestamp.js";

// PAdES-T orchestration (#646 / CMP-03): sign + RFC-3161 stamp, fail-closed.
export { signAndTimestampPdf } from "./sign-and-timestamp.js";

// CRL revocation (#646 / CMP-03 fase b): pure check + injectable HTTP fetcher.
export { createCrlFetcher } from "./crl-fetcher.js";

// Envelope encryption of the signing credentials (roadmap 2 B4a): per-field data
// keys wrapped by an identified KEK, AAD = organization + unit + serial.
export {
  CREDENTIAL_FORMAT_ENVELOPE,
  CREDENTIAL_FORMAT_LEGACY,
  createSigningKeyring,
  credentialNeedsRewrap,
  openSigningCredential,
  sealSigningCredential,
  signingKeyringFromEnv,
} from "./envelope.js";
export type { SigningKeyring, StoredSigningCredential } from "./envelope.js";

// Validation of a signing credential at upload (roadmap 2 B4a): validity window,
// key usage and the chain to the configured trust store.
export {
  resolveSigningTrustAnchors,
  validateSigningCredential,
} from "./credential-validation.js";
