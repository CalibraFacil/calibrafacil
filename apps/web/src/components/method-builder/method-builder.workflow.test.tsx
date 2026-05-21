// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MethodBuilder } from './method-builder'
import type { MethodDraft } from './types'

const apiMocks = vi.hoisted(() => ({
  compileMethodDraft: vi.fn(),
  previewMethodDraft: vi.fn(),
  publishMethodDraft: vi.fn(),
  requestMethodApproval: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('./api', () => apiMocks)

vi.mock('@/features/assets/queries', () => ({
  useAssetTypesData: () => ({ data: { data: [] } }),
}))

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

function makeDraft(patch: Partial<MethodDraft> = {}): MethodDraft {
  return {
    id: 10,
    name: 'Método inicial',
    description: '',
    version: 1,
    status: 'DRAFT',
    inputs: [
      {
        key: 'measurement',
        label: 'Medição',
        type: 'number',
        required: true,
      },
    ],
    variables: [],
    formulas: [
      {
        outputKey: 'result',
        expression: 'measurement + 1',
        scope: { kind: 'scalar' },
      },
    ],
    measurementModels: [],
    validations: [],
    uncertainty: [],
    certificate: {
      referenceStandards: [],
      sections: [],
    },
    ...patch,
  }
}

function renderBuilder({
  draft = makeDraft(),
  onSave = vi.fn(),
}: {
  draft?: MethodDraft
  onSave?: (draft: MethodDraft) => void | Promise<unknown>
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <MethodBuilder initialDraft={draft} onSave={onSave} onCancel={vi.fn()} />
    </QueryClientProvider>,
  )

  return { onSave }
}

describe('MethodBuilder workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('saves the edited draft instead of the initial draft', () => {
    const onSave = vi.fn()
    renderBuilder({ onSave })

    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Método revisado' },
    })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Método revisado' }),
    )
  })

  it('compiles the current draft and renders server diagnostics', async () => {
    apiMocks.compileMethodDraft.mockResolvedValue({
      diagnostics: [
        {
          severity: 'info',
          message: 'Fórmula normalizada',
          code: 'FORMULA_OK',
        },
      ],
      fingerprint: 'fp-method-123',
      normalizedFormulas: [
        {
          outputKey: 'result',
          expression: 'measurement + 1',
          normalizedExpression: 'measurement + 1',
          scope: { kind: 'scalar' },
        },
      ],
    })

    renderBuilder()

    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Método compilado' },
    })
    fireEvent.click(screen.getByRole('button', { name: /compilar/i }))

    await waitFor(() => expect(apiMocks.compileMethodDraft).toHaveBeenCalled())
    expect(apiMocks.compileMethodDraft.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ name: 'Método compilado' }),
    )
    expect(await screen.findByText('fp-method-123')).toBeTruthy()
    expect(screen.getByText('FORMULA_OK')).toBeTruthy()
  })

  it('surfaces invalid preview JSON without calling the preview endpoint', async () => {
    renderBuilder()

    fireEvent.change(screen.getByLabelText('Dados de exemplo'), {
      target: { value: '{' },
    })
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith('JSON inválido'),
    )
    expect(apiMocks.previewMethodDraft).not.toHaveBeenCalled()
    expect(
      screen.getByText(/Endpoint de preview ainda não respondeu/),
    ).toBeTruthy()
  })
})
