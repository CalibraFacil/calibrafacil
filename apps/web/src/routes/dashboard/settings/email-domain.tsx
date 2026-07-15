import { createFileRoute } from '@tanstack/react-router'

import { EmailDomainSettingsPage } from '@/features/settings/email-domain-page'

export const Route = createFileRoute('/dashboard/settings/email-domain')({
  head: () => ({
    meta: [{ title: 'Domínio de E-mail | Configurações | CalibraFácil' }],
  }),
  component: EmailDomainSettingsPage,
})
