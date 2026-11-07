import { createFileRoute } from '@tanstack/react-router'

import { SignatureSettingsPage } from '@/features/settings/signature-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/signature')({
  head: () => routeHead('/dashboard/settings/signature'),
  component: SignatureSettingsPage,
})
