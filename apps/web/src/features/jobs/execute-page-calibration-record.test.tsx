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
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { ExecuteJobPage } from './execute-page'

// The execute page is the same one the desktop shows, fed by the local server.
// A local job carries no customer or lab address and, until the technician
// fills the form, no calibration location or phase reason: the form must
// collect them offline and the submit must carry them (REQ-P112-2).
describe('ExecuteJobPage on a desktop-shaped job: the calibration record', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    apiMocks.saveExecution.mockResolvedValue({ id: 7 })
    apiMocks.submitExecution.mockResolvedValue({ id: 7 })
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

  function pickToday() {
    const now = new Date()
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-')
    fireEvent.change(screen.getByLabelText('Data'), {
      target: { value: today },
    })
  }

  it('REQ-P112-2: asks for the location offline, keeps the submit closed until it is filled, then carries it', async () => {
    queryMocks.useJobDetailData.mockReturnValue({
      data: localJob(),
      error: null,
      isLoading: false,
    })
    renderExecutePage()
    pickToday()

    const submit = screen.getByRole('button', { name: /enviar para revisão/i })
    expect(screen.getByText('Local da Calibração')).toBeTruthy()
    expect(screen.getByText('Endereço/local')).toBeTruthy()
    expect(submit.hasAttribute('disabled')).toBe(true)

    fireEvent.change(
      screen.getByPlaceholderText('Endereço ou descrição do local'),
      { target: { value: '   ' } },
    )
    expect(submit.hasAttribute('disabled')).toBe(true)

    fireEvent.change(
      screen.getByPlaceholderText('Endereço ou descrição do local'),
      { target: { value: 'Rua do Cliente, 10' } },
    )
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => {
      expect(apiMocks.submitExecution).toHaveBeenCalledWith(
        'CAL-0007',
        expect.objectContaining({
          calibrationLocation: {
            type: 'other',
            addressText: 'Rua do Cliente, 10',
            notes: null,
          },
        }),
      )
    })
  })

  it('REQ-P112-2: a block marked not performed needs its reason offline, and the reason is carried with the submit', async () => {
    queryMocks.useJobDetailData.mockReturnValue({
      data: localJob({
        calibrationLocationSnapshot: {
          type: 'lab',
          addressText: 'Laboratório',
        },
        calibrationPhaseSnapshot: {
          blocks: { carga: { mode: 'not_performed', reason: null } },
        },
      }),
      error: null,
      isLoading: false,
    })
    renderExecutePage()
    pickToday()

    const submit = screen.getByRole('button', { name: /enviar para revisão/i })
    expect(
      screen.getByText('Motivo obrigatório para enviar à revisão.'),
    ).toBeTruthy()
    expect(submit.hasAttribute('disabled')).toBe(true)

    fireEvent.change(
      screen.getByPlaceholderText('Ex.: equipamento em manutenção'),
      { target: { value: 'Sem acesso ao ponto' } },
    )
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => {
      expect(apiMocks.submitExecution).toHaveBeenCalledWith(
        'CAL-0007',
        expect.objectContaining({
          calibrationPhases: {
            blocks: {
              carga: { mode: 'not_performed', reason: 'Sem acesso ao ponto' },
            },
          },
        }),
      )
    })
  })

  it('REQ-P112-2: a draft save sends the record too, so it is stored and queued offline before any submit', async () => {
    queryMocks.useJobDetailData.mockReturnValue({
      data: localJob(),
      error: null,
      isLoading: false,
    })
    renderExecutePage()

    fireEvent.change(
      screen.getByPlaceholderText('Endereço ou descrição do local'),
      { target: { value: 'Rua do Cliente, 10' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }))

    await waitFor(() => {
      expect(apiMocks.saveExecution).toHaveBeenCalledWith(
        'CAL-0007',
        expect.objectContaining({
          calibrationLocation: {
            type: 'other',
            addressText: 'Rua do Cliente, 10',
            notes: null,
          },
        }),
      )
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

/** A job as the local server returns it: no addresses, nothing recorded yet. */
function localJob(overrides: Partial<JobData> = {}): JobData {
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
          key: 'pontos',
          label: 'Pontos de carga',
          type: 'table',
          required: false,
          phaseBlockKey: 'carga',
          phaseBlockLabel: 'Carga',
          columns: [{ key: 'valor', label: 'Valor', type: 'number' }],
        },
      ],
      formulas: [],
      validations: [],
      uncertaintyParams: [],
    },
    data: {},
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
    calibrationLocationSnapshot: null,
    calibrationPhaseSnapshot: null,
    ...overrides,
  }
}
