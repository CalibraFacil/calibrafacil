import { createFileRoute } from '@tanstack/react-router'

import { FinanceErpPage } from '@/features/finance/erp-page'
import { loadFinanceErpData } from '@/features/finance/queries'

type ErpSearch = { export?: string }

function parseErpSearch(input: Record<string, unknown>): ErpSearch {
  return {
    export:
      typeof input.export === 'string' && input.export.length > 0
        ? input.export
        : undefined,
  }
}

export const Route = createFileRoute('/dashboard/finance/erp')({
  validateSearch: parseErpSearch,
  loader: ({ context }) => loadFinanceErpData(context.queryClient),
  head: () => ({
    meta: [{ title: 'ERP financeiro | CalibraFácil' }],
  }),
  component: FinanceErpRoute,
})

function FinanceErpRoute() {
  const search = Route.useSearch()
  return <FinanceErpPage exportFilter={search.export} />
}
