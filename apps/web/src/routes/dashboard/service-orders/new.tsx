import { createFileRoute } from '@tanstack/react-router'

import { NewServiceOrderPage } from '@/features/service-orders/new-page'
import { loadNewServiceOrderData } from '@/features/service-orders/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/service-orders/new')({
  loader: ({ context }) => loadNewServiceOrderData(context.queryClient),
  head: () => routeHead('/dashboard/service-orders/new'),
  component: NewServiceOrderPage,
})
