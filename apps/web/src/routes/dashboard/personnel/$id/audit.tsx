import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
} from '@/components/audit-timeline'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const Route = createFileRoute('/dashboard/personnel/$id/audit')({
  head: () => ({
    meta: [{ title: 'Histórico | CalibraFacil' }],
  }),
  component: AuditTab,
})

function AuditTab() {
  const { id } = Route.useParams()

  const { data: logs, isLoading } = useQuery({
    queryKey: ['competence-audit', id],
    queryFn: async () =>
      calibraApi.competences.auditLog<
        Array<{
          id: number
          action: string
          changes: unknown
          performedBy: string
          performedByName: string
          performedAt: string
          reason: string | null
        }>
      >(id),
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">Carregando...</p>
        </CardContent>
      </Card>
    )
  }

  const entries = logs ?? []
  const timelineEvents = buildAuditTimelineEvents(entries)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de Alterações</CardTitle>
        <CardDescription>Registro de auditoria</CardDescription>
      </CardHeader>
      <CardContent>
        <AuditTimeline events={timelineEvents} showCard={false} />
      </CardContent>
    </Card>
  )
}
