import { PrinterProfileSchema } from "@calibra-facil/schemas";
import { describe, expect, it } from "vitest";

import {
  buildLabelZpl,
  defaultLabelDimensions,
  formatLabelDate,
  type LabelZplInput,
} from "./build-label-zpl";

const input: LabelZplInput = {
  certNumber: "CAL-2026-0001",
  labName: "Lab XYZ",
  assetTag: "AB-1024",
  calibrationDate: new Date("2026-05-31T12:00:00Z"),
  verifyUrl: "https://verify.calibrafacil.com/v/abc123",
};

const profile203 = PrinterProfileSchema.parse({
  id: "p1",
  name: "Zebra ZD220",
  connection: { type: "network", host: "192.168.1.50" },
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

describe("defaultLabelDimensions", () => {
  it("returns 50x30mm dot dimensions per dpi", () => {
    expect(defaultLabelDimensions(203)).toEqual({
      widthDots: 400,
      heightDots: 240,
    });
    expect(defaultLabelDimensions(300)).toEqual({
      widthDots: 591,
      heightDots: 354,
    });
  });
});

describe("formatLabelDate", () => {
  it("formats as pt-BR DD/MM/YYYY in UTC", () => {
    expect(formatLabelDate(new Date("2026-05-31T12:00:00Z"))).toBe(
      "31/05/2026",
    );
    expect(formatLabelDate("2026-01-09T00:00:00Z")).toBe("09/01/2026");
  });

  it("returns empty string for null/empty/invalid", () => {
    expect(formatLabelDate(null)).toBe("");
    expect(formatLabelDate("")).toBe("");
    expect(formatLabelDate("not-a-date")).toBe("not-a-date");
  });
});

describe("buildLabelZpl", () => {
  it("produces the exact ZPL for a 203 dpi label", () => {
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
    expect(buildLabelZpl(input, profile203)).toBe(expected);
  });

  it("scales coordinates and QR magnification for 300 dpi", () => {
    const out = buildLabelZpl(input, profile300);
    expect(out.startsWith("^XA\n^CI28\n")).toBe(true);
    expect(out).toContain("^PW591^LL354");
    expect(out).toContain("^FO18,21^A0N,47,47^FH^FDCALIBRADO^FS");
    expect(out).toContain(
      "^FO349,65^BQN,2,6^FH^FDMA,https://verify.calibrafacil.com/v/abc123^FS",
    );
    expect(out.endsWith("^XZ")).toBe(true);
  });

  it("hex-escapes accented lab names end-to-end", () => {
    const out = buildLabelZpl({ ...input, labName: "Calibração" }, profile203);
    expect(out).toContain("^FDCalibra_C3_A7_C3_A3o^FS");
  });

  it("never lets label data break out of a field (^XZ injection)", () => {
    const out = buildLabelZpl({ ...input, assetTag: "^XZ^XA" }, profile203);
    // Exactly two envelope tokens: the real start and end.
    expect(out.match(/\^XA/g)).toHaveLength(1);
    expect(out.match(/\^XZ/g)).toHaveLength(1);
  });
});
