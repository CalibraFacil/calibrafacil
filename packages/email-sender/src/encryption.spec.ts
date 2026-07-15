import { describe, expect, it } from "vitest";
import {
  decryptResendApiKey,
  encryptResendApiKey,
  generateEmailDomainMasterKey,
  maskResendApiKey,
  resendApiKeyLast4,
} from "./encryption";

describe("email-domain key custody (AES-256-GCM)", () => {
  const masterKey = generateEmailDomainMasterKey();

  it("round-trips a Resend API key", () => {
    const apiKey = "re_test_1234567890abcdef";
    const { encrypted, iv } = encryptResendApiKey(apiKey, masterKey);

    expect(encrypted).not.toContain(apiKey);
    expect(decryptResendApiKey(encrypted, iv, masterKey)).toBe(apiKey);
  });

  it("produces a fresh IV per encryption", () => {
    const a = encryptResendApiKey("re_same_key", masterKey);
    const b = encryptResendApiKey("re_same_key", masterKey);
    expect(a.iv).not.toBe(b.iv);
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it("fails to decrypt with a different master key (auth tag)", () => {
    const { encrypted, iv } = encryptResendApiKey("re_secret", masterKey);
    const otherKey = generateEmailDomainMasterKey();
    expect(() => decryptResendApiKey(encrypted, iv, otherKey)).toThrow();
  });

  it("rejects a master key that is not 256 bits", () => {
    const shortKey = Buffer.from("too-short").toString("base64");
    expect(() => encryptResendApiKey("re_secret", shortKey)).toThrow(
      /256 bits/,
    );
  });

  it("masks everything except the last 4 characters", () => {
    expect(maskResendApiKey("re_test_1234567890abcdef")).toBe("••••cdef");
    expect(resendApiKeyLast4("re_test_1234567890abcdef")).toBe("cdef");
  });
});
