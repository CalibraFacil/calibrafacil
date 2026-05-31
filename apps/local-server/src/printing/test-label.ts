import type { PrinterProfile } from "@calibra-facil/schemas";
import {
  endLabel,
  setDarkness,
  setEncodingUtf8,
  setLabelDimensions,
  setLabelHome,
  startLabel,
  textField,
} from "@calibra-facil/label-zpl";

/**
 * A minimal diagnostic label (border + text) for verifying connectivity, media
 * size and top-of-form alignment without a real calibration job.
 */
export function buildTestLabelZpl(profile: PrinterProfile): string {
  const width = Math.round(profile.widthDots);
  const height = Math.round(profile.heightDots);

  return [
    startLabel(),
    setEncodingUtf8(),
    setLabelDimensions(width, height),
    setDarkness(profile.darkness),
    setLabelHome(profile.offsets.xDots, profile.offsets.yDots),
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
      text: `${profile.dpi} dpi · ${width}x${height}`,
    }),
    endLabel(),
  ].join("\n");
}
