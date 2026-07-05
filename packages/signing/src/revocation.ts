/**
 * CRL-based revocation checking (#646 / CMP-03 phase b, REQ-CMP-LTV-002).
 *
 * Pure helpers — NO network here. The caller (API verify route, worker
 * precompute) injects a fetcher; `verify.ts` extracts the CRL Distribution
 * Point URLs from the signer chain, fetches through the injected function,
 * and this module parses, authenticates (CRL must be signed by the cert's
 * issuer) and looks up the certificate.
 *
 * PAdES-T interaction (the point of phase a): a certificate revoked AFTER a
 * trusted RFC 3161 timestamp does NOT invalidate the signature — the stamp
 * proves the document was signed while the certificate was still good.
 * `adjudicateRevocation` encodes that decision as a pure function.
 */
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

// CRL Distribution Points extension (RFC 5280 §4.2.1.13).
const OID_CRL_DISTRIBUTION_POINTS = "2.5.29.31";
// GeneralName CHOICE tag for uniformResourceIdentifier.
const GENERAL_NAME_URI = 6;

/**
 * Extract HTTP(S) CRL Distribution Point URLs from a certificate. Returns []
 * (never throws) when the extension is absent or malformed.
 */
export function extractCrlDistributionUrls(cert: pkijs.Certificate): string[] {
  try {
    const extension = (cert.extensions ?? []).find(
      (ext) => ext.extnID === OID_CRL_DISTRIBUTION_POINTS,
    );
    if (!extension) return [];

    const parsed = asn1js.fromBER(extension.extnValue.valueBlock.valueHexView);
    if (parsed.offset === -1) return [];

    const points = new pkijs.CRLDistributionPoints({ schema: parsed.result });
    const urls: string[] = [];
    for (const point of points.distributionPoints) {
      const names = point.distributionPoint;
      if (!Array.isArray(names)) continue;
      for (const name of names) {
        if (
          name instanceof pkijs.GeneralName &&
          name.type === GENERAL_NAME_URI &&
          typeof name.value === "string" &&
          /^https?:\/\//i.test(name.value)
        ) {
          urls.push(name.value);
        }
      }
    }
    return urls;
  } catch {
    return [];
  }
}

/** Parse a DER-encoded CRL. Returns null (never throws) on malformed input. */
export function parseCrl(
  der: Uint8Array,
): pkijs.CertificateRevocationList | null {
  try {
    const buffer = new ArrayBuffer(der.byteLength);
    new Uint8Array(buffer).set(der);
    const asn1 = asn1js.fromBER(buffer);
    if (asn1.offset === -1) return null;
    return new pkijs.CertificateRevocationList({ schema: asn1.result });
  } catch {
    return null;
  }
}

export interface RevocationStatus {
  /** A CRL covering the certificate was obtained AND its signature verified. */
  checked: boolean;
  /** Whether the certificate's serial appears in a verified CRL. */
  revoked: boolean;
  /** RFC 5280 revocationDate (ISO string) when revoked. */
  revocationTime: string | null;
}

function crlIssuedBy(
  crl: pkijs.CertificateRevocationList,
  cert: pkijs.Certificate,
): boolean {
  // Compare the CRL's issuer DN with the candidate issuer's subject DN.
  return crl.issuer.isEqual(cert.subject);
}

/**
 * Check one certificate against pre-fetched CRLs. A CRL only counts when its
 * issuer DN matches the certificate's issuer AND its signature verifies
 * against one of the supplied issuer candidates (the chain certs + anchors) —
 * an unauthenticated CRL must never produce a verdict.
 */
export async function checkRevocation(
  cert: pkijs.Certificate,
  crls: pkijs.CertificateRevocationList[],
  issuerCandidates: pkijs.Certificate[],
): Promise<RevocationStatus> {
  for (const crl of crls) {
    // The CRL must claim to come from the cert's issuer…
    if (!crl.issuer.isEqual(cert.issuer)) continue;

    // …and actually be signed by a candidate whose subject is that issuer.
    const signer = issuerCandidates.find((candidate) =>
      crlIssuedBy(crl, candidate),
    );
    if (!signer) continue;

    let signatureOk = false;
    try {
      signatureOk = await crl.verify({ issuerCertificate: signer });
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) continue;

    const toHex = (view: Uint8Array) =>
      Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("");
    const certSerialHex = toHex(cert.serialNumber.valueBlock.valueHexView);
    const entry = (crl.revokedCertificates ?? []).find(
      (revoked) =>
        toHex(revoked.userCertificate.valueBlock.valueHexView) ===
        certSerialHex,
    );

    return {
      checked: true,
      revoked: entry !== undefined,
      revocationTime: entry
        ? entry.revocationDate.value.toISOString()
        : null,
    };
  }

  return { checked: false, revoked: false, revocationTime: null };
}

export interface RevocationAdjudication {
  /**
   * When non-null, the verdict's `overall` must become this value. Null means
   * revocation does not override the otherwise-computed overall.
   */
  overallOverride: "REVOKED" | null;
  /** pt-BR detail line for the verdict. */
  detail: string;
}

/**
 * PAdES doctrine, as a pure decision: a trusted RFC 3161 timestamp that
 * PRECEDES the revocation proves the signature was applied while the
 * certificate was still valid — the document stays trustworthy. Without that
 * proof (no stamp, unparseable stamp time, or revocation before the stamp)
 * the verdict is REVOKED.
 */
export function adjudicateRevocation(input: {
  revocationTime: string | null;
  timestampTime: string | null;
}): RevocationAdjudication {
  const { revocationTime, timestampTime } = input;

  if (timestampTime && revocationTime) {
    const stampedAt = Date.parse(timestampTime);
    const revokedAt = Date.parse(revocationTime);
    if (
      Number.isFinite(stampedAt) &&
      Number.isFinite(revokedAt) &&
      stampedAt < revokedAt
    ) {
      return {
        overallOverride: null,
        detail:
          `Certificado do assinante revogado em ${revocationTime}, ` +
          `APÓS o carimbo do tempo (${timestampTime}) — a assinatura permanece válida (PAdES-T).`,
      };
    }
  }

  return {
    overallOverride: "REVOKED",
    detail: revocationTime
      ? `Certificado do assinante revogado em ${revocationTime}${
          timestampTime
            ? " — anterior ao carimbo do tempo"
            : " — sem carimbo do tempo que comprove anterioridade da assinatura"
        }.`
      : "Certificado do assinante consta como revogado na LCR.",
  };
}
