import { createFileRoute } from '@tanstack/react-router'

import { FromTemplatePage } from '@/features/methods/from-template-page'
import { loadMethodTemplatesData } from '@/features/methods/queries'
import { parseFromTemplateSearch } from '@/features/methods/from-template-search'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/methods/from-template')({
  validateSearch: parseFromTemplateSearch,
  loader: ({ context }) => loadMethodTemplatesData(context.queryClient),
  head: () => routeHead('/dashboard/methods/from-template'),
  component: FromTemplateRoute,
})

function FromTemplateRoute() {
  const search = Route.useSearch()
  return <FromTemplatePage search={search} />
}
