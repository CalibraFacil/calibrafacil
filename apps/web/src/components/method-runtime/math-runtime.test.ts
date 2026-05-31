import { describe, expect, it, vi } from 'vitest'

vi.mock('@calibra-facil/math-engine', () => ({
  createCalculationEngine: () => ({
    evaluateFormula: (expression: string, inputs: Record<string, number>) => {
      if (expression === 'runtime_0') {
        return {
          value: inputs.runtime_0,
          valueText: String(inputs.runtime_0),
        }
      }
      if (expression === 'runtime_0 / sqrt(3)') {
        return {
          value: inputs.runtime_0 / Math.sqrt(3),
          valueText: String(inputs.runtime_0 / Math.sqrt(3)),
        }
      }
      if (expression === '(1000000000)') {
        return {
          value: 1000000000,
          valueText: '1000000000',
        }
      }
      if (expression === '(2)') {
        return {
          value: 2,
          valueText: '2',
        }
      }
      throw new Error(`Unexpected expression: ${expression}`)
    },
  }),
  isCalculationEngineError: () => false,
}))

import {
  createMethodCalculationEngine,
  evaluateFormulaScalar,
  evaluateFormulaRows,
  type FormulaContext,
} from './math-runtime'

describe('math-runtime row formulas', () => {
  it('evaluates row-scoped std formulas per table row instead of flattening columns', () => {
    const engine = createMethodCalculationEngine()
    const context: FormulaContext = {
      pontos_indicacao_apos_leitura_1: [500000, 999500, 1499500, 1999500],
      pontos_indicacao_apos_leitura_2: [499500, 999500, 1499500, 1999500],
      pontos_indicacao_apos_leitura_3: [499500, 999500, 1499500, 1999500],
    }
    const sourceTables = new Map([
      ['pontos_indicacao_apos_leitura_1', 'pontos_indicacao'],
      ['pontos_indicacao_apos_leitura_2', 'pontos_indicacao'],
      ['pontos_indicacao_apos_leitura_3', 'pontos_indicacao'],
    ])

    const result = evaluateFormulaRows(
      engine,
      'std([pontos_indicacao_apos_leitura_1, pontos_indicacao_apos_leitura_2, pontos_indicacao_apos_leitura_3], 1) / sqrt(3)',
      context,
      4,
      'pontos_indicacao',
      sourceTables,
    )

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.values[0]).toBeCloseTo(166.6666666667, 9)
    expect(result.values[1]).toBeCloseTo(0, 12)
    expect(result.values[2]).toBeCloseTo(0, 12)
    expect(result.values[3]).toBeCloseTo(0, 12)
  })

  it('does not pair row formulas with column arrays from other tables', () => {
    const engine = createMethodCalculationEngine()
    const context: FormulaContext = {
      current_table_reading: [10, 20],
      unrelated_table_reading: [30, 40],
    }
    const sourceTables = new Map([
      ['current_table_reading', 'current_table'],
      ['unrelated_table_reading', 'unrelated_table'],
    ])

    const result = evaluateFormulaRows(
      engine,
      'std([current_table_reading, unrelated_table_reading], 1) / sqrt(3)',
      context,
      2,
      'current_table',
      sourceTables,
    )

    expect(result.success).toBe(false)
  })

  it('evaluates aggregate max and min over formula arrays', () => {
    const engine = createMethodCalculationEngine()
    const context: FormulaContext = {
      desvio_excentricidade_abs: [0, 0.2, 0.1, 0.4, 0.3],
    }

    const maxResult = evaluateFormulaScalar(
      engine,
      'max(desvio_excentricidade_abs)',
      context,
    )
    const minResult = evaluateFormulaScalar(
      engine,
      'min(desvio_excentricidade_abs)',
      context,
    )

    expect(maxResult.success).toBe(true)
    expect(minResult.success).toBe(true)
    if (!maxResult.success || !minResult.success) return

    expect(maxResult.value).toBe(0.4)
    expect(minResult.value).toBe(0)
  })

  it('reduces if_zero branches when the local preview condition is known', () => {
    const engine = createMethodCalculationEngine()
    const context: FormulaContext = {
      u_repetibilidade_indicacao_antes: 0,
      u_combinada_antes: 0.145295,
      veff_antes: 1000000000,
    }

    const veffResult = evaluateFormulaScalar(
      engine,
      'if_zero(u_repetibilidade_indicacao_antes, 1000000000, ((u_combinada_antes ^ 4) / ((u_repetibilidade_indicacao_antes ^ 4) / 2)))',
      context,
    )
    const coverageResult = evaluateFormulaScalar(
      engine,
      'if_zero(u_repetibilidade_indicacao_antes, 2, student_t_inverse_2t(0.0455, veff_antes))',
      context,
    )

    expect(veffResult.success).toBe(true)
    expect(coverageResult.success).toBe(true)
    if (!veffResult.success || !coverageResult.success) return

    expect(veffResult.value).toBe(1000000000)
    expect(coverageResult.value).toBe(2)
  })
})
