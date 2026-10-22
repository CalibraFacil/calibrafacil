// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildJobDetail } from '@calibra-facil/contracts/jobs-fixtures'
import { JobStatusSchema } from '@calibra-facil/schemas'
import { allowedFrom } from '@calibra-facil/schemas/job-transitions'

const queryMocks = vi.hoisted(() => ({
  getJobCertificateDownloadUrl: vi.fn(),
  getJobLabelDownloadUrl: vi.fn(),
  useJobCertificateDownloadUrlData: vi.fn(),
  useJobDetailData: vi.fn(),
  useJobTechniciansData: vi.fn(),
}))

vi.mock('@/components/method-runtime/math-runtime', () => ({
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

vi.mock('@/utils/api', () => ({ calibraApi: { jobs: {} } }))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('@/runtime/use-operation-availability', () => ({
  useOperationAvailability: () => ({
    status: 'available',
    allowed: true,
  }),
}))

import { JobDetailPage } from './detail-page'

const ASSIGN_ACTION = 'Atribuir técnico'

function renderDetail(status: Parameters<typeof buildJobDetail>[0]['status']) {
  queryMocks.useJobDetailData.mockReturnValue({
    data: buildJobDetail({ status }),
    error: null,
    isLoading: false,
  })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <JobDetailPage id="CAL-0007" />
    </QueryClientProvider>,
  )
}

describe('JobDetailPage assign action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryMocks.useJobTechniciansData.mockReturnValue({ data: { data: [] } })
    queryMocks.useJobCertificateDownloadUrlData.mockReturnValue({
      data: undefined,
    })
  })

  afterEach(cleanup)

  it('shows the assign action for a job under review, next to approve and reject', () => {
    renderDetail('REVIEW')

    expect(screen.getAllByText(ASSIGN_ACTION).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rejeitar').length).toBeGreaterThan(0)
  })

  it.each(JobStatusSchema.options)(
    'shows the assign action for %s exactly when the transition table allows assign',
    (status) => {
      renderDetail(status)

      const shown = screen.queryAllByText(ASSIGN_ACTION).length > 0
      expect(shown).toBe(allowedFrom('assign').includes(status))
    },
  )
})
