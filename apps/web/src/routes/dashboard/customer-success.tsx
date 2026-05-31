import { createFileRoute } from '@tanstack/react-router'

import { CustomerSuccessPage } from '@/features/customer-success/page'

export const Route = createFileRoute('/dashboard/customer-success')({
  head: () => ({
    meta: [{ title: 'Customer Success | CalibraFácil' }],
  }),
  component: CustomerSuccessPage,
})
