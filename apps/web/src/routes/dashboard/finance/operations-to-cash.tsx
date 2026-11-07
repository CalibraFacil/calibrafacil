import { createFileRoute } from '@tanstack/react-router'

import { OperationsToCashPage } from '@/features/finance/operations-to-cash-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/operations-to-cash')({
  head: () => routeHead('/dashboard/finance/operations-to-cash'),
  component: OperationsToCashPage,
})
