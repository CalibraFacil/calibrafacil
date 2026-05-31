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
    // ç = C3 A7, ã = C3 A3
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
});
