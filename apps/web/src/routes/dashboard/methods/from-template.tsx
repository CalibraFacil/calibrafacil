import { createFileRoute } from '@tanstack/react-router'

import { FromTemplatePage } from '@/features/methods/from-template-page'
import { loadMethodTemplatesData } from '@/features/methods/queries'
import { parseFromTemplateSearch } from '@/features/methods/from-template-search'

export const Route = createFileRoute('/dashboard/methods/from-template')({
  validateSearch: parseFromTemplateSearch,
  loader: ({ context }) => loadMethodTemplatesData(context.queryClient),
  head: () => ({
    meta: [{ title: 'Novo Método a partir de modelo | CalibraFácil' }],
  }),
  component: FromTemplateRoute,
})

function FromTemplateRoute() {
  const search = Route.useSearch()
  return <FromTemplatePage search={search} />
}
