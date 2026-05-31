import type { PrinterDpi } from "@calibra-facil/schemas";

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
} from "./zpl-builder";

/**
 * The data printed on a calibration label. Mirrors what the worker's
 * `fetchLabelData` already selects; `verifyUrl` is the public verification URL
 * encoded into the QR (built server-side so the verification token never
 * reaches the browser).
 */
export interface LabelZplInput {
  certNumber: string;
  labName: string;
  assetTag: string;
  calibrationDate: Date | string | null;
  verifyUrl: string;
}

/**
 * The label-layout fields the builder needs. A full `PrinterProfile` is
 * structurally assignable to this, so callers can pass either.
 */
export interface LabelRenderOptions {
  dpi: PrinterDpi;
  darkness: number;
  speed: number;
  widthDots: number;
  heightDots: number;
  offsets: { xDots: number; yDots: number };
}

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
 * Sensible render options for the 50×30 mm label at a given dpi (used by the
 * API `label.zpl` endpoint, which has no saved printer profile).
 */
export function defaultRenderOptions(dpi: PrinterDpi): LabelRenderOptions {
  return {
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

/**
 * Build a complete ZPL label from calibration data + render options.
 *
 * Layout is authored at 203 dpi for the 50×30 mm media and scaled to the
 * target dpi, so the same composition prints correctly on 203 and 300 dpi
 * heads. Physical fit (QR size / margins) is tunable via the offsets and
 * validated visually with Labelary + a test print.
 */
export function buildLabelZpl(
  input: LabelZplInput,
  options: LabelRenderOptions,
): string {
  const scale = options.dpi === 300 ? 300 / 203 : 1;
  const at = (dots: number): number => Math.round(dots * scale);
  const qrMagnification = options.dpi === 300 ? 6 : 4;

  const lines = [
    startLabel(),
    setEncodingUtf8(),
    setLabelDimensions(options.widthDots, options.heightDots),
    setDarkness(options.darkness),
    setPrintSpeed(options.speed),
    setLabelHome(options.offsets.xDots, options.offsets.yDots),
    textField({
      x: at(12),
      y: at(14),
      fontHeight: at(32),
      fontWidth: at(32),
      text: "CALIBRADO",
    }),
    textField({
      x: at(12),
      y: at(54),
      fontHeight: at(20),
      fontWidth: at(20),
      text: input.labName,
    }),
    textField({
      x: at(12),
      y: at(92),
      fontHeight: at(24),
      fontWidth: at(24),
      text: `TAG: ${input.assetTag}`,
    }),
    textField({
      x: at(12),
      y: at(128),
      fontHeight: at(22),
      fontWidth: at(22),
      text: `DATA: ${formatLabelDate(input.calibrationDate)}`,
    }),
    textField({
      x: at(12),
      y: at(200),
      fontHeight: at(18),
      fontWidth: at(18),
      text: input.certNumber,
    }),
    qrField({
      x: at(236),
      y: at(44),
      magnification: qrMagnification,
      errorCorrection: "M",
      data: input.verifyUrl,
    }),
    endLabel(),
  ];

  return lines.join("\n");
}

/**
 * A minimal diagnostic label (border + text) for verifying connectivity, media
 * size and top-of-form alignment without a real calibration job. Shared by the
 * desktop local-server and the cloud Browser Print "test print".
 */
export function buildTestLabelZpl(options: LabelRenderOptions): string {
  const width = Math.round(options.widthDots);
  const height = Math.round(options.heightDots);

  return [
    startLabel(),
    setEncodingUtf8(),
    setLabelDimensions(width, height),
    setDarkness(options.darkness),
    setLabelHome(options.offsets.xDots, options.offsets.yDots),
    `^FO0,0^GB${width},${height},2^FS`,
    textField({
      x: 20,
      y: 24,
      fontHeight: 30,
      fontWidth: 30,
      text: "CALIBRA TESTE",
    }),
    textField({
      x: 20,
      y: 70,
      fontHeight: 20,
      fontWidth: 20,
      text: `${options.dpi} dpi · ${width}x${height}`,
    }),
    endLabel(),
  ].join("\n");
}
