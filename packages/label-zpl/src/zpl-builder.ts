// Typed ZPL II primitives. Each function returns a ZPL fragment string; callers
// compose them into a full `^XA … ^XZ` label. Kept pure and dependency-free so
// this runs identically in the worker, the local-server, and the browser.
//
// We deliberately hand-roll this instead of taking a dependency: the only
// healthy native-ZPL npm package (jszpl) is GPL-3.0 (incompatible with this
// proprietary codebase), and label generation for a fixed-format calibration
// label is small and fully testable.

import { escapeZplField } from "./escape";

export type ZplOrientation = "N" | "R" | "I" | "B";
export type QrErrorCorrection = "L" | "M" | "Q" | "H";

/** `^XA` — start of label format. */
export function startLabel(): string {
  return "^XA";
}

/** `^XZ` — end of label format. */
export function endLabel(): string {
  return "^XZ";
}

/** `^CI28` — interpret field data as UTF-8 (so accented hex round-trips). */
export function setEncodingUtf8(): string {
  return "^CI28";
}

/** `^PW`/`^LL` — print width and label length, in dots. */
export function setLabelDimensions(
  widthDots: number,
  heightDots: number,
): string {
  return `^PW${Math.round(widthDots)}^LL${Math.round(heightDots)}`;
}

/** `~SD` — darkness (0–30). */
export function setDarkness(darkness: number): string {
  const clamped = Math.min(30, Math.max(0, Math.round(darkness)));
  return `~SD${String(clamped).padStart(2, "0")}`;
}

/** `^PR` — print speed, in inches/second. */
export function setPrintSpeed(speed: number): string {
  return `^PR${Math.round(speed)}`;
}

/** `^LH` — label home offset, in dots (top-of-form calibration). */
export function setLabelHome(xDots: number, yDots: number): string {
  return `^LH${Math.round(xDots)},${Math.round(yDots)}`;
}

export interface TextFieldOptions {
  x: number;
  y: number;
  fontHeight: number;
  fontWidth: number;
  text: string;
  /** ZPL font name; `0` is the scalable default font. */
  font?: string;
  orientation?: ZplOrientation;
}

/** `^FO … ^A … ^FH^FD … ^FS` — a positioned text field (hex-escaped). */
export function textField(options: TextFieldOptions): string {
  const font = options.font ?? "0";
  const orientation = options.orientation ?? "N";
  const x = Math.round(options.x);
  const y = Math.round(options.y);
  const height = Math.round(options.fontHeight);
  const width = Math.round(options.fontWidth);
  return `^FO${x},${y}^A${font}${orientation},${height},${width}^FH^FD${escapeZplField(
    options.text,
  )}^FS`;
}

export interface QrFieldOptions {
  x: number;
  y: number;
  /** Module magnification, 1–10. */
  magnification: number;
  data: string;
  model?: 1 | 2;
  errorCorrection?: QrErrorCorrection;
  orientation?: ZplOrientation;
}

/**
 * `^FO … ^BQ … ^FH^FD … ^FS` — a native QR code. The `^FD` payload for `^BQ`
 * is `<errorCorrection><inputMode>,<data>`; we always use input mode `A`
 * (automatic) and hex-escape the data so it can't break out of the field.
 */
export function qrField(options: QrFieldOptions): string {
  const model = options.model ?? 2;
  const orientation = options.orientation ?? "N";
  const errorCorrection = options.errorCorrection ?? "M";
  const magnification = Math.min(
    10,
    Math.max(1, Math.round(options.magnification)),
  );
  const x = Math.round(options.x);
  const y = Math.round(options.y);
  return `^FO${x},${y}^BQ${orientation},${model},${magnification}^FH^FD${errorCorrection}A,${escapeZplField(
    options.data,
  )}^FS`;
}
