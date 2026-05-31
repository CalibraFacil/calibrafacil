import { createFileRoute } from '@tanstack/react-router'

import { CashForecastPage } from '@/features/finance/cash-forecast-page'

export const Route = createFileRoute('/dashboard/finance/cash-forecast')({
  head: () => ({ meta: [{ title: 'Previsão de caixa | CalibraFácil' }] }),
  component: CashForecastPage,
})
