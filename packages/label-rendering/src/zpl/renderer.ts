import { formatLabelDate } from "../options";
import type { LabelInput, LabelRenderOptions, LabelRenderer } from "../types";
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

// Layout authored at 203 dpi for the 50×30 mm media and scaled to the target
// dpi, so one composition prints on 203 and 300 dpi heads.
function scaleFor(options: LabelRenderOptions): (dots: number) => number {
  const scale = options.dpi === 300 ? 300 / 203 : 1;
  return (dots: number) => Math.round(dots * scale);
}

export const zplRenderer: LabelRenderer = {
  language: "zpl",

  renderLabel(input: LabelInput, options: LabelRenderOptions): string {
    const at = scaleFor(options);
    const qrMagnification = options.dpi === 300 ? 6 : 4;

    return [
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
    ].join("\n");
  },

  renderTestLabel(options: LabelRenderOptions): string {
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
        text: `${options.dpi} dpi ${width}x${height}`,
      }),
      endLabel(),
    ].join("\n");
  },
};
