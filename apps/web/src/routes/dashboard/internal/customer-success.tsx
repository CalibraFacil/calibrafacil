import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/internal/customer-success')({
  beforeLoad: () => {
    throw redirect({ to: '/backoffice/customer-success' })
  },
  component: () => null,
})
