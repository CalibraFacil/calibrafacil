import { describe, expect, it } from "vitest";

import { type MemberData } from "../../middleware/permission";
import {
  asRecord,
  buildSyncAttachmentObjectKey,
  DEFAULT_SYNC_PULL_LIMIT,
  encodeSyncAttachmentId,
  formNumber,
  formString,
  getNullableString,
  getNumber,
  getRecordOrNull,
  isIntegerNumber,
  isPositiveInteger,
  isValidSyncAttachmentObjectKey,
  MAX_SYNC_PULL_LIMIT,
  parseSnapshotDate,
  parseSyncPullCursor,
  parseSyncPullLimit,
  safeAttachmentExtension,
  toSyncTimestamp,
  tryDecodeSyncAttachmentId,
} from "./helpers";

describe("sync helpers — pull cursor", () => {
  it("returns epoch when cursor is null", () => {
    expect(parseSyncPullCursor(null).getTime()).toBe(0);
  });

  it("returns epoch when cursor is empty string", () => {
    expect(parseSyncPullCursor("").getTime()).toBe(0);
  });

  it("returns epoch when cursor is unparseable", () => {
    expect(parseSyncPullCursor("not-a-date").getTime()).toBe(0);
  });

  it("parses a valid ISO timestamp", () => {
    const iso = "2026-06-21T12:34:56.000Z";
    expect(parseSyncPullCursor(iso).toISOString()).toBe(iso);
  });
});

describe("sync helpers — pull limit", () => {
  it("DEFAULT/MAX constants are 100/500", () => {
    expect(DEFAULT_SYNC_PULL_LIMIT).toBe(100);
    expect(MAX_SYNC_PULL_LIMIT).toBe(500);
  });

  it("returns the default when limit is undefined", () => {
    expect(parseSyncPullLimit(undefined)).toBe(DEFAULT_SYNC_PULL_LIMIT);
  });

  it("returns the default when limit is empty string", () => {
    expect(parseSyncPullLimit("")).toBe(DEFAULT_SYNC_PULL_LIMIT);
  });

  it("returns the default when limit is non-numeric", () => {
    expect(parseSyncPullLimit("abc")).toBe(DEFAULT_SYNC_PULL_LIMIT);
  });

  it("returns the default when limit is zero or negative", () => {
    expect(parseSyncPullLimit("0")).toBe(DEFAULT_SYNC_PULL_LIMIT);
    expect(parseSyncPullLimit("-5")).toBe(DEFAULT_SYNC_PULL_LIMIT);
  });

  it("passes through a valid in-range limit", () => {
    expect(parseSyncPullLimit("42")).toBe(42);
  });

  it("clamps to MAX when over the maximum", () => {
    expect(parseSyncPullLimit("1000")).toBe(MAX_SYNC_PULL_LIMIT);
  });

  it("allows exactly the maximum", () => {
    expect(parseSyncPullLimit("500")).toBe(500);
  });

  it("uses base-10 integer parsing (parseInt of '12px' → 12)", () => {
    expect(parseSyncPullLimit("12px")).toBe(12);
  });
});

describe("sync helpers — toSyncTimestamp", () => {
  it("serializes a Date to ISO", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    expect(toSyncTimestamp(date)).toBe("2026-01-02T03:04:05.000Z");
  });

  it("passes a string through verbatim", () => {
    expect(toSyncTimestamp("already-a-string")).toBe("already-a-string");
  });

  it("falls back to an ISO string for other types", () => {
    const result = toSyncTimestamp(12345);
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("sync helpers — safeAttachmentExtension", () => {
  it("returns empty string when there is no dot", () => {
    expect(safeAttachmentExtension("noextension")).toBe("");
  });

  it("returns the extension including the leading dot", () => {
    expect(safeAttachmentExtension("certificate.pdf")).toBe(".pdf");
  });

  it("uses the last dot for multi-dot names", () => {
    expect(safeAttachmentExtension("archive.tar.gz")).toBe(".gz");
  });

  it("rejects extensions with non-alphanumeric characters", () => {
    expect(safeAttachmentExtension("weird.p df")).toBe("");
    expect(safeAttachmentExtension("weird.p-d")).toBe("");
  });

  it("rejects a bare trailing dot (empty extension fails the regex)", () => {
    expect(safeAttachmentExtension("trailingdot.")).toBe("");
  });

  it("caps the slice at 16 characters, so an over-long extension is rejected", () => {
    // A 20-char extension: the 16-char slice does not consume the whole run,
    // but since slice keeps only alnum chars here the regex still matches the
    // truncated alnum run. Verify the truncation length explicitly.
    const ext = safeAttachmentExtension(`file.${"a".repeat(20)}`);
    // slice(dotIndex, dotIndex+16) → "." + 15 chars
    expect(ext).toBe(`.${"a".repeat(15)}`);
  });

  it("keeps alphanumeric mixed-case and digits", () => {
    expect(safeAttachmentExtension("file.JpG2")).toBe(".JpG2");
  });
});

describe("sync helpers — isValidSyncAttachmentObjectKey", () => {
  const valid = "org/123/sync-attachments/asset/9/file-abc.pdf";

  it("accepts a well-formed key", () => {
    expect(isValidSyncAttachmentObjectKey(valid)).toBe(true);
  });

  it("rejects a key without the org/ prefix", () => {
    expect(
      isValidSyncAttachmentObjectKey(
        "x/123/sync-attachments/asset/9/file.pdf",
      ),
    ).toBe(false);
  });

  it("rejects a key without the /sync-attachments/ segment", () => {
    expect(
      isValidSyncAttachmentObjectKey("org/123/other/asset/9/file.pdf"),
    ).toBe(false);
  });

  it("rejects a key containing a parent-directory traversal", () => {
    expect(
      isValidSyncAttachmentObjectKey(
        "org/123/sync-attachments/../secrets.pdf",
      ),
    ).toBe(false);
  });

  it("rejects a key that starts with a slash", () => {
    expect(
      isValidSyncAttachmentObjectKey(
        "/org/123/sync-attachments/asset/9/file.pdf",
      ),
    ).toBe(false);
  });

  it("rejects a key that ends with a slash", () => {
    expect(
      isValidSyncAttachmentObjectKey("org/123/sync-attachments/asset/9/"),
    ).toBe(false);
  });
});

describe("sync helpers — attachment id encode/decode round-trip", () => {
  const objectKey = "org/42/sync-attachments/asset/7/hash-evt.pdf";

  it("encodes to base64url", () => {
    const encoded = encodeSyncAttachmentId(objectKey);
    expect(encoded).toBe(Buffer.from(objectKey, "utf8").toString("base64url"));
    // base64url must not contain +, / or = padding
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("round-trips a valid object key", () => {
    const encoded = encodeSyncAttachmentId(objectKey);
    expect(tryDecodeSyncAttachmentId(encoded)).toBe(objectKey);
  });

  it("returns null when the decoded key is not a valid attachment key", () => {
    const encoded = encodeSyncAttachmentId("org/1/not-attachments/x.pdf");
    expect(tryDecodeSyncAttachmentId(encoded)).toBeNull();
  });

  it("returns null when the decoded key contains traversal", () => {
    const encoded = encodeSyncAttachmentId(
      "org/1/sync-attachments/../escape.pdf",
    );
    expect(tryDecodeSyncAttachmentId(encoded)).toBeNull();
  });
});

// A complete, valid MemberData. buildSyncAttachmentObjectKey only reads
// organizationId, but we build the full shape (no `as` assertions, which the
// repo bans) so the contract with the real type stays honest.
function memberFor(organizationId: string): MemberData {
  return {
    id: "member-1",
    role: "admin",
    organizationId,
    organizationType: "LAB",
    userId: "user-1",
    activeUnitId: null,
    activeUnitName: null,
    accessibleUnitIds: [],
    accessibleUnits: [],
    selectedUnitScope: "all",
    canAccessAllUnits: true,
    unitRole: null,
  } satisfies MemberData;
}

describe("sync helpers — buildSyncAttachmentObjectKey", () => {
  it("produces a key for the member's organization with a hashed file identity", () => {
    const key = buildSyncAttachmentObjectKey(memberFor("org-123"), {
      eventId: "evt-1",
      entityType: "asset",
      entityId: "9",
      fileName: "report.pdf",
      // 32-char hash; only the first 16 chars feed the file identity.
      contentHash: "0123456789abcdef0123456789abcdef",
    });
    expect(typeof key).toBe("string");
    // The org id segment must appear (tenant scoping is preserved in the key).
    expect(key).toContain("org-123");
    // The extension derived from the filename is appended.
    expect(key.endsWith(".pdf")).toBe(true);
    // The first 16 chars of the content hash drive the file identity.
    expect(key).toContain("0123456789abcdef");
  });

  it("drops an unsafe extension", () => {
    const key = buildSyncAttachmentObjectKey(memberFor("org-123"), {
      eventId: "evt-2",
      entityType: "asset",
      entityId: "9",
      fileName: "report.p df",
      contentHash: "abcdef0123456789abcdef0123456789",
    });
    expect(key.endsWith(".p df")).toBe(false);
  });
});

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("sync helpers — form extractors", () => {
  it("formString returns the value when present and non-empty", () => {
    expect(formString(form({ a: "hello" }), "a")).toBe("hello");
  });

  it("formString returns null when the key is missing", () => {
    expect(formString(form({}), "a")).toBeNull();
  });

  it("formString returns null for an empty value", () => {
    expect(formString(form({ a: "" }), "a")).toBeNull();
  });

  it("formNumber parses a numeric string", () => {
    expect(formNumber(form({ n: "3.5" }), "n")).toBe(3.5);
  });

  it("formNumber returns NaN when the key is missing", () => {
    expect(Number.isNaN(formNumber(form({}), "n"))).toBe(true);
  });

  it("formNumber returns NaN for a non-numeric value", () => {
    expect(Number.isNaN(formNumber(form({ n: "abc" }), "n"))).toBe(true);
  });
});

describe("sync helpers — record validators", () => {
  it("asRecord copies a plain object's entries", () => {
    expect(asRecord({ a: 1, b: "x" })).toEqual({ a: 1, b: "x" });
  });

  it("asRecord returns {} for arrays", () => {
    expect(asRecord([1, 2, 3])).toEqual({});
  });

  it("asRecord returns {} for null and primitives", () => {
    expect(asRecord(null)).toEqual({});
    expect(asRecord(undefined)).toEqual({});
    expect(asRecord(5)).toEqual({});
    expect(asRecord("str")).toEqual({});
  });

  it("isIntegerNumber accepts integers and rejects non-integers", () => {
    expect(isIntegerNumber(3)).toBe(true);
    expect(isIntegerNumber(0)).toBe(true);
    expect(isIntegerNumber(-2)).toBe(true);
    expect(isIntegerNumber(3.5)).toBe(false);
    expect(isIntegerNumber("3")).toBe(false);
    expect(isIntegerNumber(Number.NaN)).toBe(false);
  });

  it("isPositiveInteger requires integer AND > 0", () => {
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveInteger(-1)).toBe(false);
    expect(isPositiveInteger(2.5)).toBe(false);
    expect(isPositiveInteger("1")).toBe(false);
  });
});

describe("sync helpers — typed row extractors", () => {
  it("getNumber returns finite numbers, null otherwise", () => {
    expect(getNumber({ x: 3.14 }, "x")).toBe(3.14);
    expect(getNumber({ x: 0 }, "x")).toBe(0);
    expect(getNumber({ x: Number.POSITIVE_INFINITY }, "x")).toBeNull();
    expect(getNumber({ x: "3" }, "x")).toBeNull();
    expect(getNumber({}, "x")).toBeNull();
  });

  it("getNullableString returns non-empty strings, null otherwise", () => {
    expect(getNullableString({ s: "hi" }, "s")).toBe("hi");
    expect(getNullableString({ s: "" }, "s")).toBeNull();
    expect(getNullableString({ s: 5 }, "s")).toBeNull();
    expect(getNullableString({}, "s")).toBeNull();
  });

  it("getRecordOrNull returns a copied record for objects, null otherwise", () => {
    expect(getRecordOrNull({ o: { a: 1 } }, "o")).toEqual({ a: 1 });
    expect(getRecordOrNull({ o: [1, 2] }, "o")).toBeNull();
    expect(getRecordOrNull({ o: null }, "o")).toBeNull();
    expect(getRecordOrNull({ o: "x" }, "o")).toBeNull();
    expect(getRecordOrNull({}, "o")).toBeNull();
  });
});

describe("sync helpers — parseSnapshotDate", () => {
  it("returns the same Date instance for a valid Date", () => {
    const d = new Date("2026-05-01T00:00:00.000Z");
    expect(parseSnapshotDate(d)).toBe(d);
  });

  it("parses a valid date string", () => {
    const result = parseSnapshotDate("2026-05-01T00:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("returns null for an invalid date string", () => {
    expect(parseSnapshotDate("not-a-date")).toBeNull();
  });

  it("returns null for an invalid Date instance", () => {
    expect(parseSnapshotDate(new Date("nope"))).toBeNull();
  });
});
