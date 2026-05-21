import { createFileRoute } from '@tanstack/react-router'

import { CertificatesSettingsPage } from '@/features/settings/certificates-page'

export const Route = createFileRoute('/dashboard/settings/certificates')({
  head: () => ({
    meta: [{ title: 'Certificados ICP-Brasil | Configurações | CalibraFácil' }],
  }),
  component: CertificatesSettingsPage,
})
