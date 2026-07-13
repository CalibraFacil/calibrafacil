/**
 * Cross-implementation parity contract: the browser's incremental formula
 * runtime (math-runtime.ts, driven by jobs/execution.ts while the technician
 * types) and the server's authoritative method runtime
 * (@calibra-facil/method-definition, run at submit/approve) must produce the
 * same numbers for the same method and readings.
 *
 * The two implementations are deliberately separate — the execution UI
 * evaluates formula-by-formula against a partial context; the server runs the
 * whole compiled method — but their statistics (mean/std/min/max over table
 * bindings), chained-output resolution and row-scope semantics must agree.
 * This spec pins that agreement with the REAL calculation engine on both
 * sides; a change to either implementation that skews certificate-relevant
 * numbers fails here instead of shipping.
 */
import { describe, expect, it } from 'vitest'

import {
  compileMethodDraft,
  executeCompiledMethod,
  type CalculationEngineLike,
  type MethodDraft,
} from '@calibra-facil/method-definition'

import {
  buildFormulaContext,
  createMethodCalculationEngine,
  effectiveVariableBindings,
  evaluateFormulaRows,
  evaluateFormulaScalar,
  type FormulaContext,
  type FormulaScalar,
} from './math-runtime'
import type { MethodInputField } from './types'

const READINGS = [100.2, 99.8, 100.4]
const NOMINAL = '100'

const EXPECTED = {
  erro_medio: (100.2 + 99.8 + 100.4) / 3 - 100,
  amplitude: 100.4 - 99.8,
  dobro_erro: ((100.2 + 99.8 + 100.4) / 3 - 100) * 2,
  desvio: [0.2, -0.2, 0.4],
}

type WebFormula = {
  outputKey: string
  expression: string
  scope?: { kind: 'scalar' } | { kind: 'table_row'; tableKey: string }
}

const WEB_METHOD: {
  dataFields: MethodInputField[]
  formulas: WebFormula[]
} = {
  dataFields: [
    { key: 'nominal', label: 'Nominal', type: 'number', unit: 'g' },
    {
      key: 'medicoes',
      label: 'Medições',
      type: 'table',
      columns: [{ key: 'indicacao', label: 'Indicação', type: 'number' }],
    },
  ],
  formulas: [
    {
      outputKey: 'erro_medio',
      expression: 'mean(medicoes_indicacao) - nominal',
    },
    {
      outputKey: 'amplitude',
      expression: 'max(medicoes_indicacao) - min(medicoes_indicacao)',
    },
    { outputKey: 'dobro_erro', expression: 'erro_medio * 2' },
    {
      outputKey: 'desvio',
      expression: 'medicoes_indicacao - nominal',
      scope: { kind: 'table_row', tableKey: 'medicoes' },
    },
  ],
}

function runWebExecution(): Record<string, FormulaScalar | FormulaScalar[]> {
  const engine = createMethodCalculationEngine()
  const context = buildFormulaContext(WEB_METHOD, {
    data: {
      nominal: NOMINAL,
      medicoes: READINGS.map((indicacao) => ({ indicacao })),
    },
  })

  // Mirrors the incremental loop in features/jobs/execution.ts: outputs feed
  // the running context; row-scoped formulas evaluate per row.
  const runningContext: FormulaContext = { ...context }
  const outputs: Record<string, FormulaScalar | FormulaScalar[]> = {}
  const arraySourceTables = new Map<string, string>()
  for (const binding of effectiveVariableBindings(WEB_METHOD)) {
    if (binding.source === 'table_column') {
      arraySourceTables.set(binding.key, binding.fieldKey)
    }
  }

  for (const formula of WEB_METHOD.formulas) {
    const tableKey =
      formula.scope?.kind === 'table_row' ? formula.scope.tableKey : null
    const result = tableKey
      ? evaluateFormulaRows(
          engine,
          formula.expression,
          runningContext,
          READINGS.length,
          tableKey,
          arraySourceTables,
        )
      : evaluateFormulaScalar(engine, formula.expression, runningContext)

    if (!result.success) {
      throw new Error(`${formula.outputKey}: ${result.error}`)
    }
    const value = 'values' in result ? result.values : result.value
    outputs[formula.outputKey] = value
    runningContext[formula.outputKey] = value
    if (tableKey) {
      arraySourceTables.set(formula.outputKey, tableKey)
    }
  }

  return outputs
}

function serverEngine(): CalculationEngineLike {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- same adapter apps/api and apps/local-server use: math-engine exposes a narrower concrete type than the method-definition execution seam.
  return createMethodCalculationEngine() as unknown as CalculationEngineLike
}

function serverDraft(): MethodDraft {
  return {
    id: 'parity_method',
    version: 1,
    status: 'draft',
    name: 'Paridade web/servidor',
    inputs: [
      { kind: 'scalar', key: 'nominal', label: 'Nominal', required: true },
      {
        kind: 'table',
        key: 'medicoes',
        label: 'Medições',
        columns: [{ key: 'indicacao', label: 'Indicação', type: 'number' }],
      },
      {
        kind: 'scalar',
        key: 'medicoes_indicacao',
        label: 'Indicação (coluna)',
        required: false,
        metadata: {
          source: 'variable_binding',
          bindingSource: 'table_column',
          fieldKey: 'medicoes',
          columnKey: 'indicacao',
        },
      },
    ],
    formulas: [
      {
        key: 'erro_medio',
        required: true,
        label: 'Erro médio',
        expression: 'mean(medicoes_indicacao) - nominal',
      },
      {
        key: 'amplitude',
        required: true,
        label: 'Amplitude',
        expression: 'max(medicoes_indicacao) - min(medicoes_indicacao)',
      },
      {
        key: 'dobro_erro',
        required: true,
        label: 'Dobro do erro',
        expression: 'erro_medio * 2',
      },
      {
        key: 'desvio',
        required: true,
        label: 'Desvio',
        expression: 'medicoes_indicacao - nominal',
        scope: { kind: 'table_row', tableKey: 'medicoes' },
      },
    ],
    measurementModels: [],
    acceptanceCriteria: [],
    previewScenarios: [],
    metadata: {},
  }
}

function runServerExecution(): Record<string, unknown> {
  const engine = serverEngine()
  const compiled = compileMethodDraft(serverDraft(), { engine })
  if (!compiled.ok) {
    throw new Error(JSON.stringify(compiled.diagnostics))
  }

  const execution = executeCompiledMethod(
    compiled.method,
    {
      inputs: {
        nominal: NOMINAL,
        medicoes: READINGS.map((indicacao) => ({ indicacao })),
      },
    },
    { engine },
  )
  if (!execution.ok) {
    throw new Error(JSON.stringify(execution.diagnostics))
  }

  return execution.outputs
}

function asNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error('expected an array output')
  return value.map((item) => Number(item))
}

describe('web execution runtime ↔ method-definition parity', () => {
  const web = runWebExecution()
  const server = runServerExecution()

  it.each(['erro_medio', 'amplitude', 'dobro_erro'] as const)(
    'agrees on %s (table statistics and chained outputs)',
    (key) => {
      const webValue = Number(web[key])
      const serverValue = Number(server[key])
      expect(webValue).toBeCloseTo(EXPECTED[key], 10)
      expect(serverValue).toBeCloseTo(EXPECTED[key], 10)
      expect(webValue).toBeCloseTo(serverValue, 12)
    },
  )

  it('agrees on row-scoped formulas value by value', () => {
    const webRows = asNumbers(web.desvio)
    const serverRows = asNumbers(server.desvio)
    expect(webRows).toHaveLength(EXPECTED.desvio.length)
    expect(serverRows).toHaveLength(EXPECTED.desvio.length)
    for (const [index, expected] of EXPECTED.desvio.entries()) {
      expect(webRows[index]).toBeCloseTo(expected, 10)
      expect(serverRows[index]).toBeCloseTo(expected, 10)
      expect(webRows[index]).toBeCloseTo(serverRows[index] ?? Number.NaN, 12)
    }
  })
})
