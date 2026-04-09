import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/internal')({
  beforeLoad: () => {
    throw redirect({ to: '/backoffice' })
  },
  component: () => null,
})
