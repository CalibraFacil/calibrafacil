import { createFileRoute } from '@tanstack/react-router'

import { EmailDomainSettingsPage } from '@/features/settings/email-domain-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/email-domain')({
  head: () => routeHead('/dashboard/settings/email-domain'),
  component: EmailDomainSettingsPage,
})
