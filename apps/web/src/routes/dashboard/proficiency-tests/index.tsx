import { createFileRoute } from '@tanstack/react-router'

import { ProficiencyTestListPage } from '@/features/proficiency-tests/list-page'
import { loadPtIndexData } from '@/features/proficiency-tests/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/proficiency-tests/')({
  loader: ({ context, location }) =>
    loadPtIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Ensaios de Proficiência | CalibraFacil' }],
  }),
  component: ProficiencyTestListPage,
})
