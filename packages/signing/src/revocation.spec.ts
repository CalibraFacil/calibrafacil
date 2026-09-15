import { describe, it, expect, beforeAll } from "vitest";
import forge from "node-forge";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { PDFDocument } from "pdf-lib";

import { signPdf } from "./signer.js";
import { verifyPdf } from "./verify.js";
import { parsePemCertificates } from "./chain-validation.js";
import {
  adjudicateRevocation,
  checkRevocation,
  extractCrlDistributionUrls,
  parseCrl,
} from "./revocation.js";

/**
 * CRL revocation checking (#646 / CMP-03 fase b) against a self-generated
 * CA → leaf chain, a REAL pkijs-built-and-signed CRL and a really-signed PDF.
 * No network — the fetcher is injected per VerifyPdfOptions.fetchCrl.
 *
 * The "revoked AFTER a trusted timestamp stays VALID" branch is covered at the
 * pure-function level (adjudicateRevocation): exercising it end-to-end would
 * require a genuine RFC 3161 token with parseable genTime, which needs a TSA.
 */

const CDP_URL = "http://crl.test.example/ca.crl";
const PASSWORD = "test-pass";

let serial = 100;
function makeCertificate(
  commonName: string,
  issuer: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } | null,
  isCa: boolean,
  crlUrl?: string,
): { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(serial++);
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const subject = [{ name: "commonName", value: commonName }];
  cert.setSubject(subject);
  cert.setIssuer(issuer ? issuer.cert.subject.attributes : subject);

  const extensions: Record<string, unknown>[] = [
    { name: "basicConstraints", cA: isCa },
  ];
  if (crlUrl) {
    // Build the CRLDistributionPoints extension DER with pkijs and attach it
    // as a raw extension (forge has no first-class builder for 2.5.29.31).
    const points = new pkijs.CRLDistributionPoints({
      distributionPoints: [
        new pkijs.DistributionPoint({
          distributionPoint: [
            new pkijs.GeneralName({ type: 6, value: crlUrl }),
          ],
        }),
      ],
    });
    const der = points.toSchema().toBER(false);
    extensions.push({
      id: "2.5.29.31",
      critical: false,
      value: forge.util.createBuffer(new Uint8Array(der)).getBytes(),
    });
  }
  cert.setExtensions(extensions);
  cert.sign(issuer ? issuer.key : keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

function pkijsFrom(cert: forge.pki.Certificate): pkijs.Certificate {
  const parsed = parsePemCertificates(forge.pki.certificateToPem(cert));
  const first = parsed[0];
  if (!first) throw new Error("failed to parse test certificate");
  return first;
}

async function importSigningKey(
  key: forge.pki.rsa.PrivateKey,
): Promise<CryptoKey> {
  const rsaAsn1 = forge.pki.privateKeyToAsn1(key);
  const pkcs8 = forge.pki.wrapRsaPrivateKey(rsaAsn1);
  const der = forge.asn1.toDer(pkcs8).getBytes();
  const bytes = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i) & 0xff;
  // globalThis.crypto (not node:crypto webcrypto) — avoids the Node-webcrypto
  // vs DOM-CryptoKey type mismatch (same reason as chain-validation.ts).
  return globalThis.crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Build a real, signed CRL issued by `ca`, optionally revoking `revokedLeaf`. */
async function buildCrl(
  ca: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey },
  revokedLeaf: pkijs.Certificate | null,
  revocationDate = new Date("2026-07-01T00:00:00.000Z"),
): Promise<Uint8Array> {
  const caPkijs = pkijsFrom(ca.cert);
  const crl = new pkijs.CertificateRevocationList();
  crl.version = 1;
  crl.issuer = caPkijs.subject;
  crl.thisUpdate = new pkijs.Time({ type: 0, value: new Date() });
  if (revokedLeaf) {
    crl.revokedCertificates = [
      new pkijs.RevokedCertificate({
        userCertificate: revokedLeaf.serialNumber,
        revocationDate: new pkijs.Time({ type: 0, value: revocationDate }),
      }),
    ];
  }
  const signingKey = await importSigningKey(ca.key);
  await crl.sign(signingKey, "SHA-256");
  return new Uint8Array(crl.toSchema().toBER(false));
}

let root: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey };
let leaf: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey };
let leafPkijs: pkijs.Certificate;
let rootPkijs: pkijs.Certificate;
let signedPdf: Uint8Array;

beforeAll(async () => {
  root = makeCertificate("Revocation Test Root", null, true);
  leaf = makeCertificate("Revocation Test Signer", root, false, CDP_URL);
  leafPkijs = pkijsFrom(leaf.cert);
  rootPkijs = pkijsFrom(root.cert);

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    leaf.key,
    [leaf.cert, root.cert],
    PASSWORD,
    { algorithm: "3des" },
  );
  const p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");

  const doc = await PDFDocument.create();
  doc.addPage([320, 200]).drawText("Certificado - teste de revogacao");
  const unsigned = await doc.save();
  const result = await signPdf(Buffer.from(unsigned), {
    p12Buffer,
    password: PASSWORD,
  });
  signedPdf = result.signedPdf;
}, 60_000);

describe("extractCrlDistributionUrls", () => {
  it("extracts the HTTP CDP URL from the certificate extension", () => {
    expect(extractCrlDistributionUrls(leafPkijs)).toEqual([CDP_URL]);
  });

  it("returns [] for a certificate without the extension", () => {
    expect(extractCrlDistributionUrls(rootPkijs)).toEqual([]);
  });
});

describe("checkRevocation", () => {
  it("finds a revoked serial in a CRL signed by the real issuer", async () => {
    const crlDer = await buildCrl(root, leafPkijs);
    const crl = parseCrl(crlDer);
    expect(crl).not.toBeNull();
    if (!crl) return;

    const status = await checkRevocation(leafPkijs, [crl], [rootPkijs]);
    expect(status.checked).toBe(true);
    expect(status.revoked).toBe(true);
    expect(status.revocationTime).toBe("2026-07-01T00:00:00.000Z");
  });

  it("reports not-revoked when the serial is absent", async () => {
    const crlDer = await buildCrl(root, null);
    const crl = parseCrl(crlDer);
    if (!crl) throw new Error("crl parse failed");

    const status = await checkRevocation(leafPkijs, [crl], [rootPkijs]);
    expect(status.checked).toBe(true);
    expect(status.revoked).toBe(false);
    expect(status.revocationTime).toBeNull();
  });

  it("REJECTS an unauthenticated CRL — wrong signer never yields a verdict", async () => {
    // A forged CRL claiming the right issuer DN but signed by an UNRELATED key.
    const impostor = makeCertificate("Revocation Test Root", null, true);
    const crlDer = await buildCrl(impostor, leafPkijs);
    const crl = parseCrl(crlDer);
    if (!crl) throw new Error("crl parse failed");

    // Only the REAL root is a candidate — the impostor's signature must fail.
    const status = await checkRevocation(leafPkijs, [crl], [rootPkijs]);
    expect(status.checked).toBe(false);
    expect(status.revoked).toBe(false);
  });
});

describe("adjudicateRevocation (PAdES-T doctrine, pure)", () => {
  it("revoked AFTER a trusted timestamp => signature stays valid (no override)", () => {
    const result = adjudicateRevocation({
      revocationTime: "2026-07-02T00:00:00.000Z",
      timestampTime: "2026-07-01T00:00:00.000Z",
    });
    expect(result.overallOverride).toBeNull();
    expect(result.detail).toContain("APÓS o carimbo");
  });

  it("revoked BEFORE the timestamp => REVOKED", () => {
    const result = adjudicateRevocation({
      revocationTime: "2026-07-01T00:00:00.000Z",
      timestampTime: "2026-07-02T00:00:00.000Z",
    });
    expect(result.overallOverride).toBe("REVOKED");
  });

  it("revoked with NO timestamp => REVOKED (no proof of anteriority)", () => {
    const result = adjudicateRevocation({
      revocationTime: "2026-07-01T00:00:00.000Z",
      timestampTime: null,
    });
    expect(result.overallOverride).toBe("REVOKED");
    expect(result.detail).toContain("sem carimbo");
  });
});

describe("verifyPdf with injected fetchCrl (end-to-end)", () => {
  it("REQ-CMP-LTV-002: revoked signer => overall REVOKED + revocation fields", async () => {
    const crlDer = await buildCrl(root, leafPkijs);

    const result = await verifyPdf(signedPdf, {
      trustAnchors: [rootPkijs],
      fetchCrl: async (url) => (url === CDP_URL ? crlDer : null),
    });

    expect(result.revocationChecked).toBe(true);
    expect(result.certificateRevoked).toBe(true);
    expect(result.revocationTime).toBe("2026-07-01T00:00:00.000Z");
    expect(result.overall).toBe("REVOKED");
  });

  it("clean CRL => VALID with revocationChecked=true / revoked=false", async () => {
    const crlDer = await buildCrl(root, null);

    const result = await verifyPdf(signedPdf, {
      trustAnchors: [rootPkijs],
      fetchCrl: async () => crlDer,
    });

    expect(result.revocationChecked).toBe(true);
    expect(result.certificateRevoked).toBe(false);
    expect(result.overall).toBe("VALID");
  });

  it("fetcher failure degrades to revocationChecked=false without changing the verdict", async () => {
    const result = await verifyPdf(signedPdf, {
      trustAnchors: [rootPkijs],
      fetchCrl: async () => null,
    });

    expect(result.revocationChecked).toBe(false);
    expect(result.certificateRevoked).toBeNull();
    expect(result.overall).toBe("VALID");
    expect(
      result.details.some((line) =>
        line.includes("Não foi possível consultar"),
      ),
    ).toBe(true);
  });

  it("no fetcher configured => behavior identical to pre-fase-b (no revocation fields set)", async () => {
    const result = await verifyPdf(signedPdf, {
      trustAnchors: [rootPkijs],
    });

    expect(result.revocationChecked).toBe(false);
    expect(result.certificateRevoked).toBeNull();
    expect(result.overall).toBe("VALID");
  });

  it("SSRF guard: fetcher is NEVER called when the chain does not validate (attacker-supplied CDP)", async () => {
    const unrelated = makeCertificate("Unrelated Anchor", null, true);
    let called = 0;

    const result = await verifyPdf(signedPdf, {
      trustAnchors: [pkijsFrom(unrelated.cert)],
      fetchCrl: async () => {
        called += 1;
        return null;
      },
    });

    expect(called).toBe(0);
    expect(result.revocationChecked).toBe(false);
    expect(result.overall).toBe("UNVERIFIABLE");
  });
});
