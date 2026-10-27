import { describe, expect, it } from "vitest";
import { assertNoSecrets } from "./compliance-audit";

describe("REQ-B4A-4: the compliance audit never carries secret material", () => {
  it("accepts identifiers and settings, including the public KEK label", () => {
    expect(() =>
      assertNoSecrets({
        before: null,
        after: {
          serialNumber: "0A1B",
          validUntil: "2027-01-01T00:00:00.000Z",
          isDefault: true,
          isActive: true,
          kekId: "k2",
          accreditationNumber: "CAL 0123",
        },
      }),
    ).not.toThrow();
  });

  it("refuses a payload that names a P12, a password, a key or ciphertext, at any depth", () => {
    for (const payload of [
      { encryptedP12: "x" },
      { after: { password: "x" } },
      { after: { nested: [{ p12Base64: "x" }] } },
      { masterKey: "x" },
      { passwordIv: "x" },
      { encryptedPassword: "x" },
      { apiToken: "x" },
      { privateKey: "x" },
    ]) {
      expect(() => assertNoSecrets(payload), JSON.stringify(payload)).toThrow(
        /secret material/,
      );
    }
  });
});
