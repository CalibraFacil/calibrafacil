import { createFileRoute } from '@tanstack/react-router'

import { CertificateReleasePolicyPage } from '@/features/settings/certificate-release-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/certificate-release')(
  {
    head: () => routeHead('/dashboard/settings/certificate-release'),
    component: CertificateReleasePolicyPage,
  },
)
