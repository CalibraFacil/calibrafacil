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
export type FormulaValue = FormulaScalar | FormulaScalar[]
export type FormulaContext = Record<string, FormulaValue>

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
        bindings.push({
          key: `${field.key}_${column.key}`,
          label: `${field.label} / ${column.label}`,
          source: 'table_column',
          fieldKey: field.key,
          columnKey: column.key,
        })

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
  const defaults = buildDefaultVariableBindings(method.dataFields)
  const seen = new Set<string>()
  const bindings: MethodVariableBinding[] = []

  for (const binding of method.variableBindings ?? []) {
    if (
      seen.has(binding.key) ||
      !isBindingCompatible(binding, method.dataFields)
    ) {
      continue
    }
    bindings.push(binding)
    seen.add(binding.key)
  }

  for (const binding of defaults) {
    if (seen.has(binding.key)) continue
    bindings.push(binding)
    seen.add(binding.key)
  }

  return bindings
}

export function normalizeMethodVariableBindings(
  method: MethodData,
): MethodData {
  return {
    ...method,
    variableBindings: effectiveVariableBindings(method),
    validations: normalizeMethodValidations(method.validations),
  }
}

export function normalizeMethodValidations(
  validations: unknown,
): MethodValidation[] {
  if (!Array.isArray(validations)) return []
  return validations.map(normalizeMethodValidation)
}

export function normalizeMethodValidation(
  validation: unknown,
): MethodValidation {
  if (!validation || typeof validation !== 'object') {
    return validationFallback('')
  }

  const value = Object.fromEntries(Object.entries(validation))
  if (
    typeof value.leftExpression === 'string' &&
    typeof value.operator === 'string' &&
    isValidationOperator(value.operator) &&
    typeof value.rightExpression === 'string'
  ) {
    return {
      leftExpression: value.leftExpression,
      operator: value.operator,
      rightExpression: value.rightExpression,
      message:
        typeof value.message === 'string' && value.message.trim()
          ? value.message
          : 'Critério de aceitação',
      severity: value.severity === 'warning' ? 'warning' : 'error',
    }
  }

  if (typeof value.expression === 'string') {
    return normalizeMethodValidationExpression(
      value.expression,
      typeof value.message === 'string' && value.message.trim()
        ? value.message
        : 'Critério de aceitação',
      value.severity === 'warning' ? 'warning' : 'error',
    )
  }

  return validationFallback('')
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

  addStandardCompatibilityVariables(context, source.standards ?? [])

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
    const prepared = prepareFormulaEvaluation(expression, context)
    const result = engine.evaluateFormula(prepared.expression, prepared.context)
    return { success: true, value: result.value, valueText: result.valueText }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: isCalculationEngineError(error) ? error.code : undefined,
    }
  }
}

export function evaluateFormulaRows(
  engine: CalculationEngine,
  expression: string,
  context: FormulaContext,
  rowCount: number,
  tableKey: string,
  arraySourceTables: ReadonlyMap<string, string>,
):
  | { success: true; values: FormulaScalar[] }
  | { success: false; error: string; errorCode?: string } {
  const values: FormulaScalar[] = []

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowContext: FormulaContext = {}

    for (const [key, value] of Object.entries(context)) {
      if (Array.isArray(value)) {
        if (arraySourceTables.get(key) === tableKey) {
          if (value[rowIndex] === undefined) continue
          rowContext[key] = value[rowIndex]
        }
        continue
      }

      rowContext[key] = value
    }

    const result = evaluateFormulaScalar(engine, expression, rowContext)
    if (!result.success) return result

    values[rowIndex] = result.value
  }

  return { success: true, values }
}

export function evaluateStructuredValidation(
  engine: CalculationEngine,
  validation: MethodValidation,
  context: FormulaContext,
): { passed?: boolean; error?: string; errorCode?: string } {
  const left = evaluateFormulaScalar(engine, validation.leftExpression, context)
  if (!left.success) return { error: left.error, errorCode: left.errorCode }

  const right = evaluateFormulaScalar(
    engine,
    validation.rightExpression,
    context,
  )
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
): FormulaValue | null {
  switch (binding.source) {
    case 'data_field':
      return toFormulaScalar(source.data[binding.fieldKey])
    case 'table_column':
      return resolveTableColumn(binding, source.data)
    case 'table_statistic':
      return resolveTableStatistic(binding, source.data)
    case 'environment':
      return toFormulaScalar(source.environment?.[binding.field])
    case 'standard':
      return resolveStandardValue(binding, source.standards ?? [])
  }
}

function resolveTableColumn(
  binding: Extract<MethodVariableBinding, { source: 'table_column' }>,
  data: Record<string, unknown>,
): number[] | null {
  const values = tableColumnNumbers(binding.fieldKey, binding.columnKey, data)
  return values.length ? values : null
}

function resolveTableStatistic(
  binding: Extract<MethodVariableBinding, { source: 'table_statistic' }>,
  data: Record<string, unknown>,
): FormulaScalar | null {
  const values = tableColumnNumbers(binding.fieldKey, binding.columnKey, data)
  if (!values.length && binding.statistic !== 'count') return null

  switch (binding.statistic) {
    case 'count':
      return values.length
    case 'mean':
      return sum(values) / values.length
    case 'sample_stddev':
      return values.length >= 2 ? sampleStandardDeviation(values) : null
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
  }
}

function tableColumnNumbers(
  fieldKey: string,
  columnKey: string,
  data: Record<string, unknown>,
): number[] {
  const rows = data[fieldKey]
  if (!Array.isArray(rows)) return []

  return rows
    .map((row) =>
      row && typeof row === 'object'
        ? toFiniteNumber(Object.fromEntries(Object.entries(row))[columnKey])
        : null,
    )
    .filter((value): value is number => value !== null)
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

function addStandardCompatibilityVariables(
  context: FormulaContext,
  standards: StandardLike[],
): void {
  for (const standard of standards) {
    const prefix = `std_${standard.id}`
    assignContextScalar(context, `${prefix}_uncertainty`, standard.uncertainty)
    assignContextScalar(context, `${prefix}_k`, standard.coverageFactor)
    assignContextScalar(
      context,
      `${prefix}_coverageFactor`,
      standard.coverageFactor,
    )
    assignContextScalar(context, `${prefix}_drift`, standard.drift)

    for (const certifiedValue of standard.certifiedValues ?? []) {
      const nominalKey = certifiedValue.nominal.replace(/\s+/g, '')
      assignContextScalar(
        context,
        `${prefix}_${nominalKey}`,
        certifiedValue.value,
      )
      assignContextScalar(
        context,
        `${prefix}_${nominalKey}_u`,
        certifiedValue.uncertainty,
      )
    }
  }
}

function assignContextScalar(
  context: FormulaContext,
  key: string,
  value: unknown,
): void {
  const scalar = toFormulaScalar(value)
  if (scalar !== null) context[key] = scalar
}

function prepareFormulaEvaluation(
  expression: string,
  context: FormulaContext,
): { expression: string; context: Record<string, FormulaScalar> } {
  const scalarContext = toEngineContext(context)
  let index = 0
  const expressionWithConditionals = rewriteRuntimeConditionals(
    expression,
    context,
  )
  const rewrittenExpression = expressionWithConditionals.replace(
    /\b(mean|std|min|max)\s*\(\s*(\[[^\]]*\]|[A-Za-z][A-Za-z0-9_]*)\s*(?:,\s*(\d+))?\s*\)/g,
    (match, functionName: string, argument: string, correction?: string) => {
      const values = resolveInlineNumericArguments(argument, context)
      if (!values.length) return match

      const value =
        functionName === 'mean'
          ? sum(values) / values.length
          : functionName === 'std'
            ? correctedStandardDeviation(values, Number(correction ?? 1))
            : functionName === 'min'
              ? Math.min(...values)
              : Math.max(...values)
      if (!Number.isFinite(value)) return match

      const key = `runtime_${index++}`
      scalarContext[key] = value
      return key
    },
  )

  return { expression: rewrittenExpression, context: scalarContext }
}

function rewriteRuntimeConditionals(
  expression: string,
  context: FormulaContext,
): string {
  let output = expression
  let searchIndex = 0

  while (searchIndex < output.length) {
    const startIndex = output.indexOf('if_zero(', searchIndex)
    if (startIndex < 0) break

    const call = parseRuntimeFunctionCall(output, startIndex, 'if_zero')
    if (!call || call.args.length !== 3) {
      searchIndex = startIndex + 1
      continue
    }

    const condition = resolveScalarNumericToken(call.args[0], context)
    if (condition === null) {
      searchIndex = startIndex + 1
      continue
    }

    const branch = condition === 0 ? call.args[1] : call.args[2]
    const replacement = `(${branch})`
    output = `${output.slice(0, startIndex)}${replacement}${output.slice(call.endIndex)}`
    searchIndex = startIndex + replacement.length
  }

  return output
}

function parseRuntimeFunctionCall(
  expression: string,
  startIndex: number,
  functionName: string,
): { args: string[]; endIndex: number } | null {
  const prefix = `${functionName}(`
  if (!expression.startsWith(prefix, startIndex)) return null

  const args: string[] = []
  const argumentStartIndex = startIndex + prefix.length
  let currentArgumentStart = argumentStartIndex
  let depth = 0

  for (let index = argumentStartIndex; index < expression.length; index += 1) {
    const char = expression[index]
    if (char === '(') {
      depth += 1
      continue
    }

    if (char === ')') {
      if (depth === 0) {
        args.push(expression.slice(currentArgumentStart, index).trim())
        return { args, endIndex: index + 1 }
      }
      depth -= 1
      continue
    }

    if (char === ',' && depth === 0) {
      args.push(expression.slice(currentArgumentStart, index).trim())
      currentArgumentStart = index + 1
    }
  }

  return null
}

function resolveScalarNumericToken(
  token: string,
  context: FormulaContext,
): number | null {
  const trimmed = token.trim()
  const literal = toFiniteNumber(trimmed)
  if (literal !== null) return literal

  const value = context[trimmed]
  return Array.isArray(value) ? null : toFiniteNumber(value)
}

function toEngineContext(
  context: FormulaContext,
): Record<string, FormulaScalar> {
  const scalarContext: Record<string, FormulaScalar> = {}
  for (const [key, value] of Object.entries(context)) {
    if (Array.isArray(value)) continue
    scalarContext[key] = value
  }
  return scalarContext
}

function resolveInlineNumericArguments(
  argument: string,
  context: FormulaContext,
): number[] {
  const trimmed = argument.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .flatMap((item) => resolveInlineNumericToken(item.trim(), context))
  }
  return resolveInlineNumericToken(trimmed, context)
}

function resolveInlineNumericToken(
  token: string,
  context: FormulaContext,
): number[] {
  if (!token) return []

  const literal = toFiniteNumber(token)
  if (literal !== null) return [literal]

  const value = context[token]
  if (Array.isArray(value)) {
    return value
      .map((item) => toFiniteNumber(item))
      .filter((item): item is number => item !== null)
  }

  const scalar = toFiniteNumber(value)
  return scalar === null ? [] : [scalar]
}

function correctedStandardDeviation(
  values: number[],
  correction: number,
): number {
  const denominator = values.length - correction
  if (denominator <= 0) return Number.NaN

  const mean = sum(values) / values.length
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / denominator
  return Math.sqrt(variance)
}

function isBindingCompatible(
  binding: MethodVariableBinding,
  dataFields: MethodInputField[],
): boolean {
  switch (binding.source) {
    case 'data_field':
      return dataFields.some(
        (field) => field.key === binding.fieldKey && field.type === 'number',
      )
    case 'table_column':
    case 'table_statistic':
      return dataFields.some(
        (field) =>
          field.key === binding.fieldKey &&
          field.type === 'table' &&
          field.columns?.some(
            (column) =>
              column.key === binding.columnKey && column.type === 'number',
          ),
      )
    case 'environment':
    case 'standard':
      return true
  }
}

function normalizeMethodValidationExpression(
  expression: string,
  message: string,
  severity: MethodValidation['severity'],
): MethodValidation {
  const match = expression.match(/^\s*(.+?)\s*(<=|>=|==|!=|<|>)\s*(.+?)\s*$/)

  const operator = parseValidationOperator(match?.[2])

  return {
    leftExpression: match?.[1]?.trim() || expression,
    operator,
    rightExpression: match?.[3]?.trim() || '0',
    message,
    severity,
  }
}

function parseValidationOperator(
  operator: string | undefined,
): MethodValidation['operator'] {
  switch (operator) {
    case '<=':
    case '>=':
    case '==':
    case '!=':
    case '<':
    case '>':
      return operator
    default:
      return '!='
  }
}

function validationFallback(expression: string): MethodValidation {
  return normalizeMethodValidationExpression(
    expression || '0',
    'Critério de aceitação',
    'error',
  )
}

function isValidationOperator(
  operator: string,
): operator is MethodValidation['operator'] {
  return ['<', '<=', '>', '>=', '==', '!='].includes(operator)
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
