import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { jobsListQueryOptions } from '@/features/jobs/queries'
import type { JobsListStatus } from './types'

export function useJobsListData({
  activeOrganizationId,
  enabled,
  page,
  search,
  statusFilter,
}: {
  activeOrganizationId: string | null
  enabled: boolean
  page: number
  search: string
  statusFilter: JobsListStatus | ''
}) {
  const organizationId = activeOrganizationId ?? 'no-org'
  const queryInput = useMemo(
    () => ({
      organizationId,
      page,
      search,
      statusFilter,
    }),
    [organizationId, page, search, statusFilter],
  )

  // The list options keep the previous page's rows as placeholder data, so
  // paging and filtering never flash back to the skeleton.
  return useQuery({
    ...jobsListQueryOptions(queryInput),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}
