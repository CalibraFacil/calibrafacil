import { describe, expect, it } from "vitest";
import {
  encryptBinary,
  encryptPassword,
  generateMasterKey,
} from "./encryption.js";
import {
  CREDENTIAL_FORMAT_ENVELOPE,
  CREDENTIAL_FORMAT_LEGACY,
  ENVELOPE_PASSWORD_IV_PLACEHOLDER,
  createSigningKeyring,
  credentialNeedsRewrap,
  openSigningCredential,
  sealSigningCredential,
  signingKeyringFromEnv,
  type SigningCredentialBinding,
  type StoredSigningCredential,
} from "./envelope.js";

const BINDING: SigningCredentialBinding = {
  organizationId: "org-a",
  unitId: 7,
  serialNumber: "0A1B2C",
};

const P12 = Buffer.from("not-a-real-p12-but-binary-\u0000\u0001\u0002", "utf8");
const PASSWORD = "s3nha-do-certificado";

function stored(
  sealed: ReturnType<typeof sealSigningCredential>,
): StoredSigningCredential {
  return {
    encryptedP12: sealed.encryptedP12,
    encryptedPassword: sealed.encryptedPassword,
    passwordIv: sealed.passwordIv,
    kekId: sealed.kekId,
    formatVersion: sealed.formatVersion,
  };
}

function parts(blob: string): string[] {
  return blob.split(":");
}

function legacyRow(masterKey: string): StoredSigningCredential {
  const { encryptedPassword, iv } = encryptPassword(PASSWORD, masterKey);
  return {
    encryptedP12: encryptBinary(P12, masterKey),
    encryptedPassword,
    passwordIv: iv,
    kekId: null,
    formatVersion: CREDENTIAL_FORMAT_LEGACY,
  };
}

describe("REQ-B4A-1: envelope encryption of the signing credential", () => {
  const keyV1 = generateMasterKey();
  const ring = createSigningKeyring({ currentKey: keyV1, currentId: "k1" });

  it("seals the P12 and the password under a data key wrapped by the KEK, and opens them again", () => {
    const sealed = sealSigningCredential(
      { p12: P12, password: PASSWORD },
      BINDING,
      ring,
    );

    expect(sealed.formatVersion).toBe(CREDENTIAL_FORMAT_ENVELOPE);
    expect(sealed.kekId).toBe("k1");
    expect(sealed.passwordIv).toBe(ENVELOPE_PASSWORD_IV_PLACEHOLDER);
    expect(sealed.encryptedP12.startsWith("enc:v2:k1:")).toBe(true);
    expect(sealed.encryptedPassword.startsWith("enc:v2:k1:")).toBe(true);
    // No plaintext on the record.
    expect(sealed.encryptedPassword).not.toContain(PASSWORD);
    expect(sealed.encryptedP12).not.toContain(P12.toString("base64"));

    const opened = openSigningCredential(stored(sealed), BINDING, ring);
    expect(opened.password).toBe(PASSWORD);
    expect(opened.p12.equals(P12)).toBe(true);
    expect(opened.format).toBe(CREDENTIAL_FORMAT_ENVELOPE);
  });

  it("uses a fresh data key per credential and per field: two seals of the same input share nothing", () => {
    const a = sealSigningCredential(
      { p12: P12, password: PASSWORD },
      BINDING,
      ring,
    );
    const b = sealSigningCredential(
      { p12: P12, password: PASSWORD },
      BINDING,
      ring,
    );
    // enc : v2 : kekId : wrapped : data
    expect(parts(a.encryptedP12)[3]).not.toBe(parts(b.encryptedP12)[3]);
    expect(parts(a.encryptedP12)[4]).not.toBe(parts(b.encryptedP12)[4]);
    expect(parts(a.encryptedP12)[3]).not.toBe(parts(a.encryptedPassword)[3]);
  });

  it("REQ-B4A-1: opening with another organization's AAD fails", () => {
    const sealed = sealSigningCredential(
      { p12: P12, password: PASSWORD },
      BINDING,
      ring,
    );
    expect(() =>
      openSigningCredential(
        stored(sealed),
        { ...BINDING, organizationId: "org-b" },
        ring,
      ),
    ).toThrow();
  });

  it("REQ-B4A-1: opening with another unit's AAD fails", () => {
    const sealed = sealSigningCredential(
      { p12: P12, password: PASSWORD },
      BINDING,
      ring,
    );
    expect(() =>
      openSigningCredential(stored(sealed), { ...BINDING, unitId: 8 }, ring),
    ).toThrow();
  });

  it("REQ-B4A-1: opening with another certificate serial's AAD fails", () => {
    const sealed = sealSigningCredential(
      { p12: P12, password: PASSWORD },
      BINDING,
      ring,
    );
    expect(() =>
      openSigningCredential(
        stored(sealed),
        { ...BINDING, serialNumber: "FFFF" },
        ring,
      ),
    ).toThrow();
  });

  it("a tampered ciphertext fails; the P12 and password blobs cannot be swapped", () => {
    const sealed = sealSigningCredential(
      { p12: P12, password: PASSWORD },
      BINDING,
      ring,
    );
    const swapped = stored({
      ...sealed,
      encryptedP12: sealed.encryptedPassword,
      encryptedPassword: sealed.encryptedP12,
    });
    expect(() => openSigningCredential(swapped, BINDING, ring)).toThrow();

    const tail = sealed.encryptedP12.slice(-6);
    const flipped = tail.startsWith("A") ? "B" : "A";
    const tampered = stored({
      ...sealed,
      encryptedP12: sealed.encryptedP12.slice(0, -6) + flipped + tail.slice(1),
    });
    expect(() => openSigningCredential(tampered, BINDING, ring)).toThrow();
  });

  it("REQ-B4A-1: a legacy row (enc:v1 + separate IV, no kek id) still decrypts, flagged as legacy", () => {
    const row = legacyRow(keyV1);
    const opened = openSigningCredential(row, BINDING, ring);
    expect(opened.password).toBe(PASSWORD);
    expect(opened.p12.equals(P12)).toBe(true);
    expect(opened.format).toBe(CREDENTIAL_FORMAT_LEGACY);
  });

  it("REQ-B4A-1: KEK rotation: rows under the previous key decrypt while the current key is new, legacy included", () => {
    const keyV2 = generateMasterKey();
    const rotated = createSigningKeyring({
      currentKey: keyV2,
      currentId: "k2",
      previous: `k1:${keyV1}`,
    });

    // v2 row sealed under k1 (before the rotation)
    const underK1 = sealSigningCredential(
      { p12: P12, password: PASSWORD },
      BINDING,
      ring,
    );
    expect(
      openSigningCredential(stored(underK1), BINDING, rotated).password,
    ).toBe(PASSWORD);

    // legacy row encrypted with the old master key
    expect(
      openSigningCredential(legacyRow(keyV1), BINDING, rotated).password,
    ).toBe(PASSWORD);

    // new seals use the current KEK
    const underK2 = sealSigningCredential(
      { p12: P12, password: PASSWORD },
      BINDING,
      rotated,
    );
    expect(underK2.kekId).toBe("k2");
    expect(underK2.encryptedP12.startsWith("enc:v2:k2:")).toBe(true);
    // ...and the old keyring (without k2) cannot open them
    expect(() => openSigningCredential(stored(underK2), BINDING, ring)).toThrow(
      /k2/,
    );
  });

  it("a KEK that was dropped from the keyring fails with the key id, not with garbage", () => {
    const keyV2 = generateMasterKey();
    const onlyV2 = createSigningKeyring({ currentKey: keyV2, currentId: "k2" });
    const underK1 = sealSigningCredential(
      { p12: P12, password: PASSWORD },
      BINDING,
      ring,
    );
    expect(() =>
      openSigningCredential(stored(underK1), BINDING, onlyV2),
    ).toThrow(/k1/);
  });

  it("credentialNeedsRewrap: legacy and previous-KEK rows need it; a current-KEK row does not", () => {
    const keyV2 = generateMasterKey();
    const rotated = createSigningKeyring({
      currentKey: keyV2,
      currentId: "k2",
      previous: `k1:${keyV1}`,
    });
    const underK1 = stored(
      sealSigningCredential({ p12: P12, password: PASSWORD }, BINDING, ring),
    );
    const underK2 = stored(
      sealSigningCredential({ p12: P12, password: PASSWORD }, BINDING, rotated),
    );
    expect(credentialNeedsRewrap(legacyRow(keyV1), rotated)).toBe(true);
    expect(credentialNeedsRewrap(underK1, rotated)).toBe(true);
    expect(credentialNeedsRewrap(underK2, rotated)).toBe(false);
  });
});

describe("signing keyring configuration", () => {
  const keyA = generateMasterKey();
  const keyB = generateMasterKey();

  it("defaults the current id to k1 and accepts a comma-separated previous list", () => {
    const ring = signingKeyringFromEnv({
      SIGNING_MASTER_KEY: keyA,
      SIGNING_MASTER_KEY_PREVIOUS: `old1:${keyB}, old2:${generateMasterKey()}`,
    });
    expect(ring?.currentId).toBe("k1");
    expect([...(ring?.keys.keys() ?? [])].toSorted()).toEqual([
      "k1",
      "old1",
      "old2",
    ]);
  });

  it("returns null when no master key is configured", () => {
    expect(signingKeyringFromEnv({})).toBeNull();
  });

  it("rejects a duplicated id, an id equal to the current one with another key, a malformed entry and a short key", () => {
    expect(() =>
      createSigningKeyring({
        currentKey: keyA,
        currentId: "k2",
        previous: `k1:${keyB},k1:${keyB}`,
      }),
    ).toThrow(/k1/);
    expect(() =>
      createSigningKeyring({
        currentKey: keyA,
        currentId: "k2",
        previous: `k2:${keyB}`,
      }),
    ).toThrow(/k2/);
    expect(() =>
      createSigningKeyring({
        currentKey: keyA,
        previous: `no-separator`,
      }),
    ).toThrow();
    expect(() =>
      createSigningKeyring({
        currentKey: keyA,
        previous: `k0:${Buffer.alloc(8).toString("base64")}`,
      }),
    ).toThrow(/256/);
    expect(() =>
      createSigningKeyring({ currentKey: keyA, currentId: "bad:id" }),
    ).toThrow();
  });
});
