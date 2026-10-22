// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { buildJobMutationResponse } from '@calibra-facil/contracts/jobs-fixtures'
import { buildJobExecutionWarning } from '@calibra-facil/contracts/jobs-fixtures'
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
    error: 'math engine is not used by the standard warning tests',
  }),
  evaluateFormulaScalar: () => ({
    success: false,
    error: 'math engine is not used by the standard warning tests',
  }),
  evaluateStructuredValidation: () => ({ passed: true }),
  normalizeMethodValidations: (validations: unknown) =>
    Array.isArray(validations) ? validations : [],
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
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

const WARNING_COPY =
  'Padrão Massa A não está mais válido (certificado vencido); a submissão será bloqueada até substituí-lo.'

describe('ExecuteJobPage standard warning (REQ-P111-4)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    apiMocks.saveExecution.mockResolvedValue(
      buildJobMutationResponse({}, 'Dados salvos com sucesso', [
        buildJobExecutionWarning({
          reason: 'standard_expired',
          standardIds: [11],
          standardNames: ['Massa A'],
        }),
      ]),
    )
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
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('REQ-P111-4: a save that answers a standard warning shows it as non-blocking pt-BR copy next to the saved confirmation', async () => {
    renderExecutePage()
    expect(screen.queryByText(WARNING_COPY)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }))

    expect(await screen.findByText(WARNING_COPY)).toBeTruthy()
    // The save itself succeeded: the warning does not turn it into an error.
    expect(toastMocks.success).toHaveBeenCalledWith('Dados salvos com sucesso!')
    expect(toastMocks.error).not.toHaveBeenCalled()
    // And it blocks nothing: the worksheet stays editable and savable.
    const saveButton = screen.getByRole('button', { name: /salvar rascunho/i })
    await waitFor(() => {
      expect(saveButton.hasAttribute('disabled')).toBe(false)
    })
  })

  it('REQ-P111-4: a save without warnings (or a response that carries none) shows nothing', async () => {
    apiMocks.saveExecution.mockResolvedValue(buildJobMutationResponse())
    renderExecutePage()

    fireEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }))

    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalled()
    })
    expect(screen.queryByText(/não está mais válido/)).toBeNull()
  })

  it('REQ-P111-4: removing the stale standard from the selection clears its warning', async () => {
    renderExecutePage()
    fireEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }))
    expect(await screen.findByText(WARNING_COPY)).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', { name: /remover padrão massa a/i }),
    )

    await waitFor(() => {
      expect(screen.queryByText(WARNING_COPY)).toBeNull()
    })
  })
})

function renderExecutePage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ExecuteJobPage id="CAL-0007" conflictReturn={{}} />
    </QueryClientProvider>,
  )
}

function executableJob(): JobData {
  return {
    id: 7,
    jobId: 'CAL-0007',
    status: 'IN_PROGRESS',
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
    // Saved earlier, valid then; the active-standards list no longer has it.
    standardsSnapshot: [
      {
        id: 11,
        name: 'Massa A',
        kind: 'generic_scalar',
        certificateNumber: 'CERT-11',
        calibrationDate: '2025-01-10T00:00:00.000Z',
        uncertainty: 0.01,
        uncertaintyUnit: 'g',
        coverageFactor: 2,
        distribution: 'normal',
        drift: null,
        certifiedValues: null,
      },
    ],
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
