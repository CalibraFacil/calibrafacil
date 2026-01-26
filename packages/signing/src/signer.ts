/**
 * PDF Signing with PAdES standard for ICP-Brasil certificates
 * ISO 17025 Clause 7.8.2.1(q) compliance
 */

import { SignPdf } from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { PDFDocument } from "pdf-lib";
import forge from "node-forge";
import { createHash } from "crypto";

import type {
  SigningOptions,
  SigningResult,
  SignatureMetadata,
  CertificateInfo,
} from "./types.js";
import { SigningError } from "./types.js";

/**
 * Parse a PKCS#12 file and extract certificate information
 */
export function parsePkcs12(
  p12Buffer: Buffer,
  password: string
): CertificateInfo {
  try {
    // Decode PKCS#12
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    // Extract certificate bags
    const certBagOid = forge.pki.oids.certBag as string;
    const certBags = p12.getBags({ bagType: certBagOid });
    const certBagList = certBags[certBagOid];
    if (!certBagList || certBagList.length === 0) {
      throw new SigningError(
        "No certificates found in PKCS#12 file",
        "INVALID_P12"
      );
    }

    // Extract key bags
    const keyBagOid = forge.pki.oids.pkcs8ShroudedKeyBag as string;
    const keyBags = p12.getBags({ bagType: keyBagOid });
    const keyBagList = keyBags[keyBagOid];
    if (!keyBagList || keyBagList.length === 0) {
      throw new SigningError(
        "No private key found in PKCS#12 file",
        "INVALID_P12"
      );
    }

    // Get the end-entity certificate (the one with the private key)
    const firstCertBag = certBagList[0];
    const firstKeyBag = keyBagList[0];
    if (!firstCertBag?.cert || !firstKeyBag?.key) {
      throw new SigningError(
        "Certificate or key not found in PKCS#12 file",
        "INVALID_P12"
      );
    }
    const cert = firstCertBag.cert;
    const privateKey = firstKeyBag.key;

    // Build certificate chain (excluding the end-entity)
    const chain = certBagList
      .slice(1)
      .map((bag: { cert?: forge.pki.Certificate }) => bag.cert!)
      .filter(Boolean);

    // Extract subject information - access the attributes array
    const subjectCn = extractCn(cert.subject.attributes);
    const issuerCn = extractCn(cert.issuer.attributes);
    const subjectCpfCnpj = extractCpfCnpj(cert.subject.attributes);

    return {
      serialNumber: cert.serialNumber,
      issuerCn,
      subjectCn,
      subjectCpfCnpj,
      validFrom: cert.validity.notBefore,
      validUntil: cert.validity.notAfter,
      certificate: cert,
      privateKey,
      chain,
    };
  } catch (error) {
    if (error instanceof SigningError) throw error;

    // Check for wrong password error
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (
      errorMsg.includes("Invalid password") ||
      errorMsg.includes("PKCS#12 MAC") ||
      errorMsg.includes("decryption")
    ) {
      throw new SigningError(
        "Senha do certificado inválida",
        "WRONG_PASSWORD"
      );
    }

    throw new SigningError(
      `Erro ao ler certificado PKCS#12: ${errorMsg}`,
      "INVALID_P12"
    );
  }
}

/**
 * Extract Common Name (CN) from certificate subject/issuer
 */
function extractCn(attributes: forge.pki.CertificateField[]): string {
  const cn = attributes.find((attr) => attr.shortName === "CN");
  return cn ? String(cn.value) : "Unknown";
}

/**
 * Extract CPF or CNPJ from certificate subject
 * ICP-Brasil certificates include CPF/CNPJ in specific OIDs
 */
function extractCpfCnpj(
  attributes: forge.pki.CertificateField[]
): string | null {
  // ICP-Brasil OIDs for CPF and CNPJ
  const OID_CPF = "2.16.76.1.3.1"; // OID for CPF in ICP-Brasil
  const OID_CNPJ = "2.16.76.1.3.3"; // OID for CNPJ in ICP-Brasil

  for (const attr of attributes) {
    if (attr.type === OID_CPF || attr.type === OID_CNPJ) {
      const value = String(attr.value);
      // CPF is typically in format: DDMMYYYYCPF (11 digits at end)
      // CNPJ is typically in format: DDMMYYYYCNPJ (14 digits at end)
      const match = value.match(/(\d{11}|\d{14})$/);
      if (match && match[1]) {
        return formatCpfCnpj(match[1]);
      }
    }
  }

  // Fallback: try to extract from CN
  const cn = extractCn(attributes);
  const cpfMatch = cn.match(/CPF[:\s]*(\d{11})/i);
  if (cpfMatch && cpfMatch[1]) return formatCpfCnpj(cpfMatch[1]);

  const cnpjMatch = cn.match(/CNPJ[:\s]*(\d{14})/i);
  if (cnpjMatch && cnpjMatch[1]) return formatCpfCnpj(cnpjMatch[1]);

  return null;
}

/**
 * Format CPF or CNPJ with punctuation
 */
function formatCpfCnpj(value: string): string {
  if (value.length === 11) {
    // CPF: 000.000.000-00
    return value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  } else if (value.length === 14) {
    // CNPJ: 00.000.000/0000-00
    return value.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5"
    );
  }
  return value;
}

/**
 * Validate certificate is within validity period
 */
export function validateCertificateValidity(certInfo: CertificateInfo): void {
  const now = new Date();

  if (now < certInfo.validFrom) {
    throw new SigningError(
      `Certificado ainda não é válido. Válido a partir de: ${certInfo.validFrom.toISOString()}`,
      "CERTIFICATE_NOT_YET_VALID"
    );
  }

  if (now > certInfo.validUntil) {
    throw new SigningError(
      `Certificado expirado em: ${certInfo.validUntil.toISOString()}`,
      "CERTIFICATE_EXPIRED"
    );
  }
}

/**
 * Calculate SHA-256 hash of a buffer
 */
function calculateSha256(buffer: Uint8Array | Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Sign a PDF document with an ICP-Brasil certificate
 *
 * @param pdfBuffer - The unsigned PDF as Uint8Array or Buffer
 * @param options - Signing options including certificate and password
 * @returns Signed PDF and signature metadata
 *
 * @example
 * ```typescript
 * const { signedPdf, metadata } = await signPdf(unsignedPdf, {
 *   p12Buffer: Buffer.from(encryptedP12, 'base64'),
 *   password: 'certificate-password',
 *   reason: 'Certificado de Calibracao',
 * });
 * ```
 */
export async function signPdf(
  pdfBuffer: Uint8Array | Buffer,
  options: SigningOptions
): Promise<SigningResult> {
  // 1. Parse and validate certificate
  const certInfo = parsePkcs12(options.p12Buffer, options.password);
  validateCertificateValidity(certInfo);

  // 2. Load PDF and add signature placeholder
  const pdfDoc = await PDFDocument.load(pdfBuffer);

  // Add signature placeholder with PAdES settings
  pdflibAddPlaceholder({
    pdfDoc,
    reason: options.reason || "Certificado de Calibracao",
    location: options.location || "Brasil",
    contactInfo: options.contactInfo || "",
    name: certInfo.subjectCn,
    // Placeholder size - needs to be large enough for the signature
    signatureLength: 8192,
  });

  // Save PDF with placeholder
  const pdfWithPlaceholder = await pdfDoc.save();

  // 3. Sign the PDF using P12Signer
  const signer = new P12Signer(options.p12Buffer, {
    passphrase: options.password,
  });

  const signPdfInstance = new SignPdf();
  const signedPdfBuffer = await signPdfInstance.sign(
    Buffer.from(pdfWithPlaceholder),
    signer
  );

  // 4. Calculate hash of signed PDF
  const pdfHash = calculateSha256(signedPdfBuffer);

  // 5. Build metadata
  const metadata: SignatureMetadata = {
    signedAt: new Date().toISOString(),
    signerCertificateSerial: certInfo.serialNumber,
    signerName: certInfo.subjectCn,
    signerCpfCnpj: certInfo.subjectCpfCnpj,
    pdfHash,
    ltvEnabled: options.enableLtv ?? false,
  };

  return {
    signedPdf: new Uint8Array(signedPdfBuffer),
    metadata,
  };
}

/**
 * Get certificate information without signing
 * Useful for displaying certificate details in UI
 */
export function getCertificateInfo(
  p12Buffer: Buffer,
  password: string
): Omit<CertificateInfo, "certificate" | "privateKey" | "chain"> {
  const info = parsePkcs12(p12Buffer, password);
  return {
    serialNumber: info.serialNumber,
    issuerCn: info.issuerCn,
    subjectCn: info.subjectCn,
    subjectCpfCnpj: info.subjectCpfCnpj,
    validFrom: info.validFrom,
    validUntil: info.validUntil,
  };
}
