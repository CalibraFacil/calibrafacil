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
import {
  adjudicateRevocation,
  checkRevocation,
  extractCrlDistributionUrls,
  parseCrl,
} from "./revocation.js";

export type VerifyOverall =
  | "VALID"
  | "ALTERED"
  | "UNSIGNED"
  | "REVOKED"
  | "UNVERIFIABLE";

export interface VerifyPdfSigner {
  commonName: string | null;
  cpfCnpj: string | null;
  certificateSerial: string | null;
}

export interface VerifyPdfTimestamp {
  /** RFC 3161 genTime (ISO string) parsed from the timestamp token, when parseable. */
  time: string | null;
  /** Common Name of the TSA signer certificate embedded in the token, when present. */
  tsaCommonName: string | null;
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
  /** An RFC 3161 DocTimeStamp (SubFilter /ETSI.RFC3161) is embedded (#646, PAdES-T). */
  timestampPresent: boolean;
  /** A signed, issuer-verified CRL covering the signer cert was consulted (#646 fase b). */
  revocationChecked: boolean;
  /** Signer certificate revoked per the verified CRL. Null when unchecked. */
  certificateRevoked: boolean | null;
  /** RFC 5280 revocationDate (ISO) when revoked. */
  revocationTime: string | null;
  /** Parsed timestamp details (best-effort; null when absent or unparseable). */
  timestamp: VerifyPdfTimestamp | null;
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
  /**
   * Injected CRL fetcher (#646 fase b) — verifyPdf itself performs no network
   * I/O. Given a CRL Distribution Point URL from the signer chain, return the
   * DER bytes or null. Fetch failures degrade to `revocationChecked: false`.
   */
  fetchCrl?: (url: string) => Promise<Uint8Array | null>;
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
 * Parse ONE signature candidate at a given `/ByteRange` offset: the byte-range
 * segments and the hex `/Contents` blob between them. Returns `null` when the
 * structure at that offset is not a well-formed signature.
 */
function extractSignatureAt(
  pdf: Buffer,
  tag: number,
): ExtractedSignature | null {
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

interface ExtractedSignatures {
  /** The document (PAdES/CAdES) signature — the LAST non-timestamp candidate. */
  document: ExtractedSignature | null;
  /** Raw CMS bytes of any RFC 3161 DocTimeStamp tokens found. */
  timestampTokens: Buffer[];
}

/**
 * Walk EVERY `/ByteRange` in the PDF and split candidates into the document
 * signature vs RFC 3161 DocTimeStamps. A timestamped PDF (#646, PAdES-T)
 * carries the timestamp as a SECOND signature field appended by incremental
 * update — a naive `lastIndexOf("/ByteRange")` would grab the timestamp and
 * try to verify it as the document signature.
 *
 * A candidate is classified as a timestamp when its signature dictionary
 * (the window from the nearest `<<` before `/ByteRange` up to the tag)
 * mentions `ETSI.RFC3161` / `DocTimeStamp`. The window also extends a short
 * distance AFTER the tag to catch writers that order `/SubFilter` after
 * `/ByteRange`.
 */
function extractSignatures(pdf: Buffer): ExtractedSignatures {
  const candidates: Array<{
    extracted: ExtractedSignature;
    isTimestamp: boolean;
  }> = [];

  let tag = pdf.indexOf("/ByteRange");
  while (tag !== -1) {
    const extracted = extractSignatureAt(pdf, tag);
    if (extracted) {
      const dictStart = pdf.lastIndexOf("<<", tag);
      const windowStart =
        dictStart === -1 ? Math.max(0, tag - 2048) : dictStart;
      const windowEnd = Math.min(pdf.length, tag + 512);
      const window = pdf.toString("latin1", windowStart, windowEnd);
      const isTimestamp =
        window.includes("ETSI.RFC3161") || window.includes("DocTimeStamp");
      candidates.push({ extracted, isTimestamp });
    }
    tag = pdf.indexOf("/ByteRange", tag + 1);
  }

  const documents = candidates.filter((c) => !c.isTimestamp);
  const timestamps = candidates.filter((c) => c.isTimestamp);

  return {
    document: documents.at(-1)?.extracted ?? null,
    timestampTokens: timestamps.map((c) => c.extracted.signature),
  };
}

// id-ct-TSTInfo — the CMS eContentType of an RFC 3161 timestamp token.
const OID_TST_INFO = "1.2.840.113549.1.9.16.1.4";

/**
 * Best-effort parse of an RFC 3161 token: genTime from the TSTInfo and the
 * TSA certificate's CN. Returns nulls (never throws) on malformed input —
 * the verdict must always render.
 */
function parseTimestampToken(token: Buffer): VerifyPdfTimestamp {
  try {
    const asn1 = asn1js.fromBER(toArrayBuffer(token));
    if (asn1.offset === -1) return { time: null, tsaCommonName: null };

    const contentInfo = new pkijs.ContentInfo({ schema: asn1.result });
    const signedData = new pkijs.SignedData({ schema: contentInfo.content });

    let time: string | null = null;
    if (
      signedData.encapContentInfo.eContentType === OID_TST_INFO &&
      signedData.encapContentInfo.eContent
    ) {
      const inner = asn1js.fromBER(
        signedData.encapContentInfo.eContent.valueBlock.valueHexView,
      );
      if (inner.offset !== -1) {
        const tstInfo = new pkijs.TSTInfo({ schema: inner.result });
        time = tstInfo.genTime.toISOString();
      }
    }

    const tsaCert = (signedData.certificates ?? []).find(
      (candidate): candidate is pkijs.Certificate =>
        candidate instanceof pkijs.Certificate,
    );
    const tsaCommonName = tsaCert ? subjectAttribute(tsaCert, OID_CN) : null;

    return { time, tsaCommonName };
  } catch {
    return { time: null, tsaCommonName: null };
  }
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
  let timestampPresent = false;
  let timestamp: VerifyPdfTimestamp | null = null;
  let revocationChecked = false;
  let certificateRevoked: boolean | null = null;
  let revocationTime: string | null = null;
  let revocationOverride: "REVOKED" | null = null;

  try {
    const { document: extracted, timestampTokens } = extractSignatures(buffer);

    if (timestampTokens.length > 0) {
      timestampPresent = true;
      const firstToken = timestampTokens[0];
      timestamp = firstToken
        ? parseTimestampToken(firstToken)
        : { time: null, tsaCommonName: null };
      details.push(
        timestamp.time
          ? `Carimbo do tempo RFC 3161 presente (${timestamp.time}${timestamp.tsaCommonName ? `, TSA: ${timestamp.tsaCommonName}` : ""}).`
          : "Carimbo do tempo RFC 3161 presente.",
      );
    }

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

          // #646 fase b (REQ-CMP-LTV-002): consult revocation material via the
          // injected fetcher. Only a CRL whose issuer matches AND whose
          // signature verifies against the chain counts; anything else
          // degrades to revocationChecked=false (never a false REVOKED).
          //
          // Gated on chainValid deliberately: CDP URLs come from inside the
          // (possibly attacker-uploaded) PDF, so fetching them is only safe
          // once the cert provably chains to an ICP-Brasil anchor — then the
          // URLs are CA-controlled. It also makes revocation of an unchained
          // cert (already UNVERIFIABLE) a non-question. SSRF guard.
          if (options.fetchCrl && chainValid) {
            try {
              const urls = extractCrlDistributionUrls(signerCert);
              const fetched: Awaited<ReturnType<typeof parseCrl>>[] = [];
              for (const url of urls) {
                const der = await options.fetchCrl(url);
                if (der) fetched.push(parseCrl(der));
              }
              const crls = fetched.filter(
                (crl): crl is NonNullable<typeof crl> => crl !== null,
              );
              if (crls.length > 0) {
                const issuerCandidates = [...certs, ...anchors];
                const status = await checkRevocation(
                  signerCert,
                  crls,
                  issuerCandidates,
                );
                revocationChecked = status.checked;
                if (status.checked) {
                  certificateRevoked = status.revoked;
                  revocationTime = status.revocationTime;
                }
              }
              if (!revocationChecked) {
                details.push(
                  "Não foi possível consultar a lista de certificados revogados (LCR).",
                );
              } else if (certificateRevoked) {
                const adjudication = adjudicateRevocation({
                  revocationTime,
                  timestampTime: timestamp?.time ?? null,
                });
                revocationOverride = adjudication.overallOverride;
                details.push(adjudication.detail);
              } else {
                details.push(
                  "Certificado do assinante não consta na LCR consultada.",
                );
              }
            } catch {
              details.push(
                "Não foi possível consultar a lista de certificados revogados (LCR).",
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
  } else if (revocationOverride) {
    // #646 fase b: revoked without a timestamp proving the signature predates
    // the revocation. Takes precedence over VALID/UNVERIFIABLE — integrity
    // failures (ALTERED/UNSIGNED) above remain the stronger signal.
    overall = "REVOKED";
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
    timestampPresent,
    timestamp,
    revocationChecked,
    certificateRevoked,
    revocationTime,
    signer,
    overall,
    details,
  };
}
