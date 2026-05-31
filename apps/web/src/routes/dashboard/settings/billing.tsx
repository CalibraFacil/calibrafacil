import { createFileRoute, redirect } from '@tanstack/react-router'

export { BillingSettingsPage } from '@/features/settings/billing-page'

export const Route = createFileRoute('/dashboard/settings/billing')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard/settings/subscription' })
  },
})
