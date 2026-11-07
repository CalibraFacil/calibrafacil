import { createFileRoute, redirect } from '@tanstack/react-router'

import { getDashboardRedirectTarget } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/documents/')({
  beforeLoad: () => {
    throw redirect({
      to: getDashboardRedirectTarget('/dashboard/finance/documents'),
    })
  },
})
