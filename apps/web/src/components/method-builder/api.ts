import { calibraApi } from '@/utils/api'

import type {
  MethodCompileResult,
  MethodDiagnostic,
  MethodDiagnosticSeverity,
  MethodDraft,
  MethodNormalizedFormula,
  MethodPreviewResult,
} from './types'

function normalizeDiagnosticSeverity(
  severity: unknown,
): MethodDiagnosticSeverity {
  switch (severity) {
    case 'warning':
    case 'info':
      return severity
    default:
      return 'error'
  }
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function normalizeFormulaScope(
  value: unknown,
): MethodNormalizedFormula['scope'] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const record = Object.fromEntries(Object.entries(value))
  if (record.kind === 'table_row' && typeof record.tableKey === 'string') {
    return { kind: 'table_row', tableKey: record.tableKey }
  }
  if (record.kind === 'scalar') return { kind: 'scalar' }
  return undefined
}

function normalizeDiagnostics(value: unknown): Array<MethodDiagnostic> {
  if (!Array.isArray(value)) return []

  return value.map((item) => {
    if (typeof item === 'string') {
      return { severity: 'error', message: item }
    }

    const diagnostic =
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item))
        : {}
    return {
      code: optionalString(diagnostic.code),
      severity: normalizeDiagnosticSeverity(diagnostic.severity),
      message: optionalString(diagnostic.message) ?? 'Diagnóstico sem mensagem',
      path: optionalString(diagnostic.path),
    }
  })
}

function normalizeFormulaList(value: unknown): Array<MethodNormalizedFormula> {
  if (Array.isArray(value)) {
    return value.map((formula) => {
      const item =
        formula && typeof formula === 'object' && !Array.isArray(formula)
          ? Object.fromEntries(Object.entries(formula))
          : {}
      return {
        outputKey: optionalString(item.outputKey) ?? '',
        expression: optionalString(item.expression) ?? '',
        normalizedExpression:
          optionalString(item.normalizedExpression) ??
          optionalString(item.expression) ??
          '',
        scope: normalizeFormulaScope(item.scope),
      }
    })
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([outputKey, expression]) => ({
      outputKey,
      expression: String(expression),
      normalizedExpression: String(expression),
    }))
  }

  return []
}

export async function compileMethodDraft(
  draft: MethodDraft,
): Promise<MethodCompileResult> {
  const result = await calibraApi.methods.compileDraft({ body: { draft } })

  return {
    diagnostics: normalizeDiagnostics(result.diagnostics),
    fingerprint: result.fingerprint ?? undefined,
    normalizedFormulas: normalizeFormulaList(result.normalizedFormulas),
    compiledMethod: result.compiledMethod,
  }
}

export async function previewMethodDraft(params: {
  draft: MethodDraft
  sampleData: Record<string, unknown>
}): Promise<MethodPreviewResult> {
  const result = await calibraApi.methods.previewDraft({ body: params })

  return {
    diagnostics: normalizeDiagnostics(result.diagnostics),
    results: result.results ?? {},
  }
}

export async function publishMethodDraft(params: {
  methodId: number
  sampleData: Record<string, unknown>
  reasonForChange?: string
}): Promise<unknown> {
  return calibraApi.methods.publishDraft({
    params: { id: params.methodId },
    body: {
      sampleData: params.sampleData,
      reasonForChange: params.reasonForChange,
    },
  })
}

export async function requestMethodApproval(
  methodId: number,
  sampleData: Record<string, unknown>,
): Promise<unknown> {
  return calibraApi.methods.requestApproval({
    params: { id: methodId },
    body: { sampleData },
  })
}
