import { createFileRoute } from '@tanstack/react-router'

import { PersonnelPage } from '@/features/personnel/list-page'
import { loadPersonnelIndexData } from '@/features/personnel/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/personnel/')({
  loader: ({ context, location }) =>
    loadPersonnelIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => routeHead('/dashboard/personnel'),
  component: PersonnelPage,
})
