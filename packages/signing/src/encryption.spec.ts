import { describe, it, expect } from "vitest";
import {
  decryptBinary,
  encryptPassword,
  decryptPassword,
  encryptBinary,
  generateMasterKey,
} from "./encryption";

describe("Password Encryption", () => {
  describe("generateMasterKey", () => {
    it("should generate a 44-character base64 string (256-bit key)", () => {
      const key = generateMasterKey();
      // 32 bytes = 44 characters in base64 (with padding)
      expect(key).toHaveLength(44);
      // Valid base64 characters
      expect(/^[A-Za-z0-9+/]+=*$/.test(key)).toBe(true);
    });

    it("should decode to 32 bytes (256 bits)", () => {
      const key = generateMasterKey();
      const decoded = Buffer.from(key, "base64");
      expect(decoded.length).toBe(32);
    });

    it("should generate unique keys each time", () => {
      const key1 = generateMasterKey();
      const key2 = generateMasterKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe("encryptPassword / decryptPassword", () => {
    const masterKey = generateMasterKey();

    it("should encrypt and decrypt a password correctly", () => {
      const originalPassword = "minha-senha-secreta-123";

      const { encryptedPassword, iv } = encryptPassword(
        originalPassword,
        masterKey,
      );
      const decryptedPassword = decryptPassword(
        encryptedPassword,
        iv,
        masterKey,
      );

      expect(decryptedPassword).toBe(originalPassword);
    });

    it("should produce different ciphertexts for the same password (different IVs)", () => {
      const password = "test-password";

      const result1 = encryptPassword(password, masterKey);
      const result2 = encryptPassword(password, masterKey);

      expect(result1.encryptedPassword).not.toBe(result2.encryptedPassword);
      expect(result1.iv).not.toBe(result2.iv);
    });

    it("should fail to decrypt with wrong master key", () => {
      const password = "secret-password";
      const wrongKey = generateMasterKey();

      const { encryptedPassword, iv } = encryptPassword(password, masterKey);

      expect(() => {
        decryptPassword(encryptedPassword, iv, wrongKey);
      }).toThrow();
    });

    it("should fail to decrypt with tampered IV", () => {
      const password = "secret-password";

      const { encryptedPassword } = encryptPassword(password, masterKey);
      // Generate a different valid base64 IV
      const tamperedIv = generateMasterKey().substring(0, 16); // Wrong IV

      expect(() => {
        decryptPassword(encryptedPassword, tamperedIv, masterKey);
      }).toThrow();
    });

    it("should handle empty password", () => {
      const emptyPassword = "";

      const { encryptedPassword, iv } = encryptPassword(
        emptyPassword,
        masterKey,
      );
      const decryptedPassword = decryptPassword(
        encryptedPassword,
        iv,
        masterKey,
      );

      expect(decryptedPassword).toBe(emptyPassword);
    });

    it("should handle special characters in password", () => {
      const specialPassword = "p@$$w0rd!#$%^&*()_+-=[]{}|;':\",./<>?`~";

      const { encryptedPassword, iv } = encryptPassword(
        specialPassword,
        masterKey,
      );
      const decryptedPassword = decryptPassword(
        encryptedPassword,
        iv,
        masterKey,
      );

      expect(decryptedPassword).toBe(specialPassword);
    });

    it("should handle unicode characters in password", () => {
      const unicodePassword = "senha123áéíóú日本語🔐";

      const { encryptedPassword, iv } = encryptPassword(
        unicodePassword,
        masterKey,
      );
      const decryptedPassword = decryptPassword(
        encryptedPassword,
        iv,
        masterKey,
      );

      expect(decryptedPassword).toBe(unicodePassword);
    });

    it("should handle long passwords", () => {
      const longPassword = "a".repeat(1000);

      const { encryptedPassword, iv } = encryptPassword(
        longPassword,
        masterKey,
      );
      const decryptedPassword = decryptPassword(
        encryptedPassword,
        iv,
        masterKey,
      );

      expect(decryptedPassword).toBe(longPassword);
    });

    it("should throw error for invalid master key length", () => {
      const invalidKey = "too-short";

      expect(() => {
        encryptPassword("password", invalidKey);
      }).toThrow("Master key must be 256 bits");
    });
  });
});

describe("Binary Encryption", () => {
  it("should encrypt and decrypt binary payloads", () => {
    const masterKey = generateMasterKey();
    const payload = Buffer.from("p12-binary-content", "utf8");

    const encrypted = encryptBinary(payload, masterKey);
    const decrypted = decryptBinary(encrypted, masterKey);

    expect(decrypted.equals(payload)).toBe(true);
  });

  it("should use versioned encrypted blob prefix", () => {
    const masterKey = generateMasterKey();
    const payload = Buffer.from("abc", "utf8");

    const encrypted = encryptBinary(payload, masterKey);

    expect(encrypted.startsWith("enc:v1:")).toBe(true);
  });

  it("should reject unsupported encrypted blob formats", () => {
    const masterKey = generateMasterKey();

    expect(() => decryptBinary("legacy-base64-value", masterKey)).toThrow(
      "Unsupported encrypted blob format",
    );
  });
});
