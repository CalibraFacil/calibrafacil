import { createFileRoute } from '@tanstack/react-router'

import { PasskeysSettingsPage } from '@/features/passkeys/passkeys-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/passkeys')({
  head: () => routeHead('/dashboard/settings/passkeys'),
  component: PasskeysSettingsPage,
})
