import { createFileRoute } from '@tanstack/react-router'

import { MethodsListPage } from '@/features/methods/list-page'
import { loadMethodsIndexData } from '@/features/methods/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/methods/')({
  loader: ({ context, location }) =>
    loadMethodsIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Métodos de Calibração | CalibraFácil' }],
  }),
  component: MethodsListPage,
})
