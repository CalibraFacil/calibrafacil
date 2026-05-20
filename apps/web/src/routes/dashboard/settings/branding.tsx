import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/settings/branding')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard/certificate-templates' })
  },
})
