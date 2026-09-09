import { createFileRoute } from '@tanstack/react-router'

import { validateOnboardingSearch } from '@/features/onboarding/search'

import { JobsListPage } from '@/features/jobs/list-page'
import { loadJobsIndexData } from '@/features/jobs/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/jobs/')({
  validateSearch: validateOnboardingSearch,
  loader: ({ context, location }) =>
    loadJobsIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Calibrações | CalibraFacil' }],
  }),
  component: JobsListPage,
})
