import { createFileRoute } from '@tanstack/react-router'

import { AuditTab } from '@/features/personnel/audit-page'
import { loadCompetenceAuditData } from '@/features/personnel/queries'

export const Route = createFileRoute('/dashboard/personnel/$id/audit')({
  loader: ({ context, params }) =>
    loadCompetenceAuditData(context.queryClient, params.id),
  head: () => ({
    meta: [{ title: 'Histórico | CalibraFacil' }],
  }),
  component: AuditRoute,
})

function AuditRoute() {
  const { id } = Route.useParams()

  return <AuditTab id={id} />
}
