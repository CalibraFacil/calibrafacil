import { createFileRoute } from '@tanstack/react-router'

import { validateOnboardingSearch } from '@/features/onboarding/search'

import { JobsListPage } from '@/features/jobs/list-page'
import { loadJobsIndexData } from '@/features/jobs/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/jobs/')({
  validateSearch: validateOnboardingSearch,
  loader: ({ context, location }) =>
    loadJobsIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => routeHead('/dashboard/jobs'),
  component: JobsListPage,
})
