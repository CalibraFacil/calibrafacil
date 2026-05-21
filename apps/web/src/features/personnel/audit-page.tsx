import { useCompetenceAuditLogData } from '@/features/personnel/queries'
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

type AuditTabProps = {
  id: string
}

export function AuditTab({ id }: AuditTabProps) {
  const { data: logs, isLoading } = useCompetenceAuditLogData(id)

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
