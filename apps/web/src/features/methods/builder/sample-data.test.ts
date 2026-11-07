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

    expect(sample.mass).toBe(1)
    expect(sample.environment).toEqual({
      temperature: 20,
      humidity: 50,
      pressure: 1013.25,
    })
    // Distinct per row: identical rows gave a sample standard deviation of 0,
    // which divides by zero in the Welch-Satterthwaite formula.
    expect(sample.readings).toEqual([{ value: 1 }, { value: 2 }])
  })

  /**
   * REGRESSION: every numeric slot used to be seeded with 0, so Preview failed
   * with "Division by zero is not allowed" on any formula dividing by an input
   * — the k of the standard's certificate, the eccentricity test load — and
   * then cascaded "Formula input is missing a required variable" through every
   * formula downstream. The publish-preview gate was unreachable for a real GUM
   * method unless the lab hand-wrote the sample JSON.
   */
  it('never seeds a zero, so formulas can divide by any input', () => {
    const sample = buildInitialSampleData({
      ...baseDraft(),
      inputs: [
        { key: 'resolucao', label: 'Resolução', type: 'number' },
        {
          key: 'pontos_pesagem',
          label: 'Pontos',
          type: 'table',
          columns: [
            { key: 'ponto', label: 'Ponto', type: 'text' },
            { key: 'm_ref', label: 'Massa de referência', type: 'number' },
            { key: 'k_referencia', label: 'k do padrão', type: 'number' },
            {
              key: 'carga_excentricidade',
              label: 'Carga de excentricidade',
              type: 'number',
            },
          ],
        },
      ],
      variables: [
        {
          key: 'k_referencia',
          source: 'table_column',
          fieldKey: 'pontos_pesagem',
          columnKey: 'k_referencia',
        },
        { key: 'temperatura', source: 'environment', field: 'temperature' },
      ],
    })

    for (const value of collectNumbers(sample)) {
      expect(value).not.toBe(0)
    }
  })

  it('seeds a numeric field with its declared default value', () => {
    const sample = buildInitialSampleData({
      ...baseDraft(),
      inputs: [
        { key: 'k', label: 'Fator k', type: 'number', defaultValue: 2 },
        { key: 'd', label: 'Divisão', type: 'number', defaultValue: '0.01' },
        { key: 'livre', label: 'Livre', type: 'number' },
      ],
    })

    expect(sample.k).toBe(2)
    expect(sample.d).toBe(0.01)
    expect(sample.livre).toBe(1)
  })
})

function collectNumbers(value: unknown): Array<number> {
  if (typeof value === 'number') return [value]
  if (Array.isArray(value)) return value.flatMap(collectNumbers)
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectNumbers)
  }
  return []
}

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
