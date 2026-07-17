import { createFileRoute } from '@tanstack/react-router'

import { CertificateTemplatesPage } from '@/features/certificate-templates/page'

export const Route = createFileRoute('/dashboard/certificate-templates/')({
  head: () => ({
    meta: [{ title: 'Templates de Certificados | CalibraFácil' }],
  }),
  component: CertificateTemplatesPage,
})
