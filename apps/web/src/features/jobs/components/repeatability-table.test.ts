import { describe, expect, it, vi } from 'vitest'

vi.mock('@calibra-facil/math-engine', () => ({
  createCalculationEngine: () => ({
    evaluateFormula: () => {
      throw new Error('math engine is not used by repeatability table tests')
    },
  }),
  isCalculationEngineError: () => false,
}))

import { buildRepeatabilityGroups } from './repeatability-table'
import type { ReviewMethodColumn } from '../detail-model'

const columns: ReviewMethodColumn[] = [
  { key: 'condicao', label: 'Condição', type: 'text' },
  { key: 'leitura_1', label: 'Antes leitura 1', type: 'number', unit: 'g' },
  { key: 'leitura_2', label: 'Antes leitura 2', type: 'number', unit: 'g' },
  { key: 'apos_leitura_1', label: 'Após leitura 1', type: 'number', unit: 'g' },
  { key: 'apos_leitura_2', label: 'Após leitura 2', type: 'number', unit: 'g' },
]

describe('buildRepeatabilityGroups', () => {
  it('transposes wide before/after readings into per-condition reading rows', () => {
    const groups = buildRepeatabilityGroups(columns, [
      {
        condicao: '1000 kg',
        leitura_1: 999,
        leitura_2: 998,
        apos_leitura_1: 1000,
        apos_leitura_2: 1001,
      },
    ])

    expect(groups).toHaveLength(1)
    const [group] = groups
    expect(group.conditionLabel).toBe('Condição')
    expect(group.condition).toBe('1000 kg')
    expect(group.readings).toEqual([
      { label: 'Leitura 1', before: 999, after: 1000 },
      { label: 'Leitura 2', before: 998, after: 1001 },
    ])
  })

  it('produces one group per condition row', () => {
    const groups = buildRepeatabilityGroups(columns, [
      { condicao: '500 kg', leitura_1: 500, apos_leitura_1: 500 },
      { condicao: '1000 kg', leitura_1: 999, apos_leitura_1: 1000 },
    ])

    expect(groups.map((group) => group.condition)).toEqual([
      '500 kg',
      '1000 kg',
    ])
  })

  it('classifies columns by phase metadata with bare "Leitura N" labels', () => {
    const phaseColumns: ReviewMethodColumn[] = [
      { key: 'condicao', label: 'Condição', type: 'text' },
      {
        key: 'leitura_1',
        label: 'Leitura 1',
        type: 'number',
        unit: 'g',
        phase: 'before',
      },
      {
        key: 'apos_leitura_1',
        label: 'Leitura 1',
        type: 'number',
        unit: 'g',
        phase: 'after',
      },
    ]

    const [group] = buildRepeatabilityGroups(phaseColumns, [
      { condicao: '1000 kg', leitura_1: 999, apos_leitura_1: 1000 },
    ])

    expect(group.readings).toEqual([
      { label: 'Leitura 1', before: 999, after: 1000 },
    ])
  })

  it('ignores non-record and empty values', () => {
    expect(buildRepeatabilityGroups(columns, null)).toEqual([])
    expect(buildRepeatabilityGroups(columns, [null, 'x', 42])).toEqual([])
  })
})
