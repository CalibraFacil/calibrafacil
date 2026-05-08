import { resolveApiURL } from '@/utils/api'

import type {
  MethodCompileResult,
  MethodDiagnostic,
  MethodDraft,
  MethodNormalizedFormula,
  MethodPreviewResult,
} from './types'

const ACTIVE_UNIT_KEY_PREFIX = 'dashboard-active-unit:'

function getActiveUnitHeader(): string | null {
  if (typeof window === 'undefined') return null

  const activeOrgId = window.localStorage.getItem('dashboard-active-org')
  if (!activeOrgId) return null

  return window.localStorage.getItem(`${ACTIVE_UNIT_KEY_PREFIX}${activeOrgId}`)
}

async function postJson<T>(
  path: string,
  body: unknown,
  options: { allowDiagnosticsResponse?: boolean } = {},
): Promise<T> {
  const headers = new Headers({ 'content-type': 'application/json' })
  const activeUnitId = getActiveUnitHeader()

  if (activeUnitId) {
    headers.set('x-active-unit-id', activeUnitId)
  }

  const response = await fetch(resolveApiURL(path), {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    let message = `Endpoint indisponível (${response.status})`
    let payload: unknown
    try {
      payload = await response.json()
      const errorPayload = payload as {
        error?: string
        diagnostics?: unknown
      }
      if (
        options.allowDiagnosticsResponse &&
        Array.isArray(errorPayload.diagnostics)
      ) {
        return payload as T
      }
      message = errorPayload.error || message
    } catch {
      // Keep the status-based message when the server did not return JSON.
    }

    throw new Error(message)
  }

  return response.json() as Promise<T>
}

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
  const result = await postJson<{
    diagnostics?: unknown
    fingerprint?: string
    normalizedFormulas?: unknown
    formulas?: unknown
    compiledMethod?: unknown
  }>('/api/methods/compile', { draft }, { allowDiagnosticsResponse: true })

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
  const result = await postJson<{
    diagnostics?: unknown
    results?: Record<string, unknown>
    outputs?: Record<string, unknown>
    normalizedData?: Record<string, unknown>
  }>('/api/methods/preview', params, { allowDiagnosticsResponse: true })

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
  return postJson(`/api/methods/${params.methodId}/publish`, {
    sampleData: params.sampleData,
    reasonForChange: params.reasonForChange,
  })
}

export async function requestMethodApproval(
  methodId: number,
  sampleData: Record<string, unknown>,
): Promise<unknown> {
  return postJson(`/api/methods/${methodId}/request-approval`, { sampleData })
}
