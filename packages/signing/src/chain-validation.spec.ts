import { describe, it, expect, beforeAll } from "vitest";
import forge from "node-forge";

import {
  validateCertificateChain,
  parsePemCertificates,
  loadTrustStore,
} from "./chain-validation.js";
import { SigningError } from "./types.js";

/**
 * Deterministic chain-validation tests using a self-generated CA → leaf chain.
 * This proves the pkijs path-validation logic independently of the real
 * ICP-Brasil trust anchors (which only change *which* roots are trusted, not the
 * validation algorithm). No network required.
 */

let serial = 1;
function makeCertificate(
  commonName: string,
  issuer: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } | null,
  isCa: boolean,
  validity?: { notBefore: Date; notAfter: Date },
): { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(serial++);
  cert.validity.notBefore =
    validity?.notBefore ?? new Date(Date.now() - 86_400_000);
  cert.validity.notAfter =
    validity?.notAfter ?? new Date(Date.now() + 86_400_000);
  const subject = [{ name: "commonName", value: commonName }];
  cert.setSubject(subject);
  cert.setIssuer(issuer ? issuer.cert.subject.attributes : subject);
  cert.setExtensions([{ name: "basicConstraints", cA: isCa }]);
  cert.sign(issuer ? issuer.key : keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

let root: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey };
let leaf: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey };
let unrelatedRoot: {
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
};

beforeAll(() => {
  root = makeCertificate("Test ICP Root", null, true);
  leaf = makeCertificate("Test Signer", root, false);
  unrelatedRoot = makeCertificate("Unrelated Root", null, true);
}, 60_000);

function trustAnchorsFrom(cert: forge.pki.Certificate) {
  return parsePemCertificates(forge.pki.certificateToPem(cert));
}

describe("validateCertificateChain", () => {
  it("accepts a leaf that chains to a trusted anchor", async () => {
    const result = await validateCertificateChain(leaf.cert, {
      trustAnchors: trustAnchorsFrom(root.cert),
    });
    expect(result.valid).toBe(true);
    expect(result.errorCode).toBeUndefined();
  });

  it("rejects a leaf that does NOT chain to any trusted anchor", async () => {
    const result = await validateCertificateChain(leaf.cert, {
      trustAnchors: trustAnchorsFrom(unrelatedRoot.cert),
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("INVALID_CHAIN");
  });

  it("rejects a leaf outside its validity window", async () => {
    const result = await validateCertificateChain(leaf.cert, {
      trustAnchors: trustAnchorsFrom(root.cert),
      checkDate: new Date(Date.now() + 10 * 86_400_000), // after notAfter
    });
    expect(result.valid).toBe(false);
  });

  it("throws when no trust anchors are loaded", async () => {
    await expect(
      validateCertificateChain(leaf.cert, { trustAnchors: [] }),
    ).rejects.toBeInstanceOf(SigningError);
  });
});

describe("parsePemCertificates / loadTrustStore", () => {
  it("parses a multi-block PEM", () => {
    const pem =
      forge.pki.certificateToPem(root.cert) +
      forge.pki.certificateToPem(unrelatedRoot.cert);
    expect(parsePemCertificates(pem)).toHaveLength(2);
  });

  it("returns [] for a missing trust-store directory", () => {
    expect(loadTrustStore("/nonexistent/icp/trust/store")).toEqual([]);
  });
});
