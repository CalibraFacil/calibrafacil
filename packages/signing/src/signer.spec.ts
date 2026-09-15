import { describe, it, expect } from "vitest";
import forge from "node-forge";
import { SigningError } from "./types";

/**
 * Real-fixture helpers (same pattern as chain-validation.spec.ts): generate a
 * genuine self-signed certificate + PKCS#12 file via node-forge so the error
 * paths below are exercised by the actual `parsePkcs12` /
 * `validateCertificateValidity` production logic, not by constructing
 * `SigningError` directly.
 */
function makeSelfSignedCert(validity?: { notBefore: Date; notAfter: Date }): {
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
} {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore =
    validity?.notBefore ?? new Date(Date.now() - 86_400_000);
  cert.validity.notAfter =
    validity?.notAfter ?? new Date(Date.now() + 86_400_000);
  const subject = [{ name: "commonName", value: "Test Signer" }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

function makeP12Buffer(
  key: forge.pki.rsa.PrivateKey,
  cert: forge.pki.Certificate,
  password: string,
): Buffer {
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(key, cert, password, {
    algorithm: "3des",
  });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(der, "binary");
}

describe("PDF Signing", () => {
  describe("SigningError", () => {
    it("should create error with message and code", () => {
      const error = new SigningError("Invalid certificate file", "INVALID_P12");

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SigningError);
      expect(error.code).toBe("INVALID_P12");
      expect(error.message).toBe("Invalid certificate file");
      expect(error.name).toBe("SigningError");
    });

    it("should have correct error codes", () => {
      const invalidP12 = new SigningError("test", "INVALID_P12");
      const wrongPassword = new SigningError("test", "WRONG_PASSWORD");
      const expiredCert = new SigningError("test", "CERTIFICATE_EXPIRED");
      const signingFailed = new SigningError("test", "SIGNING_FAILED");

      expect(invalidP12.code).toBe("INVALID_P12");
      expect(wrongPassword.code).toBe("WRONG_PASSWORD");
      expect(expiredCert.code).toBe("CERTIFICATE_EXPIRED");
      expect(signingFailed.code).toBe("SIGNING_FAILED");
    });
  });

  describe("parsePkcs12", () => {
    it("should throw INVALID_P12 for empty buffer", async () => {
      const { parsePkcs12 } = await import("./signer");
      const emptyBuffer = Buffer.from([]);

      expect(() => parsePkcs12(emptyBuffer, "password")).toThrow(SigningError);
      try {
        parsePkcs12(emptyBuffer, "password");
      } catch (error) {
        expect(error).toBeInstanceOf(SigningError);
        if (!(error instanceof SigningError)) throw error;
        expect(error.code).toBe("INVALID_P12");
      }
    });

    it("should throw INVALID_P12 for invalid data", async () => {
      const { parsePkcs12 } = await import("./signer");
      const invalidBuffer = Buffer.from("not a valid pkcs12 file");

      expect(() => parsePkcs12(invalidBuffer, "password")).toThrow(
        SigningError,
      );
      try {
        parsePkcs12(invalidBuffer, "password");
      } catch (error) {
        expect(error).toBeInstanceOf(SigningError);
        if (!(error instanceof SigningError)) throw error;
        expect(error.code).toBe("INVALID_P12");
      }
    });
  });

  describe("getCertificateInfo", () => {
    it("should throw for invalid PKCS#12 data", async () => {
      const { getCertificateInfo } = await import("./signer");
      const invalidBuffer = Buffer.from("invalid data");

      expect(() => getCertificateInfo(invalidBuffer, "password")).toThrow(
        SigningError,
      );
    });
  });

  /**
   * Real error-path coverage (TST-02 / #668). These build genuine
   * certificates + PKCS#12 files via node-forge (same fixture pattern as
   * chain-validation.spec.ts) and drive the real `parsePkcs12` /
   * `validateCertificateValidity` production logic down each error branch,
   * instead of only asserting the `SigningError` constructor.
   */
  describe("real error paths (REQ-TST-SIG)", () => {
    it("REQ-TST-SIG-001: parsePkcs12 throws WRONG_PASSWORD for a real P12 opened with the wrong password", async () => {
      const { parsePkcs12 } = await import("./signer");
      const { cert, key } = makeSelfSignedCert();
      const p12Buffer = makeP12Buffer(key, cert, "correct-password");

      expect(() => parsePkcs12(p12Buffer, "totally-wrong-password")).toThrow(
        SigningError,
      );
      try {
        parsePkcs12(p12Buffer, "totally-wrong-password");
      } catch (error) {
        expect(error).toBeInstanceOf(SigningError);
        if (!(error instanceof SigningError)) throw error;
        expect(error.code).toBe("WRONG_PASSWORD");
      }
    });

    it("REQ-TST-SIG-002: validateCertificateValidity throws CERTIFICATE_EXPIRED for a real certificate past its validity window", async () => {
      const { parsePkcs12, validateCertificateValidity } =
        await import("./signer");
      const { cert, key } = makeSelfSignedCert({
        notBefore: new Date(Date.now() - 2 * 365 * 86_400_000),
        notAfter: new Date(Date.now() - 86_400_000), // expired yesterday
      });
      const p12Buffer = makeP12Buffer(key, cert, "password123");
      const certInfo = parsePkcs12(p12Buffer, "password123");

      expect(() => validateCertificateValidity(certInfo)).toThrow(SigningError);
      try {
        validateCertificateValidity(certInfo);
      } catch (error) {
        expect(error).toBeInstanceOf(SigningError);
        if (!(error instanceof SigningError)) throw error;
        expect(error.code).toBe("CERTIFICATE_EXPIRED");
      }
    });

    it("REQ-TST-SIG-002: validateCertificateValidity throws CERTIFICATE_NOT_YET_VALID for a real certificate before its validity window", async () => {
      const { parsePkcs12, validateCertificateValidity } =
        await import("./signer");
      const { cert, key } = makeSelfSignedCert({
        notBefore: new Date(Date.now() + 86_400_000), // starts tomorrow
        notAfter: new Date(Date.now() + 2 * 365 * 86_400_000),
      });
      const p12Buffer = makeP12Buffer(key, cert, "password123");
      const certInfo = parsePkcs12(p12Buffer, "password123");

      expect(() => validateCertificateValidity(certInfo)).toThrow(SigningError);
      try {
        validateCertificateValidity(certInfo);
      } catch (error) {
        expect(error).toBeInstanceOf(SigningError);
        if (!(error instanceof SigningError)) throw error;
        expect(error.code).toBe("CERTIFICATE_NOT_YET_VALID");
      }
    });

    it("REQ-TST-SIG-003: parsePkcs12 throws INVALID_P12 for a real P12 buffer corrupted after generation", async () => {
      const { parsePkcs12 } = await import("./signer");
      const { cert, key } = makeSelfSignedCert();
      const p12Buffer = makeP12Buffer(key, cert, "password123");
      // Truncate a genuinely valid P12 so the outer ASN.1/DER structure is
      // itself malformed (as opposed to an intact structure that merely
      // fails MAC/decryption) -- this must map to INVALID_P12, not
      // WRONG_PASSWORD.
      const corrupted = p12Buffer.subarray(0, p12Buffer.length - 20);

      expect(() => parsePkcs12(corrupted, "password123")).toThrow(SigningError);
      try {
        parsePkcs12(corrupted, "password123");
      } catch (error) {
        expect(error).toBeInstanceOf(SigningError);
        if (!(error instanceof SigningError)) throw error;
        expect(error.code).toBe("INVALID_P12");
      }
    });
  });
});
