import { calibraApi } from '@/utils/api'

import type {
  MethodCompileResult,
  MethodDiagnostic,
  MethodDraft,
  MethodNormalizedFormula,
  MethodPreviewResult,
} from './types'

function normalizeDiagnostics(value: unknown): Array<MethodDiagnostic> {
  if (!Array.isArray(value)) return []

  return value.map((item) => {
    if (typeof item === 'string') {
      return { severity: 'error', message: item }
    }

    const diagnostic = item as Partial<MethodDiagnostic>
    return {
      code: diagnostic.code,
      severity: diagnostic.severity ?? 'error',
      message: diagnostic.message ?? 'Diagnóstico sem mensagem',
      path: diagnostic.path,
    }
  })
}

function normalizeFormulaList(value: unknown): Array<MethodNormalizedFormula> {
  if (Array.isArray(value)) {
    return value.map((formula) => {
      const item = formula as Partial<MethodNormalizedFormula>
      return {
        outputKey: item.outputKey ?? '',
        expression: item.expression ?? '',
        normalizedExpression:
          item.normalizedExpression ?? item.expression ?? '',
        scope: item.scope,
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
  const result = await calibraApi.methods.compileDraft<{
    diagnostics?: unknown
    fingerprint?: string
    normalizedFormulas?: unknown
    formulas?: unknown
    compiledMethod?: unknown
  }>({ draft })

  return {
    diagnostics: normalizeDiagnostics(result.diagnostics),
    fingerprint: result.fingerprint,
    normalizedFormulas: normalizeFormulaList(
      result.normalizedFormulas ?? result.formulas,
    ),
    compiledMethod: result.compiledMethod,
  }
}

export async function previewMethodDraft(params: {
  draft: MethodDraft
  sampleData: Record<string, unknown>
}): Promise<MethodPreviewResult> {
  const result = await calibraApi.methods.previewDraft<{
    diagnostics?: unknown
    results?: Record<string, unknown>
    outputs?: Record<string, unknown>
    normalizedData?: Record<string, unknown>
  }>(params)

  return {
    diagnostics: normalizeDiagnostics(result.diagnostics),
    results: result.results ?? result.outputs ?? {},
    normalizedData: result.normalizedData,
  }
}

export async function publishMethodDraft(params: {
  methodId: number
  sampleData: Record<string, unknown>
  reasonForChange?: string
}): Promise<unknown> {
  return calibraApi.methods.publishDraft(params.methodId, {
    sampleData: params.sampleData,
    reasonForChange: params.reasonForChange,
  })
}

export async function requestMethodApproval(
  methodId: number,
  sampleData: Record<string, unknown>,
): Promise<unknown> {
  return calibraApi.methods.requestApproval(methodId, { sampleData })
}
