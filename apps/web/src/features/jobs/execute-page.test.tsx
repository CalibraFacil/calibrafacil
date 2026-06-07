// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobData } from '@/features/jobs/execution'

const navigate = vi.fn()

const apiMocks = vi.hoisted(() => ({
  saveExecution: vi.fn(),
  submitExecution: vi.fn(),
}))

const queryMocks = vi.hoisted(() => ({
  useActiveReferenceStandardsData: vi.fn(),
  useCompositionProfilesData: vi.fn(),
  useEffectiveEnvironmentalLimitsData: vi.fn(),
  useJobDetailData: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@/components/method-runtime/math-runtime', () => ({
  buildFormulaContext: (
    _method: unknown,
    source: { data?: Record<string, unknown> },
  ) => source.data ?? {},
  createMethodCalculationEngine: () => ({}),
  effectiveVariableBindings: () => [],
  evaluateFormulaRows: () => ({
    success: false,
    error: 'math engine is not used by execute page workflow tests',
  }),
  evaluateFormulaScalar: () => ({
    success: false,
    error: 'math engine is not used by execute page workflow tests',
  }),
  evaluateStructuredValidation: () => ({ passed: true }),
  normalizeMethodValidations: (validations: unknown) =>
    Array.isArray(validations) ? validations : [],
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => navigate,
}))

vi.mock('@/features/jobs/queries', () => queryMocks)

vi.mock('@/utils/api', () => ({
  calibraApi: {
    jobs: {
      saveExecution: apiMocks.saveExecution,
      submitExecution: apiMocks.submitExecution,
    },
  },
}))

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

import { ExecuteJobPage } from './execute-page'

describe('ExecuteJobPage workflow', () => {
  beforeEach(() => {
    // Fake timers (advancing with the real clock so async queries still resolve)
    // so SaveButton's success→saved setTimeout can be flushed on teardown
    // instead of firing after jsdom is gone (ReferenceError: window).
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    apiMocks.saveExecution.mockResolvedValue({ id: 7 })
    apiMocks.submitExecution.mockResolvedValue({ id: 7 })
    queryMocks.useJobDetailData.mockReturnValue({
      data: executableJob(),
      error: null,
      isLoading: false,
    })
    queryMocks.useActiveReferenceStandardsData.mockReturnValue({
      data: { data: [] },
    })
    queryMocks.useCompositionProfilesData.mockReturnValue({
      data: { data: [] },
    })
    queryMocks.useEffectiveEnvironmentalLimitsData.mockReturnValue({
      data: null,
    })
  })

  afterEach(() => {
    cleanup()
    // Flush SaveButton's pending timer while jsdom is still alive, then restore.
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('submits normalized execution data and returns to the jobs list', async () => {
    renderExecutePage()

    // The execution date starts empty and gates submission, so pick today first.
    fireEvent.change(screen.getByLabelText('Data'), {
      target: { value: new Date().toISOString().slice(0, 10) },
    })

    fireEvent.click(
      screen.getByRole('button', { name: /enviar para revisão/i }),
    )

    await waitFor(() => {
      expect(apiMocks.submitExecution).toHaveBeenCalledWith(
        'CAL-0007',
        expect.objectContaining({
          selectedStandardIds: [],
          data: { load: 10 },
          results: {},
          calibrationLocation: {
            type: 'lab',
            addressText: 'Rua Laboratorio',
            notes: null,
          },
        }),
      )
    })
    expect(toastMocks.success).toHaveBeenCalledWith('Job enviado para revisão!')
    expect(navigate).toHaveBeenCalledWith({ to: '/dashboard/jobs' })
  })

  it('saves execution edits and returns to sync conflicts when editing a local conflict', async () => {
    renderExecutePage({
      conflictReturn: {
        syncConflictId: 'conflict:job:7',
        returnTo: '/dashboard/sync/conflicts',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }))

    await waitFor(() => {
      expect(apiMocks.saveExecution).toHaveBeenCalledWith(
        'CAL-0007',
        expect.objectContaining({
          data: { load: 10 },
          results: {},
        }),
      )
    })
    expect(toastMocks.success).toHaveBeenCalledWith('Dados salvos com sucesso!')
    expect(navigate).toHaveBeenCalledWith({ to: '/dashboard/sync/conflicts' })
  })
})

function renderExecutePage({
  conflictReturn = {},
}: {
  conflictReturn?: Parameters<typeof ExecuteJobPage>[0]['conflictReturn']
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ExecuteJobPage id="CAL-0007" conflictReturn={conflictReturn} />
    </QueryClientProvider>,
  )
}

function executableJob(): JobData {
  return {
    id: 7,
    jobId: 'CAL-0007',
    status: 'DRAFT',
    customerName: 'Cliente Exemplo',
    assetName: 'Balanca',
    assetTag: 'BAL-01',
    assetTypeId: 1,
    serviceName: 'Calibracao',
    methodSnapshot: {
      methodId: 1,
      methodName: 'Metodo',
      methodVersion: 1,
      dataFields: [
        {
          key: 'load',
          label: 'Carga',
          type: 'number',
          required: true,
          unit: 'g',
        },
      ],
      formulas: [],
      validations: [],
      uncertaintyParams: [],
    },
    data: { load: 10 },
    results: null,
    standardsSnapshot: [],
    assetSnapshot: {
      assetId: 1,
      assetTypeId: 1,
      assetTypeName: 'Balanca',
      assetTypeSlug: 'scale',
      name: 'Balanca',
      tag: 'BAL-01',
      serialNumber: 'SN-01',
      manufacturer: null,
      model: null,
      specifications: {},
      capturedAt: '2026-05-20T00:00:00.000Z',
    },
    calibrationLocationSnapshot: {
      type: 'lab',
      addressText: 'Rua Laboratorio',
    },
  }
}
