import {
  createCalculationEngine,
  isCalculationEngineError,
  type CalculationEngine,
} from '@calibra-facil/math-engine'

import type {
  MethodData,
  MethodInputField,
  MethodValidation,
  MethodVariableBinding,
} from './types'

export type FormulaScalar = number | string
export type FormulaContext = Record<string, FormulaScalar>

interface StandardLike {
  id: number
  uncertainty?: number | null
  coverageFactor?: number | null
  drift?: number | null
  certifiedValues?: Array<{
    nominal: string
    value: number
    uncertainty: number
  }> | null
}

interface FormulaContextSource {
  data: Record<string, unknown>
  environment?: {
    temperature?: number | null
    humidity?: number | null
    pressure?: number | null
  } | null
  standards?: StandardLike[]
}

export function createMethodCalculationEngine(): CalculationEngine {
  return createCalculationEngine({ numericMode: 'decimal' })
}

export function buildDefaultVariableBindings(
  dataFields: MethodInputField[],
): MethodVariableBinding[] {
  const bindings: MethodVariableBinding[] = []

  for (const field of dataFields) {
    if (field.type === 'number') {
      bindings.push({
        key: field.key,
        label: field.label,
        source: 'data_field',
        fieldKey: field.key,
      })
      continue
    }

    if (field.type === 'table') {
      for (const column of field.columns ?? []) {
        if (column.type !== 'number') continue
        for (const statistic of [
          'mean',
          'sample_stddev',
          'count',
          'min',
          'max',
        ] as const) {
          bindings.push({
            key: `${field.key}_${column.key}_${statistic}`,
            label: `${field.label} / ${column.label} / ${statistic}`,
            source: 'table_statistic',
            fieldKey: field.key,
            columnKey: column.key,
            statistic,
          })
        }
      }
    }
  }

  bindings.push(
    {
      key: 'env_temperature',
      label: 'Temperatura ambiente',
      source: 'environment',
      field: 'temperature',
    },
    {
      key: 'env_humidity',
      label: 'Umidade ambiente',
      source: 'environment',
      field: 'humidity',
    },
    {
      key: 'env_pressure',
      label: 'Pressão ambiente',
      source: 'environment',
      field: 'pressure',
    },
  )

  return bindings
}

export function effectiveVariableBindings(method: {
  dataFields: MethodInputField[]
  variableBindings?: MethodVariableBinding[] | null
}): MethodVariableBinding[] {
  return method.variableBindings?.length
    ? method.variableBindings
    : buildDefaultVariableBindings(method.dataFields)
}

export function normalizeMethodVariableBindings(method: MethodData): MethodData {
  return {
    ...method,
    variableBindings: effectiveVariableBindings(method),
  }
}

export function buildFormulaContext(
  method: {
    dataFields: MethodInputField[]
    variableBindings?: MethodVariableBinding[] | null
  },
  source: FormulaContextSource,
): FormulaContext {
  const context: FormulaContext = {}

  for (const binding of effectiveVariableBindings(method)) {
    const value = resolveBindingValue(binding, source)
    if (value !== null) {
      context[binding.key] = value
    }
  }

  return context
}

export function evaluateFormulaScalar(
  engine: CalculationEngine,
  expression: string,
  context: FormulaContext,
):
  | { success: true; value: FormulaScalar; valueText: string }
  | { success: false; error: string; errorCode?: string } {
  try {
    const result = engine.evaluateFormula(expression, context)
    return { success: true, value: result.value, valueText: result.valueText }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: isCalculationEngineError(error) ? error.code : undefined,
    }
  }
}

export function evaluateStructuredValidation(
  engine: CalculationEngine,
  validation: MethodValidation,
  context: FormulaContext,
): { passed?: boolean; error?: string; errorCode?: string } {
  const left = evaluateFormulaScalar(engine, validation.leftExpression, context)
  if (!left.success) return { error: left.error, errorCode: left.errorCode }

  const right = evaluateFormulaScalar(engine, validation.rightExpression, context)
  if (!right.success) return { error: right.error, errorCode: right.errorCode }

  const leftNumber = Number(left.value)
  const rightNumber = Number(right.value)
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return { error: 'Critério produziu valor não finito' }
  }

  return {
    passed: compareNumbers(leftNumber, validation.operator, rightNumber),
  }
}

function resolveBindingValue(
  binding: MethodVariableBinding,
  source: FormulaContextSource,
): FormulaScalar | null {
  switch (binding.source) {
    case 'data_field':
      return toFormulaScalar(source.data[binding.fieldKey])
    case 'table_statistic':
      return resolveTableStatistic(binding, source.data)
    case 'environment':
      return toFormulaScalar(source.environment?.[binding.field])
    case 'standard':
      return resolveStandardValue(binding, source.standards ?? [])
  }
}

function resolveTableStatistic(
  binding: Extract<MethodVariableBinding, { source: 'table_statistic' }>,
  data: Record<string, unknown>,
): FormulaScalar | null {
  const rows = data[binding.fieldKey]
  if (!Array.isArray(rows)) return null

  const values = rows
    .map((row) =>
      row && typeof row === 'object'
        ? toFiniteNumber((row as Record<string, unknown>)[binding.columnKey])
        : null,
    )
    .filter((value): value is number => value !== null)

  switch (binding.statistic) {
    case 'count':
      return values.length
    case 'mean':
      return values.length ? sum(values) / values.length : null
    case 'sample_stddev':
      return values.length >= 2 ? sampleStandardDeviation(values) : null
    case 'min':
      return values.length ? Math.min(...values) : null
    case 'max':
      return values.length ? Math.max(...values) : null
  }
}

function resolveStandardValue(
  binding: Extract<MethodVariableBinding, { source: 'standard' }>,
  standards: StandardLike[],
): FormulaScalar | null {
  const standard = binding.standardId
    ? standards.find((item) => item.id === binding.standardId)
    : standards[0]
  if (!standard) return null

  if (binding.valueKey === 'uncertainty') {
    return toFormulaScalar(standard.uncertainty)
  }
  if (binding.valueKey === 'coverageFactor' || binding.valueKey === 'k') {
    return toFormulaScalar(standard.coverageFactor)
  }
  if (binding.valueKey === 'drift') {
    return toFormulaScalar(standard.drift)
  }

  const certifiedValue = standard.certifiedValues?.find(
    (item) => item.nominal.replace(/\s+/g, '') === binding.valueKey,
  )
  if (certifiedValue) return certifiedValue.value

  const uncertaintyKey = binding.valueKey.endsWith('_u')
    ? binding.valueKey.slice(0, -2)
    : null
  if (uncertaintyKey) {
    return (
      standard.certifiedValues?.find(
        (item) => item.nominal.replace(/\s+/g, '') === uncertaintyKey,
      )?.uncertainty ?? null
    )
  }

  return null
}

function toFormulaScalar(value: unknown): FormulaScalar | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function sampleStandardDeviation(values: number[]): number {
  const mean = sum(values) / values.length
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) /
    (values.length - 1)
  return Math.sqrt(variance)
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0)
}

function compareNumbers(
  left: number,
  operator: MethodValidation['operator'],
  right: number,
): boolean {
  switch (operator) {
    case '<':
      return left < right
    case '<=':
      return left <= right
    case '>':
      return left > right
    case '>=':
      return left >= right
    case '==':
      return left === right
    case '!=':
      return left !== right
  }
}
