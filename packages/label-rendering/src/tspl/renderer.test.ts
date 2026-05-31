import { describe, expect, it } from "vitest";

import { defaultRenderOptions } from "../options";
import { getRenderer, renderLabel, renderTestLabel } from "../render";
import type { LabelInput } from "../types";

const input: LabelInput = {
  certNumber: "CAL-2026-0001",
  labName: "Lab XYZ",
  assetTag: "AB-1024",
  calibrationDate: new Date("2026-05-31T12:00:00Z"),
  verifyUrl: "https://verify.calibrafacil.com/v/abc123",
};

const options203 = defaultRenderOptions("tspl", 203);
const options300 = defaultRenderOptions("tspl", 300);

describe("TSPL renderer", () => {
  it("renders the exact TSPL for a 203 dpi label", () => {
    const expected = [
      "SIZE 50 mm,30 mm",
      "GAP 2 mm,0 mm",
      "DENSITY 8",
      "SPEED 4",
      "DIRECTION 0",
      "CLS",
      "CODEPAGE UTF-8",
      "REFERENCE 0,0",
      'TEXT 12,14,"3",0,1,1,"CALIBRADO"',
      'TEXT 12,54,"3",0,1,1,"Lab XYZ"',
      'TEXT 12,92,"3",0,1,1,"TAG: AB-1024"',
      'TEXT 12,128,"3",0,1,1,"DATA: 31/05/2026"',
      'TEXT 12,200,"3",0,1,1,"CAL-2026-0001"',
      'QRCODE 236,44,M,5,A,0,"https://verify.calibrafacil.com/v/abc123"',
      "PRINT 1",
    ].join("\n");
    expect(renderLabel(input, options203)).toBe(expected);
  });

  it("derives mm + scales coords and QR cell for 300 dpi", () => {
    const out = renderLabel(input, options300);
    expect(out).toContain("SIZE 50 mm,30 mm");
    expect(out).toContain(
      'QRCODE 349,65,M,7,A,0,"https://verify.calibrafacil.com/v/abc123"',
    );
    expect(out.startsWith("SIZE ")).toBe(true);
    expect(out.endsWith("PRINT 1")).toBe(true);
  });

  it("keeps accents (CODEPAGE UTF-8) and neutralizes quotes/newlines", () => {
    const out = renderLabel(
      { ...input, labName: "Calibração", assetTag: 'A"B\nC' },
      options203,
    );
    expect(out).toContain("CODEPAGE UTF-8");
    expect(out).toContain('"Calibração"');
    expect(out).toContain("TAG: A'B C");
    // No stray PRINT injected via the field data.
    expect(out.match(/^PRINT 1$/gm)).toHaveLength(1);
  });

  it("renders a bordered test label", () => {
    const out = renderTestLabel(options203);
    expect(out).toContain("BOX 2,2,398,238,2");
    expect(out).toContain('"CALIBRA TESTE"');
    expect(out).toContain("203dpi 400x240");
  });
});

describe("renderer factory", () => {
  it("selects the renderer by language", () => {
    expect(getRenderer("zpl").language).toBe("zpl");
    expect(getRenderer("tspl").language).toBe("tspl");
    expect(
      renderLabel(input, defaultRenderOptions("zpl", 203)).startsWith("^XA"),
    ).toBe(true);
    expect(renderLabel(input, options203).startsWith("SIZE ")).toBe(true);
  });
});
