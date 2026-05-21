import { describe, expect, it } from 'vitest'

import { buildInitialSampleData, parseJsonObject } from './sample-data'
import type { MethodDraft } from './types'

describe('method builder sample data', () => {
  it('parses preview JSON objects only', () => {
    expect(parseJsonObject('{"mass": 10}')).toEqual({ mass: 10 })
    expect(() => parseJsonObject('{')).toThrow('JSON inválido')
    expect(() => parseJsonObject('[1, 2]')).toThrow(
      'O preview precisa de um objeto JSON',
    )
  })

  it('builds representative sample data from draft inputs and bindings', () => {
    const sample = buildInitialSampleData({
      ...baseDraft(),
      inputs: [
        { key: 'mass', label: 'Massa', type: 'number' },
        {
          key: 'readings',
          label: 'Leituras',
          type: 'table',
          columns: [
            { key: 'point', label: 'Ponto', type: 'text' },
            { key: 'value', label: 'Valor', type: 'number' },
          ],
        },
      ],
      variables: [
        {
          key: 'temperature',
          source: 'environment',
          field: 'temperature',
        },
        {
          key: 'readingStd',
          source: 'table_statistic',
          fieldKey: 'readings',
          columnKey: 'value',
          statistic: 'sample_stddev',
        },
      ],
      measurementModels: [
        {
          key: 'gum',
          label: 'GUM',
          measurand: 'y',
          expression: 'y',
          quantities: [
            {
              symbol: 'x',
              source: {
                kind: 'table_column',
                tableKey: 'readings',
                columnKey: 'value',
              },
              uncertainty: {
                kind: 'direct_standard_uncertainty',
                standardUncertainty: 0,
              },
            },
          ],
        },
      ],
    })

    expect(sample.mass).toBe(0)
    expect(sample.environment).toEqual({
      temperature: 0,
      humidity: 0,
      pressure: 0,
    })
    expect(sample.readings).toEqual([{ value: 0 }, { value: 0 }])
  })
})

function baseDraft(): MethodDraft {
  return {
    name: 'Método',
    version: 1,
    status: 'DRAFT',
    inputs: [],
    variables: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertainty: [],
    certificate: null,
  }
}
