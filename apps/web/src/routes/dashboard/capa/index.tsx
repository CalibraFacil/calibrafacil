import { createFileRoute } from '@tanstack/react-router'

import { CAPAListPage } from '@/features/quality/capa-list-page'
import { loadCapasIndexData } from '@/features/quality/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/capa/')({
  loader: ({ context, location }) =>
    loadCapasIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Ações Corretivas (CAPA) | CalibraFacil' }],
  }),
  component: CAPAListPage,
})
