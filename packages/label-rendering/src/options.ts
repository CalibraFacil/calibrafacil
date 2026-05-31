import type { PrinterDpi, PrinterLanguage } from "@calibra-facil/schemas";

import type { LabelRenderOptions } from "./types";

/**
 * Dot dimensions of the 50×30 mm calibration label for a given resolution.
 * 203 dpi = 8 dots/mm → 400×240; 300 dpi ≈ 11.81 dots/mm → 591×354.
 */
export function defaultLabelDimensions(dpi: PrinterDpi): {
  widthDots: number;
  heightDots: number;
} {
  return dpi === 300
    ? { widthDots: 591, heightDots: 354 }
    : { widthDots: 400, heightDots: 240 };
}

/**
 * Sensible render options for the 50×30 mm label in a given language + dpi (used
 * by the API endpoint, which has no saved printer profile).
 */
export function defaultRenderOptions(
  language: PrinterLanguage,
  dpi: PrinterDpi,
): LabelRenderOptions {
  return {
    language,
    dpi,
    darkness: 15,
    speed: 4,
    ...defaultLabelDimensions(dpi),
    offsets: { xDots: 0, yDots: 0 },
  };
}

/** Format a calibration date as pt-BR DD/MM/YYYY (UTC, matching certificates). */
export function formatLabelDate(value: Date | string | null): string {
  if (value === null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "";
  }
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}
