import { describe, expect, it } from "vitest";
import { sniffRasterImage } from "./image-sniff";

function bytes(...values: number[]) {
  return new Uint8Array([...values, ...Array.from({ length: 16 }, () => 0)])
    .buffer;
}

describe("sniffRasterImage (roadmap 2 D3)", () => {
  it("recognises PNG, JPEG and WebP by their signatures", () => {
    expect(
      sniffRasterImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe("image/png");
    expect(sniffRasterImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(
      sniffRasterImage(
        bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50),
      ),
    ).toBe("image/webp");
  });

  it("refuses an SVG or HTML whatever type the client declared", () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(sniffRasterImage(svg.buffer)).toBeNull();
    expect(
      sniffRasterImage(new TextEncoder().encode("<!doctype html>").buffer),
    ).toBeNull();
    expect(sniffRasterImage(new ArrayBuffer(0))).toBeNull();
  });
});
