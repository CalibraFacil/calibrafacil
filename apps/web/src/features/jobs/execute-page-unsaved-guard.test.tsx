// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useSyncExternalStore, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobData } from '@/features/jobs/execution'
import type { UnsavedChangesGateProps } from '@/lib/unsaved-changes-gate'

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
    error: 'math engine is not used by the unsaved-guard tests',
  }),
  evaluateFormulaScalar: () => ({
    success: false,
    error: 'math engine is not used by the unsaved-guard tests',
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
import {
  executionDraftKey,
  readExecutionDraft,
  writeExecutionDraft,
  type ExecutionFormValues,
} from './execution-draft'
import { EXECUTION_DRAFT_DEBOUNCE_MS } from './components/execution-unsaved-guard'

const scope = { organizationId: 'org-1', userId: 'user-1', jobId: '7' }
const draftScope = { organizationId: 'org-1', userId: 'user-1' }

// A controllable stand-in for the router gate the route adapter provides.
const gateSpy = vi.fn<(shouldBlock: () => boolean) => void>()
const blockerProceed = vi.fn()
const blockerReset = vi.fn()
const navigationBlock = {
  blocked: false,
  listeners: new Set<() => void>(),
  set(blocked: boolean) {
    navigationBlock.blocked = blocked
    for (const listener of navigationBlock.listeners) listener()
  },
}
function subscribeToNavigationBlock(listener: () => void) {
  navigationBlock.listeners.add(listener)
  return () => {
    navigationBlock.listeners.delete(listener)
  }
}
function FakeGate({ shouldBlock, children }: UnsavedChangesGateProps) {
  gateSpy(shouldBlock)
  const blocked = useSyncExternalStore(
    subscribeToNavigationBlock,
    () => navigationBlock.blocked,
  )
  return children(
    blocked
      ? { status: 'blocked', proceed: blockerProceed, reset: blockerReset }
      : { status: 'idle' },
  )
}

function blockNavigation() {
  act(() => navigationBlock.set(true))
}

function wouldBlock() {
  const lastCall = gateSpy.mock.lastCall
  if (!lastCall) throw new Error('navigation gate was never rendered')
  return lastCall[0]()
}

function beforeUnloadIsPrevented() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

function loadInput() {
  let node: HTMLElement | null = screen.getByText('Carga')
  while (node && !node.querySelector('input')) node = node.parentElement
  const input = node?.querySelector('input')
  if (!input) throw new Error('load input not found')
  return input
}

function typeLoad(value: string) {
  fireEvent.change(loadInput(), { target: { value } })
}

function today() {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

function seedDraft(
  overrides: Partial<ExecutionFormValues> = {},
  draftOwner = scope,
) {
  writeExecutionDraft({
    scope: draftOwner,
    values: {
      formData: { load: 12.5 },
      selectedStandardIds: [],
      environment: { temperature: null, humidity: null, pressure: null },
      calibrationLocation: { type: 'lab', addressText: 'Rua Laboratorio' },
      calibrationPhases: { blocks: {} },
      performedAt: '',
      backdateReason: '',
      methodDeviations: '',
      ...overrides,
    },
    baseUpdatedAt: null,
    now: Date.now(),
  })
}

describe('ExecuteJobPage unsaved-changes guard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    window.localStorage.clear()
    navigationBlock.set(false)
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
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('REQ-P07-1 / REQ-P07-2 blocking', () => {
    it('REQ-P07-1: a freshly opened worksheet is clean and blocks nothing', () => {
      renderExecutePage()

      expect(wouldBlock()).toBe(false)
      expect(beforeUnloadIsPrevented()).toBe(false)
    })

    it('REQ-P07-2: typing a reading arms the navigation blocker and the beforeunload prompt', () => {
      renderExecutePage()

      typeLoad('12.5')

      expect(wouldBlock()).toBe(true)
      expect(beforeUnloadIsPrevented()).toBe(true)
    })

    it('REQ-P07-1: typing the saved value back makes the worksheet clean again', () => {
      renderExecutePage()

      typeLoad('12.5')
      expect(wouldBlock()).toBe(true)
      typeLoad('10')

      expect(wouldBlock()).toBe(false)
      expect(beforeUnloadIsPrevented()).toBe(false)
    })

    it('REQ-P07-2: a successful save releases both the blocker and beforeunload', async () => {
      renderExecutePage()
      typeLoad('12.5')
      expect(wouldBlock()).toBe(true)

      fireEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }))

      await waitFor(() => {
        expect(apiMocks.saveExecution).toHaveBeenCalledTimes(1)
      })
      await waitFor(() => {
        expect(wouldBlock()).toBe(false)
      })
      expect(beforeUnloadIsPrevented()).toBe(false)
    })

    it('REQ-P07-2: a failed save keeps the worksheet protected', async () => {
      apiMocks.saveExecution.mockRejectedValue(new Error('offline'))
      renderExecutePage()
      typeLoad('12.5')

      fireEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }))

      await waitFor(() => {
        expect(apiMocks.saveExecution).toHaveBeenCalledTimes(1)
      })
      expect(wouldBlock()).toBe(true)
      expect(beforeUnloadIsPrevented()).toBe(true)
    })

    it('REQ-P07-2: edits made after a save are protected again', async () => {
      renderExecutePage()
      typeLoad('12.5')
      fireEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }))
      await waitFor(() => {
        expect(wouldBlock()).toBe(false)
      })

      typeLoad('13')

      expect(wouldBlock()).toBe(true)
    })

    it('REQ-P07-2: a successful submit does not block its own navigation', async () => {
      const blockedAtNavigation: boolean[] = []
      navigate.mockImplementation(() => {
        blockedAtNavigation.push(wouldBlock())
      })
      renderExecutePage()
      typeLoad('12.5')
      fireEvent.change(screen.getByLabelText('Data'), {
        target: { value: today() },
      })
      expect(wouldBlock()).toBe(true)

      fireEvent.click(
        screen.getByRole('button', { name: /enviar para revisão/i }),
      )

      await waitFor(() => {
        expect(navigate).toHaveBeenCalledWith({ to: '/dashboard/jobs' })
      })
      expect(blockedAtNavigation).toEqual([false])
    })

    it('REQ-P07-2: a conflict-return save does not block its own navigation', async () => {
      const blockedAtNavigation: boolean[] = []
      navigate.mockImplementation(() => {
        blockedAtNavigation.push(wouldBlock())
      })
      renderExecutePage({
        conflictReturn: {
          syncConflictId: 'conflict:job:7',
          returnTo: '/dashboard/sync/conflicts',
        },
      })
      typeLoad('12.5')

      fireEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }))

      await waitFor(() => {
        expect(navigate).toHaveBeenCalledWith({
          to: '/dashboard/sync/conflicts',
        })
      })
      expect(blockedAtNavigation).toEqual([false])
    })

    it('REQ-P07-2: a blocked navigation shows the pt-BR confirm dialog', () => {
      renderExecutePage()
      typeLoad('12.5')

      blockNavigation()

      expect(screen.getByText(/há leituras não salvas/i)).toBeTruthy()
      expect(screen.getByText(/sair sem salvar\?/i)).toBeTruthy()
    })

    it('REQ-P07-2: "Continuar editando" cancels the navigation', () => {
      renderExecutePage()
      typeLoad('12.5')
      blockNavigation()

      fireEvent.click(
        screen.getByRole('button', { name: /continuar editando/i }),
      )

      expect(blockerReset).toHaveBeenCalledTimes(1)
      expect(blockerProceed).not.toHaveBeenCalled()
    })

    it('REQ-P07-2: "Sair sem salvar" lets the navigation through and flushes the draft', () => {
      renderExecutePage({ withScope: true })
      typeLoad('12.75')
      blockNavigation()

      fireEvent.click(
        screen.getByRole('button', { name: /^sair sem salvar$/i }),
      )

      expect(blockerProceed).toHaveBeenCalledTimes(1)
      expect(blockerReset).not.toHaveBeenCalled()
      // Written immediately, without waiting for the debounce.
      expect(readExecutionDraft(scope)?.values.formData).toEqual({
        load: '12.75',
      })
    })

    it('REQ-P07-2: nothing is shown when the blocker is idle', () => {
      renderExecutePage()

      expect(screen.queryByText(/há leituras não salvas/i)).toBeNull()
    })
  })

  describe('REQ-P07-3 draft autosave', () => {
    it('REQ-P07-3: a clean worksheet writes nothing to localStorage', () => {
      renderExecutePage({ withScope: true })

      act(() => {
        vi.advanceTimersByTime(EXECUTION_DRAFT_DEBOUNCE_MS * 3)
      })

      expect(window.localStorage).toHaveLength(0)
    })

    it('REQ-P07-3: a dirty worksheet is written debounced, under the org/job/user key', () => {
      renderExecutePage({ withScope: true })

      typeLoad('12.5')
      // Debounced: nothing yet.
      expect(window.localStorage.getItem(executionDraftKey(scope))).toBeNull()

      act(() => {
        vi.advanceTimersByTime(EXECUTION_DRAFT_DEBOUNCE_MS - 1)
      })
      expect(window.localStorage.getItem(executionDraftKey(scope))).toBeNull()

      act(() => {
        vi.advanceTimersByTime(2)
      })
      expect(readExecutionDraft(scope)?.values.formData).toEqual({
        load: '12.5',
      })
    })

    it('REQ-P07-3: keeps resetting the debounce while the technician keeps typing', () => {
      renderExecutePage({ withScope: true })

      typeLoad('11')
      act(() => {
        vi.advanceTimersByTime(EXECUTION_DRAFT_DEBOUNCE_MS - 100)
      })
      typeLoad('11.5')
      act(() => {
        vi.advanceTimersByTime(EXECUTION_DRAFT_DEBOUNCE_MS - 100)
      })
      expect(window.localStorage.getItem(executionDraftKey(scope))).toBeNull()

      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(readExecutionDraft(scope)?.values.formData).toEqual({
        load: '11.5',
      })
    })

    it('REQ-P07-3: without an org/user scope nothing is persisted', () => {
      renderExecutePage({ withScope: false })

      typeLoad('12.5')
      act(() => {
        vi.advanceTimersByTime(EXECUTION_DRAFT_DEBOUNCE_MS * 3)
      })

      expect(window.localStorage).toHaveLength(0)
    })

    it('REQ-P07-3: the draft is cleared after a successful save', async () => {
      renderExecutePage({ withScope: true })
      typeLoad('12.5')
      act(() => {
        vi.advanceTimersByTime(EXECUTION_DRAFT_DEBOUNCE_MS + 1)
      })
      expect(readExecutionDraft(scope)).not.toBeNull()

      fireEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }))

      await waitFor(() => {
        expect(readExecutionDraft(scope)).toBeNull()
      })
      expect(window.localStorage.getItem(executionDraftKey(scope))).toBeNull()
    })

    it('REQ-P07-3: a save does not erase a draft of edits typed while it was in flight', async () => {
      let finishSave: ((value: unknown) => void) | null = null
      apiMocks.saveExecution.mockReturnValue(
        new Promise((resolve) => {
          finishSave = resolve
        }),
      )
      renderExecutePage({ withScope: true })
      typeLoad('12.5')
      fireEvent.click(screen.getByRole('button', { name: /salvar rascunho/i }))
      await waitFor(() => {
        expect(apiMocks.saveExecution).toHaveBeenCalledTimes(1)
      })

      typeLoad('14')
      await act(async () => {
        finishSave?.({ id: 7 })
      })
      act(() => {
        vi.advanceTimersByTime(EXECUTION_DRAFT_DEBOUNCE_MS + 1)
      })

      expect(wouldBlock()).toBe(true)
      expect(readExecutionDraft(scope)?.values.formData).toEqual({ load: '14' })
    })

    it('REQ-P07-3: the draft is cleared after a successful submit', async () => {
      renderExecutePage({ withScope: true })
      typeLoad('12.5')
      fireEvent.change(screen.getByLabelText('Data'), {
        target: { value: today() },
      })
      act(() => {
        vi.advanceTimersByTime(EXECUTION_DRAFT_DEBOUNCE_MS + 1)
      })
      expect(readExecutionDraft(scope)).not.toBeNull()

      fireEvent.click(
        screen.getByRole('button', { name: /enviar para revisão/i }),
      )

      await waitFor(() => {
        expect(navigate).toHaveBeenCalledWith({ to: '/dashboard/jobs' })
      })
      expect(readExecutionDraft(scope)).toBeNull()
    })
  })

  describe('REQ-P07-3 restore / discard', () => {
    it('REQ-P07-3: offers the draft instead of applying it automatically', () => {
      seedDraft()
      renderExecutePage({ withScope: true })

      expect(screen.getByText(/rascunho não salvo/i)).toBeTruthy()
      expect(screen.getByRole('button', { name: /restaurar/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /descartar/i })).toBeTruthy()
      // Still showing the server's value, and not dirty.
      expect(screen.getByDisplayValue('10')).toBeTruthy()
      expect(wouldBlock()).toBe(false)
      // The offered draft is not deleted while the technician decides.
      expect(readExecutionDraft(scope)).not.toBeNull()
    })

    it('REQ-P07-3: restoring applies the draft values and leaves the worksheet dirty', () => {
      seedDraft()
      renderExecutePage({ withScope: true })

      fireEvent.click(screen.getByRole('button', { name: /restaurar/i }))

      expect(screen.getByDisplayValue('12.5')).toBeTruthy()
      expect(screen.queryByText(/rascunho não salvo/i)).toBeNull()
      expect(wouldBlock()).toBe(true)
    })

    it('REQ-P07-3: discarding keeps the server values and removes the draft', () => {
      seedDraft()
      renderExecutePage({ withScope: true })

      fireEvent.click(screen.getByRole('button', { name: /descartar/i }))

      expect(screen.getByDisplayValue('10')).toBeTruthy()
      expect(screen.queryByText(/rascunho não salvo/i)).toBeNull()
      expect(wouldBlock()).toBe(false)
      expect(readExecutionDraft(scope)).toBeNull()
      expect(window.localStorage).toHaveLength(0)
    })

    it('REQ-P07-3: a draft equal to the saved data is not offered and is dropped', () => {
      seedDraft({ formData: { load: 10 } })
      renderExecutePage({ withScope: true })

      expect(screen.queryByText(/rascunho não salvo/i)).toBeNull()
      expect(readExecutionDraft(scope)).toBeNull()
    })

    it('REQ-P07-3: a draft older than the server data is not offered', () => {
      queryMocks.useJobDetailData.mockReturnValue({
        data: {
          ...executableJob(),
          updatedAt: new Date(Date.now() + 60_000).toISOString(),
        },
        error: null,
        isLoading: false,
      })
      writeExecutionDraft({
        scope,
        values: {
          formData: { load: 12.5 },
          selectedStandardIds: [],
          environment: { temperature: null, humidity: null, pressure: null },
          calibrationLocation: { type: 'lab', addressText: 'Rua Laboratorio' },
          calibrationPhases: { blocks: {} },
          performedAt: '',
          backdateReason: '',
          methodDeviations: '',
        },
        baseUpdatedAt: '2000-01-01T00:00:00.000Z',
        now: Date.now(),
      })

      renderExecutePage({ withScope: true })

      expect(screen.queryByText(/rascunho não salvo/i)).toBeNull()
    })

    it('REQ-P07-3: another user or organization never sees this draft', () => {
      seedDraft({}, { ...scope, userId: 'user-2' })
      seedDraft({}, { ...scope, organizationId: 'org-2' })

      renderExecutePage({ withScope: true })

      expect(screen.queryByText(/rascunho não salvo/i)).toBeNull()
      // And they are left untouched for their owners.
      expect(readExecutionDraft({ ...scope, userId: 'user-2' })).not.toBeNull()
      expect(
        readExecutionDraft({ ...scope, organizationId: 'org-2' }),
      ).not.toBeNull()
    })

    it('REQ-P07-3: a draft from an old schema version is ignored', () => {
      window.localStorage.setItem(
        'calibra:execution-draft:v0:org-1:7:user-1',
        JSON.stringify({ version: 0, values: { formData: { load: 99 } } }),
      )
      window.localStorage.setItem(
        executionDraftKey(scope),
        JSON.stringify({
          version: 0,
          organizationId: 'org-1',
          userId: 'user-1',
          jobId: '7',
          savedAt: Date.now(),
          baseUpdatedAt: null,
          values: { formData: { load: 99 } },
        }),
      )

      renderExecutePage({ withScope: true })

      expect(screen.queryByText(/rascunho não salvo/i)).toBeNull()
      expect(screen.getByDisplayValue('10')).toBeTruthy()
    })
  })
})

function renderExecutePage({
  conflictReturn = {},
  withScope = false,
}: {
  conflictReturn?: Parameters<typeof ExecuteJobPage>[0]['conflictReturn']
  withScope?: boolean
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ExecuteJobPage
        id="CAL-0007"
        conflictReturn={conflictReturn}
        draftScope={withScope ? draftScope : null}
        UnsavedChangesGate={FakeGate}
      />
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
