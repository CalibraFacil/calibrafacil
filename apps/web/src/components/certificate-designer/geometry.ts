import type {
  CertificateBlockFrame,
  CertificateTemplatePage,
} from '@calibra-facil/shared'

export const MM_PER_INCH = 25.4
export const PX_PER_INCH = 96

export type PageGeometry = Pick<CertificateTemplatePage, 'width' | 'height'>

export function mmToPx(mm: number, zoom = 1): number {
  return (mm / MM_PER_INCH) * PX_PER_INCH * zoom
}

export function pxToMm(px: number, zoom = 1): number {
  if (zoom <= 0) {
    return 0
  }

  return (px / zoom / PX_PER_INCH) * MM_PER_INCH
}

export function snapMm(value: number, gridMm = 2): number {
  if (gridMm <= 0) {
    return value
  }

  return Math.round(value / gridMm) * gridMm
}

export function clampFrameToPage(
  frame: CertificateBlockFrame,
  page: PageGeometry,
): CertificateBlockFrame {
  const width = Math.min(Math.max(frame.width, 0), page.width)
  const height = Math.min(Math.max(frame.height, 0), page.height)

  return {
    x: clamp(frame.x, 0, page.width - width),
    y: clamp(frame.y, 0, page.height - height),
    width,
    height,
  }
}

export function snapFrame(
  frame: CertificateBlockFrame,
  gridMm = 2,
): CertificateBlockFrame {
  return {
    x: snapMm(frame.x, gridMm),
    y: snapMm(frame.y, gridMm),
    width: snapMm(frame.width, gridMm),
    height: snapMm(frame.height, gridMm),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
