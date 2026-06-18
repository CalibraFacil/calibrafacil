import { createFileRoute } from '@tanstack/react-router'

import { FromTemplatePage } from '@/features/methods/from-template-page'
import { loadMethodTemplatesData } from '@/features/methods/queries'

export const Route = createFileRoute('/dashboard/methods/from-template')({
  loader: ({ context }) => loadMethodTemplatesData(context.queryClient),
  head: () => ({
    meta: [{ title: 'Novo Método a partir de modelo | CalibraFácil' }],
  }),
  component: FromTemplatePage,
})
