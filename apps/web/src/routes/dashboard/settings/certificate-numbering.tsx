import { createFileRoute } from '@tanstack/react-router'

import { CertificateNumberingSettingsPage } from '@/features/settings/certificate-numbering-page'

export const Route = createFileRoute(
  '/dashboard/settings/certificate-numbering',
)({
  head: () => ({
    meta: [
      { title: 'Numeração de Certificados | Configurações | CalibraFácil' },
    ],
  }),
  component: CertificateNumberingSettingsPage,
})
