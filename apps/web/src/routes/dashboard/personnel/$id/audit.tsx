import { createFileRoute } from '@tanstack/react-router'

import { AuditTab } from '@/features/personnel/audit-page'
import { loadCompetenceAuditData } from '@/features/personnel/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/personnel/$id/audit')({
  loader: ({ context, params }) =>
    loadCompetenceAuditData(context.queryClient, params.id),
  head: () => routeHead('/dashboard/personnel/$id/audit'),
  component: AuditRoute,
})

function AuditRoute() {
  const { id } = Route.useParams()

  return <AuditTab id={id} />
}
