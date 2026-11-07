import { createFileRoute } from '@tanstack/react-router'

import { NewJobPage } from '@/features/jobs/new-page'
import { parseNewJobSearch } from '@/features/jobs/new-job-search'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/jobs/new')({
  // DOM-02 (#655): accept customerId/assetId/serviceOrderId so a repair OS can
  // open a pre-filled calibration. Search is validated here and passed as a
  // prop — the feature module never calls useSearch.
  validateSearch: parseNewJobSearch,
  head: () => routeHead('/dashboard/jobs/new'),
  component: NewJobRoute,
})

function NewJobRoute() {
  const search = Route.useSearch()
  return <NewJobPage search={search} />
}
