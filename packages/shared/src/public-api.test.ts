import { describe, expect, it } from "vitest";
import { truncateUtf8Bytes } from "./public-api";

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("truncateUtf8Bytes", () => {
  it("leaves short text alone", () => {
    expect(truncateUtf8Bytes("ok", 512)).toBe("ok");
    expect(truncateUtf8Bytes("", 512)).toBe("");
  });

  it("cuts ASCII at the byte limit", () => {
    expect(truncateUtf8Bytes("a".repeat(1000), 512)).toBe("a".repeat(512));
  });

  it("never exceeds the limit in bytes and never splits a character", () => {
    for (const unit of ["é", "€", "😀", "日本語", "aé€😀"]) {
      const out = truncateUtf8Bytes(unit.repeat(1000), 512);
      expect(bytes(out)).toBeLessThanOrEqual(512);
      // Whole characters only: the cut text is a prefix made of whole units' characters.
      expect(unit.repeat(1000).startsWith(out)).toBe(true);
      expect(bytes(out)).toBeGreaterThan(512 - 4);
      expect(out).not.toContain("�");
    }
  });

  it("counts a decoded invalid sequence as the three bytes U+FFFD takes", () => {
    const decoded = new TextDecoder().decode(new Uint8Array(2000).fill(0xff));
    expect(bytes(decoded)).toBe(6000);
    const out = truncateUtf8Bytes(decoded, 512);
    expect(bytes(out)).toBe(510);
  });
});
