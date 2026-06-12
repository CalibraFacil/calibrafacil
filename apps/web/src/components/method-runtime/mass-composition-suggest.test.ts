import { describe, expect, it } from 'vitest'

import {
  describeMassDelta,
  parseQuickAdd,
  sortMassOptionsDesc,
  suggestMassComposition,
} from './mass-composition-suggest'
import type { MassCompositionOption } from './mass-composition-utils'

function option(
  overrides: Partial<MassCompositionOption> = {},
): MassCompositionOption {
  return {
    standardId: 1,
    standardName: 'JP01',
    certificateNumber: 'CERT-001',
    certifiedValueIndex: 0,
    nominal: '1 kg',
    value: 1,
    uncertainty: 0.001,
    unit: 'kg',
    coverageFactor: 2,
    optionLabel: '1 kg',
    ...overrides,
  }
}

describe('suggestMassComposition', () => {
  it('prefers a single exact-match option over decomposition', () => {
    const result = suggestMassComposition(2, 'kg', [
      option({ certifiedValueIndex: 0, nominal: '2 kg', value: 2 }),
      option({ certifiedValueIndex: 1, nominal: '1 kg', value: 1 }),
    ])
    expect(result?.items).toHaveLength(1)
    expect(result?.items[0].value).toBe(2)
    expect(result?.items[0].quantity).toBe(1)
    expect(result?.exact).toBe(true)
  })

  it('decomposes greedily when no single option matches', () => {
    const result = suggestMassComposition(2, 'kg', [option({ value: 1 })])
    expect(result?.items).toHaveLength(1)
    expect(result?.items[0].quantity).toBe(2)
    expect(result?.total).toBe(2)
    expect(result?.exact).toBe(true)
  })

  it('combines multiple denominations largest-first', () => {
    const result = suggestMassComposition(3.5, 'kg', [
      option({ certifiedValueIndex: 0, value: 2 }),
      option({ certifiedValueIndex: 1, value: 1 }),
      option({ certifiedValueIndex: 2, value: 0.5 }),
    ])
    const byValue = new Map(
      result?.items.map((item) => [item.value, item.quantity]),
    )
    expect(byValue.get(2)).toBe(1)
    expect(byValue.get(1)).toBe(1)
    expect(byValue.get(0.5)).toBe(1)
    expect(result?.exact).toBe(true)
  })

  it('breaks exact-match ties by lowest uncertainty', () => {
    const result = suggestMassComposition(1, 'kg', [
      option({
        certifiedValueIndex: 0,
        certificateNumber: 'A',
        uncertainty: 0.01,
      }),
      option({
        certifiedValueIndex: 1,
        certificateNumber: 'B',
        uncertainty: 0.001,
      }),
    ])
    expect(result?.items[0].certificateNumber).toBe('B')
  })

  it('normalizes units to the target unit', () => {
    const result = suggestMassComposition(1500, 'g', [
      option({ certifiedValueIndex: 0, nominal: '1 kg', value: 1, unit: 'kg' }),
      option({
        certifiedValueIndex: 1,
        nominal: '500 g',
        value: 500,
        unit: 'g',
      }),
    ])
    expect(result?.total).toBeCloseTo(1500, 6)
    expect(result?.exact).toBe(true)
  })

  it('ignores options with an unsupported unit', () => {
    const result = suggestMassComposition(1, 'kg', [
      option({ unit: 'lb' }),
      option({ certifiedValueIndex: 1, value: 1, unit: 'kg' }),
    ])
    expect(result?.items).toHaveLength(1)
    expect(result?.items[0].unit).toBe('kg')
  })

  it('respects profile availability caps', () => {
    const result = suggestMassComposition(2, 'kg', [
      option({
        certifiedValueIndex: 0,
        nominal: '1 kg',
        value: 1,
        compositionProfile: true,
        profileKey: '1 kg',
        profileQuantityAvailable: 1,
      }),
      option({
        certifiedValueIndex: 1,
        nominal: '0.5 kg',
        value: 0.5,
        compositionProfile: true,
        profileKey: '0.5 kg',
        profileQuantityAvailable: 4,
      }),
    ])
    const oneKg = result?.items.find((item) => item.value === 1)
    const halfKg = result?.items.find((item) => item.value === 0.5)
    expect(oneKg?.quantity).toBe(1)
    expect(halfKg?.quantity).toBe(2)
    expect(result?.exact).toBe(true)
  })

  it('returns the closest result when the target is unreachable', () => {
    const result = suggestMassComposition(1.4, 'kg', [
      option({
        certifiedValueIndex: 0,
        value: 1,
        compositionProfile: true,
        profileKey: '1 kg',
        profileQuantityAvailable: 1,
      }),
      option({
        certifiedValueIndex: 1,
        value: 0.5,
        compositionProfile: true,
        profileKey: '0.5 kg',
        profileQuantityAvailable: 1,
      }),
    ])
    expect(result?.total).toBeCloseTo(1.5, 6)
    expect(result?.exact).toBe(false)
    expect(result?.delta).toBeCloseTo(0.1, 6)
  })

  it('handles floating point exactly within tolerance', () => {
    const result = suggestMassComposition(0.3, 'g', [
      option({ certifiedValueIndex: 0, value: 0.2, unit: 'g' }),
      option({ certifiedValueIndex: 1, value: 0.1, unit: 'g' }),
    ])
    expect(result?.exact).toBe(true)
  })

  it('returns null for non-positive targets or no usable options', () => {
    expect(suggestMassComposition(0, 'kg', [option()])).toBeNull()
    expect(suggestMassComposition(-1, 'kg', [option()])).toBeNull()
    expect(suggestMassComposition(1, 'kg', [])).toBeNull()
    expect(suggestMassComposition(1, 'kg', [option({ unit: 'lb' })])).toBeNull()
  })
})

describe('suggestMassComposition class awareness', () => {
  it('excludes weights too coarse for a fine resolution', () => {
    const result = suggestMassComposition(
      1,
      'g',
      [
        option({
          certifiedValueIndex: 0,
          unit: 'g',
          value: 1,
          profileClass: 'F1',
          maxError: 0.00001,
        }),
        option({
          certifiedValueIndex: 1,
          unit: 'g',
          value: 1,
          profileClass: 'M1',
          maxError: 0.1,
        }),
      ],
      { resolution: 0.1 },
    )
    expect(result?.items).toHaveLength(1)
    expect(result?.items[0].profileClass).toBe('F1')
  })

  it('prefers the coarsest eligible class when several fit', () => {
    const result = suggestMassComposition(
      1000,
      'g',
      [
        option({
          certifiedValueIndex: 0,
          unit: 'g',
          value: 1000,
          profileClass: 'F1',
          maxError: 0.005,
          uncertainty: 0.001,
        }),
        option({
          certifiedValueIndex: 1,
          unit: 'g',
          value: 1000,
          profileClass: 'M1',
          maxError: 5,
          uncertainty: 0.5,
        }),
      ],
      { resolution: 500 },
    )
    expect(result?.items[0].profileClass).toBe('M1')
  })

  it('restricts to an explicit preferred class', () => {
    const result = suggestMassComposition(
      1000,
      'g',
      [
        option({
          certifiedValueIndex: 0,
          unit: 'g',
          value: 1000,
          profileClass: 'F1',
          maxError: 0.005,
        }),
        option({
          certifiedValueIndex: 1,
          unit: 'g',
          value: 1000,
          profileClass: 'M1',
          maxError: 5,
        }),
      ],
      { preferredClass: 'f1' },
    )
    expect(result?.items[0].profileClass).toBe('F1')
  })

  it('falls back to all classes when no criteria are given', () => {
    const result = suggestMassComposition(2, 'kg', [
      option({ certifiedValueIndex: 0, nominal: '2 kg', value: 2 }),
    ])
    expect(result?.items[0].value).toBe(2)
  })
})

describe('sortMassOptionsDesc', () => {
  it('sorts descending by converted value, unconvertible last', () => {
    const sorted = sortMassOptionsDesc(
      [
        option({ certifiedValueIndex: 0, value: 1, unit: 'kg' }),
        option({ certifiedValueIndex: 1, value: 500, unit: 'g' }),
        option({ certifiedValueIndex: 2, value: 5, unit: 'lb' }),
        option({ certifiedValueIndex: 3, value: 2, unit: 'kg' }),
      ],
      'g',
    )
    expect(sorted.map((o) => o.certifiedValueIndex)).toEqual([3, 0, 1, 2])
  })

  it('breaks value ties by lower uncertainty', () => {
    const sorted = sortMassOptionsDesc(
      [
        option({ certifiedValueIndex: 0, value: 1, uncertainty: 0.01 }),
        option({ certifiedValueIndex: 1, value: 1, uncertainty: 0.001 }),
      ],
      'kg',
    )
    expect(sorted.map((o) => o.certifiedValueIndex)).toEqual([1, 0])
  })
})

describe('parseQuickAdd', () => {
  it('parses an explicit Nx prefix', () => {
    expect(parseQuickAdd('3x 1 kg')).toEqual({ quantity: 3, query: '1 kg' })
    expect(parseQuickAdd('2*500')).toEqual({ quantity: 2, query: '500' })
    expect(parseQuickAdd('4×')).toEqual({ quantity: 4, query: '' })
  })

  it('treats bare digits as a filter, not a quantity', () => {
    expect(parseQuickAdd('10')).toEqual({ quantity: 1, query: '10' })
  })

  it('ignores a leading x without a number', () => {
    expect(parseQuickAdd('x2')).toEqual({ quantity: 1, query: 'x2' })
  })

  it('handles surrounding whitespace', () => {
    expect(parseQuickAdd('  2x  kg ')).toEqual({ quantity: 2, query: 'kg' })
  })
})

describe('describeMassDelta', () => {
  it('reports an unknown status without a target', () => {
    expect(describeMassDelta(5, null, 'kg')).toEqual({
      status: 'unknown',
      text: '',
    })
  })

  it('reports met within tolerance', () => {
    expect(describeMassDelta(2, 2, 'kg')).toEqual({
      status: 'met',
      text: 'Alvo atingido',
    })
  })

  it('reports a shortfall', () => {
    expect(describeMassDelta(1.5, 2, 'kg')).toEqual({
      status: 'short',
      text: 'Faltam 0.5 kg',
    })
  })

  it('reports an overshoot', () => {
    expect(describeMassDelta(2.5, 2, 'kg')).toEqual({
      status: 'over',
      text: 'Excede em 0.5 kg',
    })
  })
})
