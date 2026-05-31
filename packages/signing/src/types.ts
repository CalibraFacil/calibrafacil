/**
 * Types for ICP-Brasil digital signature module
 * ISO 17025 Clause 7.8.2.1(q) compliance
 */

/**
 * Options for signing a PDF document
 */
export interface SigningOptions {
  /** PKCS#12 certificate buffer (Base64-decoded) */
  p12Buffer: Buffer;
  /** Password for the PKCS#12 file */
  password: string;
  /** Reason for signing (default: "Certificado de Calibracao") */
  reason?: string;
  /** Location where signing took place (default: "Brasil") */
  location?: string;
  /** Contact information for the signer */
  contactInfo?: string;
  /** Enable Long-Term Validation (requires TSA) - not implemented in v1 */
  enableLtv?: boolean;
}

/**
 * Result of signing a PDF document
 */
export interface SigningResult {
  /** Signed PDF as Uint8Array */
  signedPdf: Uint8Array;
  /** Metadata about the signature */
  metadata: SignatureMetadata;
}

/**
 * Metadata about a digital signature
 * Stored in calibration_job.signature_metadata
 */
export interface SignatureMetadata {
  /** ISO timestamp when the document was signed */
  signedAt: string;
  /** Serial number of the signing certificate */
  signerCertificateSerial: string;
  /** Common Name (CN) of the signer */
  signerName: string;
  /** CPF or CNPJ extracted from the certificate (if available) */
  signerCpfCnpj: string | null;
  /** SHA-256 hash of the signed PDF */
  pdfHash: string;
  /** Whether LTV (Long-Term Validation) is enabled */
  ltvEnabled: boolean;
}

/**
 * Information extracted from a PKCS#12 certificate
 */
export interface CertificateInfo {
  /** Certificate serial number */
  serialNumber: string;
  /** Issuer Common Name */
  issuerCn: string;
  /** Subject Common Name */
  subjectCn: string;
  /** CPF or CNPJ if present in subject */
  subjectCpfCnpj: string | null;
  /** Certificate validity start date */
  validFrom: Date;
  /** Certificate validity end date */
  validUntil: Date;
  /** Raw certificate object (node-forge) */
  certificate: forge.pki.Certificate;
  /** Private key object (node-forge) */
  privateKey: forge.pki.PrivateKey;
  /** Certificate chain (if available) */
  chain: forge.pki.Certificate[];
}

/**
 * Error thrown during signing operations
 */
export class SigningError extends Error {
  constructor(
    message: string,
    public readonly code: SigningErrorCode,
  ) {
    super(message);
    this.name = "SigningError";
  }
}

export type SigningErrorCode =
  | "INVALID_P12"
  | "WRONG_PASSWORD"
  | "CERTIFICATE_EXPIRED"
  | "CERTIFICATE_NOT_YET_VALID"
  | "CERTIFICATE_REVOKED"
  | "INVALID_CHAIN"
  | "SIGNING_FAILED"
  | "PDF_ERROR";

// Re-export node-forge types for internal use
import type forge from "node-forge";
export type { forge };
