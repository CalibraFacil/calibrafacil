import type { PrinterDpi, PrinterLanguage } from "@calibra-facil/schemas";

export type { PrinterLanguage } from "@calibra-facil/schemas";

/**
 * The data printed on a calibration label. Dialect-independent: every renderer
 * consumes the same input. `verifyUrl` is the public verification URL encoded
 * into the QR (built server-side so the verification token isn't exposed in the
 * general job DTO).
 */
export interface LabelInput {
  certNumber: string;
  labName: string;
  assetTag: string;
  calibrationDate: Date | string | null;
  verifyUrl: string;
}

/**
 * How to lay the label out. `language` selects the renderer; the rest is
 * dialect-independent (each renderer maps darkness/speed onto its own range). A
 * full `PrinterProfile` is structurally assignable to this.
 */
export interface LabelRenderOptions {
  language: PrinterLanguage;
  dpi: PrinterDpi;
  darkness: number;
  speed: number;
  widthDots: number;
  heightDots: number;
  offsets: { xDots: number; yDots: number };
}

/**
 * A printer command-language renderer. Adding a new language (e.g. EPL) is a
 * matter of implementing this interface and registering it — no changes to the
 * API, transports, or UI.
 */
export interface LabelRenderer {
  readonly language: PrinterLanguage;
  renderLabel(input: LabelInput, options: LabelRenderOptions): string;
  renderTestLabel(options: LabelRenderOptions): string;
}
