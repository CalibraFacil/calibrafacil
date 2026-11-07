import { createFileRoute } from '@tanstack/react-router'

import { CertificateNumberingSettingsPage } from '@/features/settings/certificate-numbering-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute(
  '/dashboard/settings/certificate-numbering',
)({
  head: () => routeHead('/dashboard/settings/certificate-numbering'),
  component: CertificateNumberingSettingsPage,
})
