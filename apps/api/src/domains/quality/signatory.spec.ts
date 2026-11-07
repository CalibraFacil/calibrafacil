import { describe, it, expect } from "vitest";

import { isAuthorizedToSign } from "./signatory.js";

const now = new Date("2026-06-03T00:00:00.000Z");
const future = new Date("2027-01-01T00:00:00.000Z");
const past = new Date("2026-01-01T00:00:00.000Z");

describe("isAuthorizedToSign", () => {
  it("an org-wide authorization (null scope) covers any asset type", () => {
    const recs = [{ assetTypeId: null, expiresAt: null }];
    expect(isAuthorizedToSign(recs, 7, now)).toBe(true);
    expect(isAuthorizedToSign(recs, null, now)).toBe(true);
  });

  it("a scoped authorization covers only its asset type", () => {
    const recs = [{ assetTypeId: 7, expiresAt: null }];
    expect(isAuthorizedToSign(recs, 7, now)).toBe(true);
    expect(isAuthorizedToSign(recs, 9, now)).toBe(false);
    expect(isAuthorizedToSign(recs, null, now)).toBe(false);
  });

  it("an expired authorization never counts", () => {
    expect(
      isAuthorizedToSign([{ assetTypeId: 7, expiresAt: past }], 7, now),
    ).toBe(false);
    expect(
      isAuthorizedToSign([{ assetTypeId: null, expiresAt: past }], 7, now),
    ).toBe(false);
  });

  it("a future expiry still counts", () => {
    expect(
      isAuthorizedToSign([{ assetTypeId: 7, expiresAt: future }], 7, now),
    ).toBe(true);
  });

  it("no records means not authorized", () => {
    expect(isAuthorizedToSign([], 7, now)).toBe(false);
  });
});
