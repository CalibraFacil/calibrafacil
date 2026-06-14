/**
 * Public PDF signature verification (PAdES / ISO 17025 §7.8.2.1(q)).
 *
 * Extracts the embedded PAdES/PKCS#7 signature from a signed PDF, verifies the
 * CMS signature over the `/ByteRange`-covered bytes (pkijs SignedData), compares
 * the document SHA-256 to the hash recorded at issue time, and validates the
 * signer certificate's path to the ICP-Brasil trust anchors.
 *
 * Pure (no DB / R2 / network); **never throws** — any parse or crypto failure
 * degrades to a structured verdict so the public verification page can always
 * render a clear status instead of a 500.
 */
import { createHash } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

import { validatePkijsChain } from "./chain-validation.js";

export type VerifyOverall = "VALID" | "ALTERED" | "UNSIGNED" | "UNVERIFIABLE";

export interface VerifyPdfSigner {
  commonName: string | null;
  cpfCnpj: string | null;
  certificateSerial: string | null;
}

export interface VerifyPdfResult {
  /** Whole-document SHA-256 matches the hash recorded at issue. `null` when no expected hash was supplied. */
  hashMatch: boolean | null;
  /** The embedded CMS signature verifies over the signed byte range. */
  signatureCryptographicallyValid: boolean;
  /** The signer certificate path-validates against the supplied trust anchors. */
  chainValid: boolean;
  /** Convenience alias of `chainValid` when the anchors are the ICP-Brasil roots. */
  signerChainsToIcpRoot: boolean;
  /** The signer certificate is within its validity window at `checkDate`. */
  certNotExpiredAtCheckDate: boolean;
  /** A signature object was found and parsed in the PDF. */
  signaturePresent: boolean;
  signer: VerifyPdfSigner;
  overall: VerifyOverall;
  /** pt-BR diagnostic lines for the UI / audit log. */
  details: string[];
}

export interface VerifyPdfOptions {
  /** SHA-256 (hex) recorded at signing time (`signatureMetadata.pdfHash`). */
  expectedSha256?: string | null;
  /** ICP-Brasil trust anchors; an empty array means the chain cannot be verified. */
  trustAnchors?: pkijs.Certificate[];
  /** Reference time for validity / chain checks (default: now). */
  checkDate?: Date;
}

// ICP-Brasil subject OIDs for CPF / CNPJ (see signer.ts).
const OID_CN = "2.5.4.3";
const OID_CPF = "2.16.76.1.3.1";
const OID_CNPJ = "2.16.76.1.3.3";

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}

interface ExtractedSignature {
  /** The bytes covered by the signature (the two /ByteRange segments, concatenated). */
  signedContent: Buffer;
  /** The DER-encoded PKCS#7 / CMS signature object. */
  signature: Buffer;
}

/**
 * Pull the PAdES signature out of a signed PDF using its `/ByteRange` and the
 * hex `/Contents` blob between the two byte-range segments. Returns `null` for
 * an unsigned PDF (no `/ByteRange`).
 */
function extractSignature(pdf: Buffer): ExtractedSignature | null {
  const tag = pdf.lastIndexOf("/ByteRange");
  if (tag === -1) return null;

  const open = pdf.indexOf(0x5b /* [ */, tag);
  const close = pdf.indexOf(0x5d /* ] */, open);
  if (open === -1 || close === -1) return null;

  const nums = pdf
    .toString("latin1", open + 1, close)
    .trim()
    .split(/\s+/)
    .map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isInteger(n) || n < 0)) {
    return null;
  }
  const [a, b, c, d] = nums;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined
  ) {
    return null;
  }

  const signedContent = Buffer.concat([
    pdf.subarray(a, a + b),
    pdf.subarray(c, c + d),
  ]);

  // Between the two segments sits the signature as `<hex…>` (zero-padded to the
  // placeholder length). The trailing zero padding is ignored by the ASN.1 parser.
  const hex = pdf
    .toString("latin1", a + b, c)
    .trim()
    .replace(/^</, "")
    .replace(/>$/, "")
    .trim();
  if (!hex) return null;

  const signature = Buffer.from(hex, "hex");
  if (signature.length === 0) return null;

  return { signedContent, signature };
}

/** Read pkijs/extendedMode verify output (which can be a boolean, a result object, or a rejection). */
function readVerification(value: unknown): {
  verified: boolean;
  signerCert: pkijs.Certificate | null;
} {
  if (typeof value === "boolean") {
    return { verified: value, signerCert: null };
  }
  if (value && typeof value === "object") {
    const verified =
      "signatureVerified" in value && value.signatureVerified === true;
    let signerCert: pkijs.Certificate | null = null;
    if (
      "signerCertificate" in value &&
      value.signerCertificate instanceof pkijs.Certificate
    ) {
      signerCert = value.signerCertificate;
    }
    return { verified, signerCert };
  }
  return { verified: false, signerCert: null };
}

function subjectAttribute(cert: pkijs.Certificate, oid: string): string | null {
  for (const typeAndValue of cert.subject.typesAndValues) {
    if (typeAndValue.type === oid) {
      const value = typeAndValue.value.valueBlock.value;
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return null;
}

function serialHex(cert: pkijs.Certificate): string | null {
  const bytes = cert.serialNumber.valueBlock.valueHexView;
  if (!bytes || bytes.length === 0) return null;
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

function emptySigner(): VerifyPdfSigner {
  return { commonName: null, cpfCnpj: null, certificateSerial: null };
}

export async function verifyPdf(
  pdf: Uint8Array | Buffer,
  options: VerifyPdfOptions = {},
): Promise<VerifyPdfResult> {
  const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  const checkDate = options.checkDate ?? new Date();
  const anchors = options.trustAnchors ?? [];
  const details: string[] = [];

  const hashMatch =
    options.expectedSha256 != null
      ? sha256Hex(buffer).toLowerCase() === options.expectedSha256.toLowerCase()
      : null;
  if (hashMatch === false) {
    details.push("O conteúdo do PDF não corresponde ao registro de emissão.");
  }

  let signaturePresent = false;
  let signatureCryptographicallyValid = false;
  let chainValid = false;
  let certNotExpiredAtCheckDate = false;
  let signer = emptySigner();

  try {
    const extracted = extractSignature(buffer);
    if (extracted) {
      signaturePresent = true;

      const asn1 = asn1js.fromBER(toArrayBuffer(extracted.signature));
      if (asn1.offset !== -1) {
        const contentInfo = new pkijs.ContentInfo({ schema: asn1.result });
        const signedData = new pkijs.SignedData({
          schema: contentInfo.content,
        });
        const certs = (signedData.certificates ?? []).filter(
          (candidate): candidate is pkijs.Certificate =>
            candidate instanceof pkijs.Certificate,
        );

        let parsed: { verified: boolean; signerCert: pkijs.Certificate | null };
        try {
          const result = await signedData.verify({
            signer: 0,
            data: toArrayBuffer(extracted.signedContent),
            checkChain: false,
            extendedMode: true,
          });
          parsed = readVerification(result);
        } catch (verifyError) {
          parsed = readVerification(verifyError);
        }
        signatureCryptographicallyValid = parsed.verified;

        const signerCert = parsed.signerCert ?? certs[0] ?? null;
        if (signerCert) {
          signer = {
            commonName: subjectAttribute(signerCert, OID_CN),
            cpfCnpj:
              subjectAttribute(signerCert, OID_CPF) ??
              subjectAttribute(signerCert, OID_CNPJ),
            certificateSerial: serialHex(signerCert),
          };

          const notBefore = signerCert.notBefore.value;
          const notAfter = signerCert.notAfter.value;
          certNotExpiredAtCheckDate =
            checkDate >= notBefore && checkDate <= notAfter;

          if (anchors.length > 0) {
            const intermediates = certs.filter(
              (candidate) => candidate !== signerCert,
            );
            try {
              const chain = await validatePkijsChain(signerCert, {
                trustAnchors: anchors,
                intermediates,
                checkDate,
              });
              chainValid = chain.valid;
              if (!chain.valid && chain.message) details.push(chain.message);
            } catch (chainError) {
              details.push(
                chainError instanceof Error
                  ? chainError.message
                  : "Falha ao validar a cadeia de certificação.",
              );
            }
          }
        }
      } else {
        details.push("Não foi possível interpretar a assinatura embutida.");
      }
    }
  } catch (error) {
    details.push(
      error instanceof Error
        ? `Erro ao verificar a assinatura: ${error.message}`
        : "Erro desconhecido ao verificar a assinatura.",
    );
  }

  let overall: VerifyOverall;
  if (!signaturePresent) {
    overall = "UNSIGNED";
  } else if (hashMatch === false || !signatureCryptographicallyValid) {
    overall = "ALTERED";
  } else if (anchors.length === 0) {
    overall = "UNVERIFIABLE";
  } else if (chainValid) {
    overall = "VALID";
  } else {
    overall = "UNVERIFIABLE";
  }

  return {
    hashMatch,
    signatureCryptographicallyValid,
    chainValid,
    signerChainsToIcpRoot: chainValid,
    certNotExpiredAtCheckDate,
    signaturePresent,
    signer,
    overall,
    details,
  };
}
