import { createFileRoute } from '@tanstack/react-router'

import { NewServiceOrderPage } from '@/features/service-orders/new-page'
import { loadNewServiceOrderData } from '@/features/service-orders/queries'

export const Route = createFileRoute('/dashboard/service-orders/new')({
  loader: ({ context }) => loadNewServiceOrderData(context.queryClient),
  head: () => ({ meta: [{ title: 'Nova OS | CalibraFácil' }] }),
  component: NewServiceOrderPage,
})
