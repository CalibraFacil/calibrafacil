import { formatLabelDate } from "../options";
import type { LabelInput, LabelRenderOptions, LabelRenderer } from "../types";
import { escapeTsplText } from "./escape";

function scaleFor(options: LabelRenderOptions): (dots: number) => number {
  const scale = options.dpi === 300 ? 300 / 203 : 1;
  return (dots: number) => Math.round(dots * scale);
}

/** Media size in whole mm, derived from the dot dimensions + resolution. */
function toMm(dots: number, dpi: number): number {
  return Math.round((dots * 25.4) / dpi);
}

/** `TEXT x,y,"font",rotation,xMul,yMul,"content"` using bitmap font 3. */
function tsplText(x: number, y: number, height: number, text: string): string {
  const multiplier = Math.min(4, Math.max(1, Math.round(height / 24)));
  return `TEXT ${Math.round(x)},${Math.round(y)},"3",0,${multiplier},${multiplier},"${escapeTsplText(
    text,
  )}"`;
}

function tsplHeader(options: LabelRenderOptions): string[] {
  // DENSITY is 0–15 (vs ZPL darkness 0–30); SPEED is ips.
  const density = Math.min(15, Math.max(0, Math.round(options.darkness / 2)));
  const speed = Math.min(12, Math.max(1, Math.round(options.speed)));
  return [
    `SIZE ${toMm(options.widthDots, options.dpi)} mm,${toMm(options.heightDots, options.dpi)} mm`,
    "GAP 2 mm,0 mm",
    `DENSITY ${density}`,
    `SPEED ${speed}`,
    "DIRECTION 0",
    "CLS",
    "CODEPAGE UTF-8",
    `REFERENCE ${Math.round(options.offsets.xDots)},${Math.round(options.offsets.yDots)}`,
  ];
}

export const tsplRenderer: LabelRenderer = {
  language: "tspl",

  renderLabel(input: LabelInput, options: LabelRenderOptions): string {
    const at = scaleFor(options);
    const cellWidth = options.dpi === 300 ? 7 : 5;

    return [
      ...tsplHeader(options),
      tsplText(at(12), at(14), at(32), "CALIBRADO"),
      tsplText(at(12), at(54), at(20), input.labName),
      tsplText(at(12), at(92), at(24), `TAG: ${input.assetTag}`),
      tsplText(
        at(12),
        at(128),
        at(22),
        `DATA: ${formatLabelDate(input.calibrationDate)}`,
      ),
      tsplText(at(12), at(200), at(18), input.certNumber),
      `QRCODE ${at(236)},${at(44)},M,${cellWidth},A,0,"${escapeTsplText(input.verifyUrl)}"`,
      "PRINT 1",
    ].join("\n");
  },

  renderTestLabel(options: LabelRenderOptions): string {
    const width = Math.round(options.widthDots);
    const height = Math.round(options.heightDots);

    return [
      ...tsplHeader(options),
      `BOX 2,2,${width - 2},${height - 2},2`,
      tsplText(20, 24, 30, "CALIBRA TESTE"),
      tsplText(20, 70, 20, `${options.dpi}dpi ${width}x${height}`),
      "PRINT 1",
    ].join("\n");
  },
};
