import { createFileRoute } from '@tanstack/react-router'

import { NCListPage } from '@/features/quality/nc-list-page'
import { loadNonConformancesIndexData } from '@/features/quality/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/nc/')({
  loader: ({ context, location }) =>
    loadNonConformancesIndexData(
      context.queryClient,
      routeLocationToUrl(location),
    ),
  head: () => ({
    meta: [{ title: 'Não Conformidades | CalibraFacil' }],
  }),
  component: NCListPage,
})
