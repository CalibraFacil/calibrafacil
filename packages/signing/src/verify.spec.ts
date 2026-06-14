import { describe, it, expect, beforeAll } from "vitest";
import forge from "node-forge";
import { PDFDocument } from "pdf-lib";

import { signPdf } from "./signer.js";
import { parsePemCertificates } from "./chain-validation.js";
import { verifyPdf } from "./verify.js";

/**
 * End-to-end signature verification against a self-generated CA → leaf chain and
 * a really-signed PDF. Proves verifyPdf independently of the real ICP-Brasil
 * anchors (which only change *which* roots are trusted, not the algorithm).
 * No network required.
 */

let serial = 1;
function makeCertificate(
  commonName: string,
  issuer: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } | null,
  isCa: boolean,
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
  cert.setExtensions([{ name: "basicConstraints", cA: isCa }]);
  cert.sign(issuer ? issuer.key : keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

const PASSWORD = "test-pass";
let root: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey };
let leaf: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey };
let p12Buffer: Buffer;
let signedPdf: Uint8Array;
let pdfHash: string;
let unsignedPdf: Uint8Array;

function trustAnchorsFrom(cert: forge.pki.Certificate) {
  return parsePemCertificates(forge.pki.certificateToPem(cert));
}

async function makeUnsignedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([320, 200]);
  page.drawText("Certificado de Calibracao - teste");
  return doc.save();
}

beforeAll(async () => {
  root = makeCertificate("Test ICP Root", null, true);
  leaf = makeCertificate("Test Signer", root, false);

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    leaf.key,
    [leaf.cert, root.cert],
    PASSWORD,
    { algorithm: "3des" },
  );
  p12Buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");

  unsignedPdf = await makeUnsignedPdf();
  const result = await signPdf(Buffer.from(unsignedPdf), {
    p12Buffer,
    password: PASSWORD,
  });
  signedPdf = result.signedPdf;
  pdfHash = result.metadata.pdfHash;
}, 60_000);

describe("verifyPdf", () => {
  it("returns VALID for a genuine, hash-matching signed PDF", async () => {
    const result = await verifyPdf(signedPdf, {
      expectedSha256: pdfHash,
      trustAnchors: trustAnchorsFrom(root.cert),
    });

    expect(result.signaturePresent).toBe(true);
    expect(result.hashMatch).toBe(true);
    expect(result.signatureCryptographicallyValid).toBe(true);
    expect(result.chainValid).toBe(true);
    expect(result.certNotExpiredAtCheckDate).toBe(true);
    expect(result.overall).toBe("VALID");
  });

  it("returns ALTERED when the document hash no longer matches", async () => {
    const tampered = Buffer.from(signedPdf);
    tampered[100] = (tampered[100] ?? 0) ^ 0xff;

    const result = await verifyPdf(tampered, {
      expectedSha256: pdfHash,
      trustAnchors: trustAnchorsFrom(root.cert),
    });

    expect(result.hashMatch).toBe(false);
    expect(result.overall).toBe("ALTERED");
  });

  it("returns UNSIGNED for a PDF without a signature", async () => {
    const result = await verifyPdf(unsignedPdf, {
      trustAnchors: trustAnchorsFrom(root.cert),
    });

    expect(result.signaturePresent).toBe(false);
    expect(result.overall).toBe("UNSIGNED");
  });

  it("returns UNVERIFIABLE when no trust anchors are available", async () => {
    const result = await verifyPdf(signedPdf, {
      expectedSha256: pdfHash,
      trustAnchors: [],
    });

    expect(result.signatureCryptographicallyValid).toBe(true);
    expect(result.chainValid).toBe(false);
    expect(result.overall).toBe("UNVERIFIABLE");
  });

  it("returns UNVERIFIABLE when the signer does not chain to the anchor", async () => {
    const unrelated = makeCertificate("Unrelated Root", null, true);
    const result = await verifyPdf(signedPdf, {
      expectedSha256: pdfHash,
      trustAnchors: trustAnchorsFrom(unrelated.cert),
    });

    expect(result.signatureCryptographicallyValid).toBe(true);
    expect(result.chainValid).toBe(false);
    expect(result.overall).toBe("UNVERIFIABLE");
  });

  it("never throws on a malformed PDF", async () => {
    const result = await verifyPdf(Buffer.from("not a pdf at all"), {
      trustAnchors: trustAnchorsFrom(root.cert),
    });
    expect(result.overall).toBe("UNSIGNED");
  });
});
