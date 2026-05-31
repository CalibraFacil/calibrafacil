import { createFileRoute, redirect } from '@tanstack/react-router'

import { getDashboardRedirectPath } from '@/app/router/route-meta'

export const Route = createFileRoute('/dashboard/finance/documents/')({
  beforeLoad: () => {
    throw redirect({
      to:
        getDashboardRedirectPath('/dashboard/finance/documents') ??
        '/dashboard/finance/receivables',
    })
  },
})
