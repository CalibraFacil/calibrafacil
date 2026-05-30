import { createFileRoute } from '@tanstack/react-router'

import { AuditLogExplorerPage } from '@/features/backoffice/audit/explorer-page'

export const Route = createFileRoute('/backoffice/audit')({
  head: () => ({
    meta: [{ title: 'Auditoria | Backoffice | CalibraFácil' }],
  }),
  component: AuditLogExplorerPage,
})
