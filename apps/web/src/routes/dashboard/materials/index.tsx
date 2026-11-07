import { createFileRoute } from '@tanstack/react-router'

import { MaterialsListPage } from '@/features/materials/list-page'
import { loadMaterialsIndexData } from '@/features/materials/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/materials/')({
  loader: ({ context, location }) =>
    loadMaterialsIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => routeHead('/dashboard/materials'),
  component: MaterialsListPage,
})
