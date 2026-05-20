import { describe, it, expect } from "vitest";
import { SigningError } from "./types";

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
        expect((error as SigningError).code).toBe("INVALID_P12");
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
        expect((error as SigningError).code).toBe("INVALID_P12");
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
});
