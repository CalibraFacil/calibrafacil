import { describe, expect, it } from "vitest";

import {
  APPROVAL_CODE_ALPHABET,
  APPROVAL_CODE_LENGTH,
  PUBLIC_TOKEN_DEFAULT_TTL_DAYS,
  PUBLIC_TOKEN_VALIDITY_GRACE_DAYS,
  computeDefaultPublicTokenExpiry,
  createServiceOrderApprovalCode,
  createServiceOrderPublicToken,
  hashServiceOrderApprovalCode,
  hashServiceOrderToken,
  normalizeApprovalCode,
} from "../service-order-workflow";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("computeDefaultPublicTokenExpiry (REQ-QPUB-001)", () => {
  const sentAt = new Date("2026-07-14T12:00:00.000Z");

  it("defaults to validUntil + grace days when the quote has a validity date", () => {
    const validUntil = new Date("2026-08-01T00:00:00.000Z");
    const expiry = computeDefaultPublicTokenExpiry({ validUntil, sentAt });
    expect(expiry.getTime()).toBe(
      validUntil.getTime() + PUBLIC_TOKEN_VALIDITY_GRACE_DAYS * DAY_MS,
    );
  });

  it("defaults to sentAt + 30 days when the quote has no validity date", () => {
    const expiry = computeDefaultPublicTokenExpiry({
      validUntil: null,
      sentAt,
    });
    expect(expiry.getTime()).toBe(
      sentAt.getTime() + PUBLIC_TOKEN_DEFAULT_TTL_DAYS * DAY_MS,
    );
    expect(PUBLIC_TOKEN_DEFAULT_TTL_DAYS).toBe(30);
  });

  it("uses a 7-day grace window past validUntil", () => {
    expect(PUBLIC_TOKEN_VALIDITY_GRACE_DAYS).toBe(7);
  });
});

describe("public access token generation (REQ-QPUB-002 regression)", () => {
  it("generates 256-bit tokens rendered as 64 lowercase hex chars", () => {
    const token = createServiceOrderPublicToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // 32 CSPRNG bytes → practically no chance of a collision between two calls
    expect(createServiceOrderPublicToken()).not.toBe(token);
  });

  it("hashes tokens with SHA-256 (hex) for at-rest storage", async () => {
    // Known SHA-256 vector: sha256("abc")
    expect(await hashServiceOrderToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const token = createServiceOrderPublicToken();
    const digest = await hashServiceOrderToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(token);
  });
});

describe("approval code generation (REQ-QPUB-010)", () => {
  it("uses the unambiguous alphabet (no 0/O/1/I/L) at length 8 across many samples", () => {
    expect(APPROVAL_CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    expect(APPROVAL_CODE_LENGTH).toBe(8);
    for (let i = 0; i < 500; i++) {
      const code = createServiceOrderApprovalCode();
      expect(code).toHaveLength(APPROVAL_CODE_LENGTH);
      for (const char of code) {
        expect(APPROVAL_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it("produces every alphabet character eventually (rejection sampling sanity)", () => {
    const seen = new Set<string>();
    for (
      let i = 0;
      i < 2000 && seen.size < APPROVAL_CODE_ALPHABET.length;
      i++
    ) {
      for (const char of createServiceOrderApprovalCode()) seen.add(char);
    }
    expect(seen.size).toBe(APPROVAL_CODE_ALPHABET.length);
  });
});

describe("normalizeApprovalCode", () => {
  it("uppercases and strips whitespace and hyphens", () => {
    expect(normalizeApprovalCode("k7wm 3p9a")).toBe("K7WM3P9A");
    expect(normalizeApprovalCode("K7WM-3P9A")).toBe("K7WM3P9A");
    expect(normalizeApprovalCode("  k7-wm 3p-9a  ")).toBe("K7WM3P9A");
  });
});

describe("hashServiceOrderApprovalCode (REQ-QPUB-011)", () => {
  it("is deterministic for the same code + pepper", async () => {
    const a = await hashServiceOrderApprovalCode("K7WM3P9A", "pepper-1");
    const b = await hashServiceOrderApprovalCode("K7WM3P9A", "pepper-1");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the pepper — a DB dump alone cannot verify guesses", async () => {
    const withPepper1 = await hashServiceOrderApprovalCode(
      "K7WM3P9A",
      "pepper-1",
    );
    const withPepper2 = await hashServiceOrderApprovalCode(
      "K7WM3P9A",
      "pepper-2",
    );
    expect(withPepper1).not.toBe(withPepper2);
    // and is NOT the plain unkeyed SHA-256 of the code
    expect(withPepper1).not.toBe(await hashServiceOrderToken("K7WM3P9A"));
  });

  it("changes with the code", async () => {
    const a = await hashServiceOrderApprovalCode("K7WM3P9A", "pepper-1");
    const b = await hashServiceOrderApprovalCode("K7WM3P9B", "pepper-1");
    expect(a).not.toBe(b);
  });
});
