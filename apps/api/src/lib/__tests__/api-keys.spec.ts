import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createApiKeySecret,
  extractApiKeyFromRequest,
  hashApiKey,
  safeEqualHash,
} from "../api-keys";

// REQ-APIKEY-001: key begins with "cf_live_" and keyPrefix is the first 15 chars
describe("createApiKeySecret — prefix and keyPrefix", () => {
  it("REQ-APIKEY-001: key starts with 'cf_live_' and keyPrefix equals key.slice(0, 15)", () => {
    const { key, keyPrefix } = createApiKeySecret();
    expect(key.startsWith("cf_live_")).toBe(true);
    expect(keyPrefix).toBe(key.slice(0, 15));
    // sanity: the prefix itself must begin with "cf_live_"
    expect(keyPrefix.startsWith("cf_live")).toBe(true);
  });
});

// REQ-APIKEY-002: keyHash equals hashApiKey(key)
describe("createApiKeySecret — keyHash consistency", () => {
  it("REQ-APIKEY-002: keyHash matches hashApiKey(key)", () => {
    const { key, keyHash } = createApiKeySecret();
    expect(keyHash).toBe(hashApiKey(key));
  });
});

// REQ-APIKEY-003: hashApiKey returns lowercase 64-char SHA-256 hex
//   Verified against an independently-computed reference using node:crypto.
describe("hashApiKey — known-vector SHA-256 digest", () => {
  it("REQ-APIKEY-003: returns the correct lowercase 64-char hex digest for 'cf_live_x'", () => {
    const input = "cf_live_x";
    const expected = createHash("sha256").update(input).digest("hex");
    // Sanity-check the independent computation: 64 lower-hex chars
    expect(expected).toHaveLength(64);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);

    const result = hashApiKey(input);
    expect(result).toBe(expected);
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("REQ-APIKEY-003: additional vector — empty string", () => {
    const expected = createHash("sha256").update("").digest("hex");
    expect(hashApiKey("")).toBe(expected);
  });
});

// REQ-APIKEY-004: two calls return distinct keys (randomness present)
describe("createApiKeySecret — randomness", () => {
  it("REQ-APIKEY-004: successive calls produce different keys", () => {
    const a = createApiKeySecret();
    const b = createApiKeySecret();
    expect(a.key).not.toBe(b.key);
  });
});

// REQ-APIKEY-005 / REQ-APIKEY-006: safeEqualHash timing-safe comparison
describe("safeEqualHash", () => {
  it("REQ-APIKEY-005: returns true for two equal strings", () => {
    const h = hashApiKey("some-key-value");
    expect(safeEqualHash(h, h)).toBe(true);
  });

  it("REQ-APIKEY-005: returns false for two different equal-length strings", () => {
    // SHA-256 hashes are always 64 chars, so same-length is guaranteed here
    const h1 = hashApiKey("key-a");
    const h2 = hashApiKey("key-b");
    // Confirm equal length to make this a proper same-length-different-content test
    expect(h1.length).toBe(h2.length);
    expect(safeEqualHash(h1, h2)).toBe(false);
  });

  it("REQ-APIKEY-006: returns false (without throwing) when lengths differ", () => {
    // timingSafeEqual throws on length mismatch — safeEqualHash must guard against it
    expect(() => safeEqualHash("short", "a-much-longer-string")).not.toThrow();
    expect(safeEqualHash("short", "a-much-longer-string")).toBe(false);
    expect(safeEqualHash("", "x")).toBe(false);
    expect(safeEqualHash("abc", "")).toBe(false);
  });
});

// REQ-APIKEY-007: x-api-key header takes precedence over Authorization
// REQ-APIKEY-008: Authorization: Bearer <token> parsed case-insensitively
// REQ-APIKEY-009: null cases
describe("extractApiKeyFromRequest", () => {
  it("REQ-APIKEY-007: returns trimmed x-api-key value, ignoring Authorization", () => {
    const req = new Request("https://example.com/api", {
      headers: {
        "x-api-key": "  my-api-key  ",
        authorization: "Bearer other-token",
      },
    });
    expect(extractApiKeyFromRequest(req)).toBe("my-api-key");
  });

  it("REQ-APIKEY-007: x-api-key with no Authorization still works", () => {
    const req = new Request("https://example.com/api", {
      headers: { "x-api-key": "direct-key" },
    });
    expect(extractApiKeyFromRequest(req)).toBe("direct-key");
  });

  it("REQ-APIKEY-008: extracts trimmed token from 'Authorization: Bearer <token>'", () => {
    const req = new Request("https://example.com/api", {
      headers: { authorization: "Bearer my-bearer-token" },
    });
    expect(extractApiKeyFromRequest(req)).toBe("my-bearer-token");
  });

  it("REQ-APIKEY-008: bearer scheme match is case-insensitive (BEARER, bearer, Bearer)", () => {
    const variants = ["BEARER token-upper", "bearer token-lower", "Bearer token-mixed"];
    const expected = ["token-upper", "token-lower", "token-mixed"];
    for (let i = 0; i < variants.length; i++) {
      const req = new Request("https://example.com/api", {
        headers: { authorization: variants[i] },
      });
      expect(extractApiKeyFromRequest(req)).toBe(expected[i]);
    }
  });

  it("REQ-APIKEY-009: returns null when no headers are present", () => {
    const req = new Request("https://example.com/api");
    expect(extractApiKeyFromRequest(req)).toBeNull();
  });

  it("REQ-APIKEY-009: returns null for a non-bearer Authorization scheme", () => {
    const req = new Request("https://example.com/api", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(extractApiKeyFromRequest(req)).toBeNull();
  });

  it("REQ-APIKEY-009: returns null for 'Authorization: Bearer' with no token", () => {
    const req = new Request("https://example.com/api", {
      headers: { authorization: "Bearer" },
    });
    expect(extractApiKeyFromRequest(req)).toBeNull();
  });

  it("REQ-APIKEY-009: returns null for an empty Authorization header", () => {
    const req = new Request("https://example.com/api", {
      headers: { authorization: "" },
    });
    expect(extractApiKeyFromRequest(req)).toBeNull();
  });
});
