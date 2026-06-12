import { describe, expect, it } from 'vitest'

import {
  convertMassValue,
  decimalsForResolution,
  formatWeighingRangeSpec,
  resolveWeighingRange,
  type WeighingRangeSpec,
} from './weighing-range-utils'

describe('decimalsForResolution', () => {
  it('counts fractional digits of common resolutions', () => {
    expect(decimalsForResolution(0.5)).toBe(1)
    expect(decimalsForResolution(0.1)).toBe(1)
    expect(decimalsForResolution(0.01)).toBe(2)
    expect(decimalsForResolution(0.001)).toBe(3)
    expect(decimalsForResolution(0.25)).toBe(2)
  })

  it('returns 0 for integer resolutions', () => {
    expect(decimalsForResolution(1)).toBe(0)
    expect(decimalsForResolution(2)).toBe(0)
    expect(decimalsForResolution(10)).toBe(0)
  })

  it('handles very small resolutions in exponential form', () => {
    expect(decimalsForResolution(1e-7)).toBe(7)
  })

  it('returns null for non-positive or non-finite values', () => {
    expect(decimalsForResolution(0)).toBeNull()
    expect(decimalsForResolution(-0.5)).toBeNull()
    expect(decimalsForResolution(Number.NaN)).toBeNull()
  })
})

const ranges: WeighingRangeSpec[] = [
  {
    label: '0 a 3 kg',
    min: 0,
    max: 3,
    rangeUnit: 'kg',
    resolution: 1,
    resolutionUnit: 'g',
  },
  {
    label: '3 a 6 kg',
    min: 3,
    max: 6,
    rangeUnit: 'kg',
    resolution: 2,
    resolutionUnit: 'g',
  },
  {
    label: '6 a 15 kg',
    min: 6,
    max: 15,
    rangeUnit: 'kg',
    resolution: 5,
    resolutionUnit: 'g',
  },
]

describe('weighing-range-utils', () => {
  it('resolves the first weighing range', () => {
    expect(resolveWeighingRange(2000, 'g', ranges)).toMatchObject({
      label: '0 a 3 kg',
      resolution: 1,
      resolutionUnit: 'g',
    })
  })

  it('resolves the middle weighing range', () => {
    expect(resolveWeighingRange(4000, 'g', ranges)).toMatchObject({
      label: '3 a 6 kg',
      resolution: 2,
      resolutionUnit: 'g',
    })
  })

  it('resolves the last weighing range', () => {
    expect(resolveWeighingRange(10, 'kg', ranges)).toMatchObject({
      label: '6 a 15 kg',
      resolution: 5,
      resolutionUnit: 'g',
    })
  })

  it('uses the first matching boundary in configured order', () => {
    expect(resolveWeighingRange(3000, 'g', ranges)).toMatchObject({
      label: '0 a 3 kg',
      resolution: 1,
    })
  })

  it('converts mixed mass units', () => {
    expect(convertMassValue(1500, 'mg', 'g')).toBe(1.5)
    expect(convertMassValue(1.5, 'kg', 'g')).toBe(1500)
    expect(convertMassValue(2500, 'g', 'kg')).toBe(2.5)
  })

  it('returns null for unsupported units or missing ranges', () => {
    expect(resolveWeighingRange(10, 'lb', ranges)).toBeNull()
    expect(resolveWeighingRange(10, 'kg', [])).toBeNull()
    expect(convertMassValue(1, 'lb', 'g')).toBeNull()
  })

  it('formats a Portuguese-readable range label', () => {
    expect(formatWeighingRangeSpec(ranges[0])).toBe(
      '0 a 3 kg: 0 a 3 kg, resolução 1 g',
    )
  })
})
