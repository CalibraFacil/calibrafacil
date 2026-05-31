import { PrinterProfileSchema } from "@calibra-facil/schemas";
import { describe, expect, it } from "vitest";

import { defaultRenderOptions } from "../options";
import { renderLabel, renderTestLabel } from "../render";
import type { LabelInput } from "../types";

const input: LabelInput = {
  certNumber: "CAL-2026-0001",
  labName: "Lab XYZ",
  assetTag: "AB-1024",
  calibrationDate: new Date("2026-05-31T12:00:00Z"),
  verifyUrl: "https://verify.calibrafacil.com/v/abc123",
};

const profile203 = PrinterProfileSchema.parse({
  id: "p1",
  name: "Zebra ZD220",
  connection: { type: "network", host: "192.168.0.10" },
  dpi: 203,
  widthDots: 400,
  heightDots: 240,
});

const profile300 = PrinterProfileSchema.parse({
  id: "p2",
  name: "Zebra ZD230 300dpi",
  connection: { type: "network", host: "10.0.0.5" },
  dpi: 300,
  widthDots: 591,
  heightDots: 354,
});

describe("ZPL renderer", () => {
  it("renders the exact ZPL for a 203 dpi label", () => {
    const expected = [
      "^XA",
      "^CI28",
      "^PW400^LL240",
      "~SD15",
      "^PR4",
      "^LH0,0",
      "^FO12,14^A0N,32,32^FH^FDCALIBRADO^FS",
      "^FO12,54^A0N,20,20^FH^FDLab XYZ^FS",
      "^FO12,92^A0N,24,24^FH^FDTAG: AB-1024^FS",
      "^FO12,128^A0N,22,22^FH^FDDATA: 31/05/2026^FS",
      "^FO12,200^A0N,18,18^FH^FDCAL-2026-0001^FS",
      "^FO236,44^BQN,2,4^FH^FDMA,https://verify.calibrafacil.com/v/abc123^FS",
      "^XZ",
    ].join("\n");
    expect(renderLabel(input, profile203)).toBe(expected);
  });

  it("scales coordinates + QR magnification for 300 dpi", () => {
    const out = renderLabel(input, profile300);
    expect(out).toContain("^PW591^LL354");
    expect(out).toContain("^FO18,21^A0N,47,47^FH^FDCALIBRADO^FS");
    expect(out).toContain(
      "^FO349,65^BQN,2,6^FH^FDMA,https://verify.calibrafacil.com/v/abc123^FS",
    );
  });

  it("hex-escapes accents and resists injection", () => {
    const out = renderLabel({ ...input, assetTag: "^XZ^XA" }, profile203);
    expect(out.match(/\^XA/g)).toHaveLength(1);
    expect(out.match(/\^XZ/g)).toHaveLength(1);
  });

  it("renders a bordered test label", () => {
    const out = renderTestLabel(defaultRenderOptions("zpl", 203));
    expect(out.startsWith("^XA\n^CI28\n^PW400^LL240")).toBe(true);
    expect(out).toContain("^FO0,0^GB400,240,2^FS");
    expect(out).toContain("^FDCALIBRA TESTE^FS");
    expect(out).toContain("203 dpi");
    expect(out.endsWith("^XZ")).toBe(true);
  });
});
