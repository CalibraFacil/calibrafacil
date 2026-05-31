import { createFileRoute, redirect } from '@tanstack/react-router'

// Customer-success accounts folded into the unified Accounts directory.
export const Route = createFileRoute('/backoffice/customer-success/')({
  beforeLoad: () => {
    throw redirect({ to: '/backoffice/accounts' })
  },
})
