import { describe, expect, it } from "vitest";

import { escapeZplField } from "./escape";

describe("escapeZplField", () => {
  it("passes printable ASCII through untouched", () => {
    expect(escapeZplField("AB-1024")).toBe("AB-1024");
    expect(escapeZplField("DATA: 31/05/2026")).toBe("DATA: 31/05/2026");
    expect(escapeZplField("https://verify.calibrafacil.com/v/abc")).toBe(
      "https://verify.calibrafacil.com/v/abc",
    );
  });

  it("hex-escapes the ZPL control characters ^ ~ _ \\", () => {
    expect(escapeZplField("a^b~c_d\\e")).toBe("a_5Eb_7Ec_5Fd_5Ce");
  });

  it("encodes Portuguese accents as UTF-8 hex (for ^CI28)", () => {
    expect(escapeZplField("calibração")).toBe("calibra_C3_A7_C3_A3o");
  });

  it("prevents ZPL command injection through field data", () => {
    const escaped = escapeZplField("^XZ rogue ^XA");
    expect(escaped).not.toContain("^XZ");
    expect(escaped).not.toContain("^XA");
    expect(escaped).toBe("_5EXZ rogue _5EXA");
  });

  it("handles empty input", () => {
    expect(escapeZplField("")).toBe("");
  });

  // REQ-ZPL-004: control/non-printable ASCII bytes below 0x20 must become _XX
  it("REQ-ZPL-004: escapes control/non-printable ASCII bytes below 0x20", () => {
    // newline 0x0A → _0A
    expect(escapeZplField("\n")).toBe("_0A");
    // carriage return 0x0D → _0D
    expect(escapeZplField("\r")).toBe("_0D");
    // tab 0x09 → _09
    expect(escapeZplField("\t")).toBe("_09");
    // NUL 0x00 → _00
    expect(escapeZplField("\x00")).toBe("_00");
    // embedded newline inside printable text
    expect(escapeZplField("line1\nline2")).toBe("line1_0Aline2");
  });

  // REQ-ZPL-006: hex digits must always be two uppercase digits, zero-padded (verified on byte < 0x10)
  it("REQ-ZPL-006: hex output is always two uppercase digits, zero-padded for bytes < 0x10", () => {
    // tab is 0x09 — single hex digit without padding would be "9", must be "09"
    expect(escapeZplField("\t")).toBe("_09");
    // NUL is 0x00 — must be "00" not "0"
    expect(escapeZplField("\x00")).toBe("_00");
    // BEL is 0x07 — must be "07" not "7"
    expect(escapeZplField("\x07")).toBe("_07");
    // verify no single-digit hex tokens appear anywhere in a mixed string
    // \x01=_01, \x0F=_0F, \x10=_10 (0x10 is still non-printable), A passes through
    const result = escapeZplField("\x01\x0F\x10A");
    expect(result).toBe("_01_0F_10A");
  });
});
