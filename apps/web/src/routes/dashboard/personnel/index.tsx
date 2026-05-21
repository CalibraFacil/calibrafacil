import { createFileRoute } from '@tanstack/react-router'

import { PersonnelPage } from '@/features/personnel/list-page'
import { loadPersonnelIndexData } from '@/features/personnel/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/personnel/')({
  loader: ({ context, location }) =>
    loadPersonnelIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Competências do Pessoal | CalibraFacil' }],
  }),
  component: PersonnelPage,
})
