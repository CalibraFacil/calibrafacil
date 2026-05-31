import { createFileRoute, redirect } from '@tanstack/react-router'

import { getDashboardRedirectPath } from '@/app/router/route-meta'

export const Route = createFileRoute('/dashboard/finance/receipts')({
  beforeLoad: () => {
    throw redirect({
      to:
        getDashboardRedirectPath('/dashboard/finance/receipts') ??
        '/dashboard/finance/receivables',
    })
  },
})
