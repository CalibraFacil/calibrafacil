import { describe, expect, it } from "vitest";

import {
  endLabel,
  qrField,
  setDarkness,
  setEncodingUtf8,
  setLabelDimensions,
  setLabelHome,
  setPrintSpeed,
  startLabel,
  textField,
} from "./builder";

describe("zpl primitives", () => {
  it("emits the label envelope and encoding", () => {
    expect(startLabel()).toBe("^XA");
    expect(endLabel()).toBe("^XZ");
    expect(setEncodingUtf8()).toBe("^CI28");
  });

  it("emits dimensions, darkness (2-digit, clamped), speed and home", () => {
    expect(setLabelDimensions(400, 240)).toBe("^PW400^LL240");
    expect(setDarkness(15)).toBe("~SD15");
    expect(setDarkness(5)).toBe("~SD05");
    expect(setDarkness(99)).toBe("~SD30");
    expect(setDarkness(-1)).toBe("~SD00");
    expect(setPrintSpeed(4)).toBe("^PR4");
    expect(setLabelHome(0, 0)).toBe("^LH0,0");
    expect(setLabelHome(10, -5)).toBe("^LH10,-5");
  });

  it("builds a hex-escaped text field with the scalable font by default", () => {
    expect(
      textField({
        x: 12,
        y: 14,
        fontHeight: 32,
        fontWidth: 32,
        text: "CALIBRADO",
      }),
    ).toBe("^FO12,14^A0N,32,32^FH^FDCALIBRADO^FS");
  });

  it("escapes text-field content", () => {
    expect(
      textField({ x: 0, y: 0, fontHeight: 20, fontWidth: 20, text: "A^B" }),
    ).toBe("^FO0,0^A0N,20,20^FH^FDA_5EB^FS");
  });

  it("builds a native QR field with EC + automatic input mode", () => {
    expect(
      qrField({
        x: 236,
        y: 44,
        magnification: 4,
        data: "https://verify.calibrafacil.com/v/abc",
      }),
    ).toBe(
      "^FO236,44^BQN,2,4^FH^FDMA,https://verify.calibrafacil.com/v/abc^FS",
    );
  });

  it("clamps QR magnification into the 1–10 range", () => {
    expect(qrField({ x: 0, y: 0, magnification: 99, data: "x" })).toContain(
      "^BQN,2,10",
    );
    expect(qrField({ x: 0, y: 0, magnification: 0, data: "x" })).toContain(
      "^BQN,2,1",
    );
  });
});
