import { createFileRoute } from '@tanstack/react-router'

import { CertificateReleasePolicyPage } from '@/features/settings/certificate-release-page'

export const Route = createFileRoute('/dashboard/settings/certificate-release')(
  {
    head: () => ({
      meta: [
        {
          title:
            'Liberação de Certificados | Configurações | CalibraFácil',
        },
      ],
    }),
    component: CertificateReleasePolicyPage,
  },
)
