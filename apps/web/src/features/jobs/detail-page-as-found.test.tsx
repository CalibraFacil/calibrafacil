// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildJobDetail } from '@calibra-facil/contracts/jobs-fixtures'

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

const BADGE = 'Fora de tolerância (como encontrado)'

function renderDetail(overrides: Parameters<typeof buildJobDetail>[0]) {
  queryMocks.useJobDetailData.mockReturnValue({
    data: buildJobDetail(overrides),
    error: null,
    isLoading: false,
  })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <JobDetailPage id="CAL-0007" />
    </QueryClientProvider>,
  )
}

describe('JobDetailPage as-found badge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryMocks.useJobTechniciansData.mockReturnValue({ data: { data: [] } })
    queryMocks.useJobCertificateDownloadUrlData.mockReturnValue({
      data: undefined,
    })
  })

  afterEach(cleanup)

  it('shows "fora de tolerância" for an approved job whose as-found verdict is NON_CONFORMING', () => {
    renderDetail({ status: 'APPROVED', asFoundConformity: 'NON_CONFORMING' })

    expect(screen.getAllByText(BADGE).length).toBeGreaterThan(0)
  })

  it('also shows it on a superseded (amended) job', () => {
    renderDetail({ status: 'SUPERSEDED', asFoundConformity: 'NON_CONFORMING' })

    expect(screen.getAllByText(BADGE).length).toBeGreaterThan(0)
  })

  it.each(['CONFORMING', 'UNKNOWN', null] as const)(
    'does not show it when the as-found verdict is %s',
    (asFoundConformity) => {
      renderDetail({ status: 'APPROVED', asFoundConformity })

      expect(screen.queryByText(BADGE)).toBeNull()
    },
  )

  it('does not show it before the job is approved', () => {
    renderDetail({ status: 'REVIEW', asFoundConformity: 'NON_CONFORMING' })

    expect(screen.queryByText(BADGE)).toBeNull()
  })
})
