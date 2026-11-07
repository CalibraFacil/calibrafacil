import { createFileRoute } from '@tanstack/react-router'

import { ProficiencyTestListPage } from '@/features/proficiency-tests/list-page'
import { loadPtIndexData } from '@/features/proficiency-tests/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/proficiency-tests/')({
  loader: ({ context, location }) =>
    loadPtIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => routeHead('/dashboard/proficiency-tests'),
  component: ProficiencyTestListPage,
})
