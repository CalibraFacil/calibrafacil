import { describe, expect, it } from 'vitest'

import {
  buildMassCompositionValue,
  collectMassCompositionStandardIds,
  convertMassValue,
  formatMassCompositionLabel,
  type MassCompositionItem,
} from './mass-composition-utils'

function item(
  overrides: Partial<MassCompositionItem> = {},
): MassCompositionItem {
  return {
    standardId: 1,
    standardName: 'JP01',
    certificateNumber: 'CERT-001',
    certifiedValueIndex: 0,
    nominal: '20 kg',
    quantity: 1,
    value: 20,
    uncertainty: 0.002,
    unit: 'kg',
    coverageFactor: 2,
    maxError: 0.01,
    drift: 0.003,
    buoyancy: 0.004,
    ...overrides,
  }
}

describe('mass composition utils', () => {
  it('sums one 20 kg standard into g', () => {
    const result = buildMassCompositionValue([item()], 'g')

    expect(result.totals.certifiedValue).toBe(20000)
  })

  it('sums one 20 kg standard into kg', () => {
    const result = buildMassCompositionValue([item()], 'kg')

    expect(result.totals.certifiedValue).toBe(20)
  })

  it('sums 2 x 20 kg + 1 x 10 kg', () => {
    const result = buildMassCompositionValue(
      [
        item({ quantity: 2 }),
        item({
          standardId: 2,
          standardName: 'JP03',
          nominal: '10 kg',
          value: 10,
          uncertainty: 0.001,
        }),
      ],
      'kg',
    )

    expect(result.totals.certifiedValue).toBe(50)
  })

  it('converts mixed mg, g and kg', () => {
    expect(convertMassValue(1000, 'mg', 'g')).toBe(1)
    expect(convertMassValue(1, 'kg', 'g')).toBe(1000)
    expect(convertMassValue(1000, 'g', 'kg')).toBe(1)
  })

  it('calculates expanded uncertainty as RSS by default (expanded_rss)', () => {
    const result = buildMassCompositionValue(
      [
        item({ quantity: 2, uncertainty: 0.002 }),
        item({ standardId: 2, uncertainty: 0.001 }),
      ],
      'kg',
    )

    expect(result.totals.expandedUncertainty).toBeCloseTo(
      Math.sqrt(0.004 ** 2 + 0.001 ** 2),
    )
  })

  it('sums expanded uncertainty arithmetically with expanded_arithmetic (cg-18 §7.1.2.1)', () => {
    const items = [
      item({ quantity: 2, uncertainty: 0.002 }),
      item({ standardId: 2, uncertainty: 0.001 }),
    ]

    const arithmetic = buildMassCompositionValue(items, 'kg', {
      uncertaintyMode: 'expanded_arithmetic',
    })
    const rss = buildMassCompositionValue(items, 'kg', {
      uncertaintyMode: 'expanded_rss',
    })

    // 2 × 0.002 + 1 × 0.001 = 0.005, the correlated (linear) combination.
    expect(arithmetic.totals.expandedUncertainty).toBeCloseTo(0.005)

    // The arithmetic sum is the conservative bound: always ≥ RSS, so it can
    // only over-state, never under-state (this is the fix for issue #506).
    const arithmeticU = arithmetic.totals.expandedUncertainty ?? 0
    const rssU = rss.totals.expandedUncertainty ?? 0
    expect(arithmeticU).toBeGreaterThan(rssU)
  })

  it('scales composition profile uncertainty linearly by quantity before RSS', () => {
    const result = buildMassCompositionValue(
      [
        item({
          quantity: 20,
          value: 20000,
          uncertainty: 0.08,
          unit: 'g',
          compositionProfile: true,
          profileKey: '20kg-M1',
        }),
      ],
      'g',
      { quantityMode: 'profile_linear' },
    )

    expect(result.totals.certifiedValue).toBeCloseTo(400000)
    expect(result.totals.expandedUncertainty).toBeCloseTo(1.6)
  })

  it('combines multiple linearly scaled composition profiles with RSS', () => {
    const result = buildMassCompositionValue(
      [
        item({
          quantity: 2,
          uncertainty: 0.08,
          unit: 'g',
          compositionProfile: true,
          profileKey: '20kg-M1',
        }),
        item({
          quantity: 3,
          uncertainty: 0.03,
          unit: 'g',
          compositionProfile: true,
          profileKey: '10kg-M1',
        }),
      ],
      'g',
      { quantityMode: 'profile_linear' },
    )

    expect(result.totals.expandedUncertainty).toBeCloseTo(
      Math.sqrt(0.16 ** 2 + 0.09 ** 2),
    )
  })

  it('calculates max error as a linear absolute sum when all items have metadata', () => {
    const result = buildMassCompositionValue(
      [
        item({ quantity: 2, maxError: -0.01 }),
        item({ standardId: 2, maxError: 0.02 }),
      ],
      'kg',
    )

    expect(result.totals.maxError).toBeCloseTo(0.04)
  })

  it('leaves max error null when one item lacks metadata', () => {
    const result = buildMassCompositionValue(
      [item(), item({ standardId: 2, maxError: null })],
      'kg',
    )

    expect(result.totals.maxError).toBeNull()
  })

  it('uses certified value drift when present', () => {
    const result = buildMassCompositionValue([item({ drift: 0.007 })], 'kg')

    expect(result.totals.drift).toBeCloseTo(0.007)
  })

  it('supports drift fallback supplied by the caller', () => {
    const result = buildMassCompositionValue([item({ drift: 0.005 })], 'kg')

    expect(result.totals.drift).toBeCloseTo(0.005)
  })

  it('rejects unsupported unit conversion', () => {
    const result = buildMassCompositionValue([item({ unit: 'lb' })], 'g')

    expect(result.totals.expandedUncertainty).toBeNull()
    expect(result.warnings[0]).toContain('Unidade lb não suportada')
  })

  it('builds a readable Portuguese composition label', () => {
    const label = formatMassCompositionLabel([
      item({ quantity: 2 }),
      item({ standardId: 2, standardName: 'JP03', nominal: '10 kg' }),
    ])

    expect(label).toBe('2 x 20 kg JP01 + 1 x 10 kg JP03')
  })

  it('builds a compact label for aggregate composition profiles', () => {
    const label = formatMassCompositionLabel([
      item({
        quantity: 5,
        nominal: '20 kg',
        compositionProfile: true,
        profileKey: '20kg-M1',
      }),
    ])

    expect(label).toBe('5 x 20kg-M1')
  })

  it('collects related standard ids for aggregate composition profiles', () => {
    const result = buildMassCompositionValue(
      [
        item({
          standardId: 999,
          standardIds: [1, 2, 3],
          compositionProfile: true,
          profileKey: '20kg-M1',
        }),
      ],
      'kg',
    )

    expect(
      collectMassCompositionStandardIds({
        pontos: [{ composicao: result }],
      }),
    ).toEqual([1, 2, 3])
  })

  it('warns when profile quantity exceeds the available profile count', () => {
    const result = buildMassCompositionValue(
      [
        item({
          quantity: 101,
          compositionProfile: true,
          profileKey: '20kg-M1',
          profileQuantityAvailable: 100,
        }),
      ],
      'kg',
      { quantityMode: 'profile_linear' },
    )

    expect(result.warnings[0]).toContain('excede a disponibilidade')
  })
})
