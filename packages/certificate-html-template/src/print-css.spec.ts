import { describe, expect, it } from "vitest";

import { CERTIFICATE_THEMES } from "./document-schema.js";
import {
  CERTIFICATE_PRINT_CSS,
  certificateThemeTokens,
} from "./print-css.js";

// R3 floors (DIN 5008 / Butterick): nothing under 8pt in print, ever again.
const FLOOR_PT = 8;

function allFontSizesPt(css: string): number[] {
  const sizes: number[] = [];
  for (const match of css.matchAll(/font-size:\s*([\d.]+)pt/g)) {
    sizes.push(Number(match[1]));
  }
  for (const match of css.matchAll(/--size-[a-z0-9]+:\s*([\d.]+)pt/g)) {
    sizes.push(Number(match[1]));
  }
  return sizes;
}

describe("print CSS floors (reframe R3)", () => {
  it("declares no px font sizes (print is pt-based)", () => {
    expect(CERTIFICATE_PRINT_CSS).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  it("every font size in the stylesheet and every theme token is >= 8pt", () => {
    for (const theme of CERTIFICATE_THEMES) {
      const css = certificateThemeTokens(theme) + CERTIFICATE_PRINT_CSS;
      const sizes = allFontSizesPt(css);
      expect(sizes.length).toBeGreaterThan(5);
      for (const size of sizes) {
        expect(size, `${theme}: found ${size}pt`).toBeGreaterThanOrEqual(FLOOR_PT);
      }
    }
  });

  it("label ink is dark (no faint-gray microtext): token colors are near-black", () => {
    for (const theme of CERTIFICATE_THEMES) {
      const tokens = certificateThemeTokens(theme);
      for (const name of ["--ink", "--muted", "--label"]) {
        const match = tokens.match(new RegExp(`${name}:#([0-9A-Fa-f]{6})`));
        expect(match, `${theme} ${name}`).not.toBeNull();
        if (!match?.[1]) continue;
        const value = match[1];
        const r = parseInt(value.slice(0, 2), 16);
        const g = parseInt(value.slice(2, 4), 16);
        const b = parseInt(value.slice(4, 6), 16);
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        expect(luminance, `${theme} ${name} #${value}`).toBeLessThan(90);
      }
    }
  });
});
