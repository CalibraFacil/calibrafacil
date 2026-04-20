import { describe, expect, it } from 'vitest'

import { clampFrameToPage, mmToPx, pxToMm, snapMm } from './geometry'

describe('certificate designer geometry', () => {
  it('converts mm to px and back without unacceptable drift', () => {
    const px = mmToPx(25.4)

    expect(px).toBeCloseTo(96)
    expect(pxToMm(px)).toBeCloseTo(25.4)
  })

  it('snaps values to a 2mm grid', () => {
    expect(snapMm(10.9)).toBe(10)
    expect(snapMm(11.1)).toBe(12)
    expect(snapMm(11.1, 5)).toBe(10)
  })

  it('clamps frames inside an A4 portrait page', () => {
    expect(
      clampFrameToPage(
        { x: 205, y: 292, width: 20, height: 20 },
        { width: 210, height: 297 },
      ),
    ).toEqual({ x: 190, y: 277, width: 20, height: 20 })
  })

  it('clamps oversized blocks to page bounds', () => {
    expect(
      clampFrameToPage(
        { x: -10, y: -20, width: 250, height: 320 },
        { width: 210, height: 297 },
      ),
    ).toEqual({ x: 0, y: 0, width: 210, height: 297 })
  })

  it('handles zoom values consistently', () => {
    const value = 42
    const zoom = 1.25

    expect(pxToMm(mmToPx(value, zoom), zoom)).toBeCloseTo(value)
  })
})
