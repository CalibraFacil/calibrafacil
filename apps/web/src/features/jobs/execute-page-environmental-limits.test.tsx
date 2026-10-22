// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildJobDetail } from '@calibra-facil/contracts/jobs-fixtures'

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
  evaluateFormulaRows: () => ({ success: false, error: 'unused' }),
  evaluateFormulaScalar: () => ({ success: false, error: 'unused' }),
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
  calibraApi: { jobs: { saveExecution: vi.fn(), submitExecution: vi.fn() } },
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { ExecuteJobPage } from './execute-page'

function renderExecutePage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ExecuteJobPage id="CAL-0007" conflictReturn={{}} />
    </QueryClientProvider>,
  )
}

describe('ExecuteJobPage environmental limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  afterEach(cleanup)

  it("requests the effective environmental limits for the job's asset type and unit", () => {
    // The shape GET /api/jobs/:id returns, unit included.
    queryMocks.useJobDetailData.mockReturnValue({
      data: buildJobDetail({ unitId: 3, assetTypeId: 2, status: 'DRAFT' }),
      error: null,
      isLoading: false,
    })

    renderExecutePage()

    expect(queryMocks.useEffectiveEnvironmentalLimitsData).toHaveBeenCalledWith(
      { assetTypeId: 2, unitId: 3, enabled: true },
    )
  })

  it('does not request limits for a job whose asset type is unknown', () => {
    queryMocks.useJobDetailData.mockReturnValue({
      data: buildJobDetail({ unitId: 3, assetTypeId: null, status: 'DRAFT' }),
      error: null,
      isLoading: false,
    })

    renderExecutePage()

    expect(queryMocks.useEffectiveEnvironmentalLimitsData).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    )
  })
})
