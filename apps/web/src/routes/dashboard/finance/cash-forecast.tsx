import { createFileRoute } from '@tanstack/react-router'

import { CashForecastPage } from '@/features/finance/cash-forecast-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/cash-forecast')({
  head: () => routeHead('/dashboard/finance/cash-forecast'),
  component: CashForecastPage,
})
