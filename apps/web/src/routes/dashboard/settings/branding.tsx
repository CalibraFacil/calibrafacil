import { createFileRoute, redirect } from '@tanstack/react-router'

import { getDashboardRedirectPath } from '@/app/router/route-meta'

export const Route = createFileRoute('/dashboard/settings/branding')({
  beforeLoad: () => {
    throw redirect({
      to:
        getDashboardRedirectPath('/dashboard/settings/branding') ??
        '/dashboard/settings',
    })
  },
})
