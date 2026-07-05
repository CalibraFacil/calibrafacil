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

  // ===========================================================================
  // DocTimeStamp handling (#646 / CMP-03, PAdES-T). A timestamped PDF carries a
  // SECOND signature field (SubFilter /ETSI.RFC3161) appended by incremental
  // update. Verification must (a) still verify the ORIGINAL document signature
  // — a naive lastIndexOf("/ByteRange") would grab the timestamp instead and
  // report the certificate as invalid — and (b) surface the timestamp.
  // ===========================================================================

  /**
   * Append a synthetic-but-well-formed DocTimeStamp increment to a signed PDF:
   * a /ETSI.RFC3161 signature dictionary with its own /ByteRange + /Contents.
   * The token bytes need not be a real TST for the selection tests — parsing
   * degrades to nulls — but the structure matches what pdf-rfc3161 writes.
   */
  function appendDocTimeStamp(pdf: Uint8Array, token: Buffer): Buffer {
    const base = Buffer.from(pdf);
    const hex = token.toString("hex");
    // Fixed-width ByteRange numbers so offsets are computable before writing:
    // [0 P Q 1] must bracket exactly the `<hex>` blob for extraction to accept
    // the candidate (a=0..P signed prefix, hex at [P, Q), one byte tail at Q).
    const pad = (n: number) => String(n).padStart(10, "0");
    const prefixFor = (p: number, q: number) =>
      `\n999 0 obj\n<< /Type /DocTimeStamp /Filter /Adobe.PPKLite ` +
      `/SubFilter /ETSI.RFC3161 /ByteRange [0 ${pad(p)} ${pad(q)} 1] /Contents `;
    const contentsStart =
      base.length + Buffer.byteLength(prefixFor(0, 0), "latin1");
    const contentsEnd = contentsStart + 1 + hex.length + 1; // "<" + hex + ">"
    const chunk =
      prefixFor(contentsStart, contentsEnd) + `<${hex}> >>\nendobj\n`;
    return Buffer.concat([base, Buffer.from(chunk, "latin1")]);
  }

  it("still verifies the ORIGINAL signature when a DocTimeStamp is appended (regression: lastIndexOf hazard)", async () => {
    const stamped = appendDocTimeStamp(signedPdf, Buffer.from([0x30, 0x03, 0x02, 0x01, 0x01]));

    const result = await verifyPdf(stamped, {
      trustAnchors: trustAnchorsFrom(root.cert),
    });

    // The document signature (not the RFC 3161 token) must be the one verified.
    expect(result.signaturePresent).toBe(true);
    expect(result.signatureCryptographicallyValid).toBe(true);
    expect(result.chainValid).toBe(true);
    expect(result.timestampPresent).toBe(true);
  });

  it("reports timestampPresent=false for a plain signed PDF", async () => {
    const result = await verifyPdf(signedPdf, {
      expectedSha256: pdfHash,
      trustAnchors: trustAnchorsFrom(root.cert),
    });
    expect(result.timestampPresent).toBe(false);
    expect(result.timestamp).toBeNull();
  });

  it("degrades gracefully when the timestamp token is unparseable (no throw, null details)", async () => {
    const stamped = appendDocTimeStamp(signedPdf, Buffer.from("garbage-token"));
    const result = await verifyPdf(stamped, {
      trustAnchors: trustAnchorsFrom(root.cert),
    });
    expect(result.timestampPresent).toBe(true);
    expect(result.timestamp?.time ?? null).toBeNull();
  });
});
