import { createFileRoute, redirect } from '@tanstack/react-router'

// Organizations folded into the unified Accounts directory.
export const Route = createFileRoute('/backoffice/organizations/')({
  beforeLoad: () => {
    throw redirect({ to: '/backoffice/accounts' })
  },
})
