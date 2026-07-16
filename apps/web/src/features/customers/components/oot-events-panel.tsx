import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { calibraApi } from '@/utils/api'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type CustomerOotEvent = {
  id: number
  status: 'OPEN' | 'ASSESSED'
  detectedAt: string
  assetId: number
  assetTag: string
  assetName: string
  jobId: number
  jobIdentifier: string
  assessmentDecision:
    | 'NO_IMPACT'
    | 'IMPACT_CONTAINED'
    | 'IMPACT_ESCALATED'
    | null
  assessmentCreatedAt: string | null
}

const DECISION_LABELS: Record<string, string> = {
  NO_IMPACT: 'Sem impacto',
  IMPACT_CONTAINED: 'Impacto contido',
  IMPACT_ESCALATED: 'Impacto escalado',
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/**
 * Read-only lab view of the customer's asset OOT events and whether the
 * customer closed their ISO 9001 §7.1.5.2 impact-assessment loop (#740).
 * The assessment itself is the customer's record, made in the portal.
 */
export function CustomerOotEventsPanel({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer-oot-events', customerId],
    queryFn: () =>
      calibraApi.customers.ootEvents<{ data: CustomerOotEvent[] }>(customerId),
  })

  const events = data?.data ?? []

  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">
          Fora de tolerância (as-found) — avaliação de impacto do cliente
        </h3>
        <p className="text-xs text-muted-foreground">
          Eventos gerados na aprovação de certificados reprovados na condição
          "como recebido". A avaliação de impacto é registrada pelo cliente no
          portal.
        </p>
      </div>
      {isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : events.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          Nenhum evento fora de tolerância registrado para este cliente.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Equipamento</TableHead>
              <TableHead>Calibração</TableHead>
              <TableHead>Detectado em</TableHead>
              <TableHead>Avaliação do cliente</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>
                  <Link
                    to="/dashboard/assets/$id"
                    params={{ id: String(event.assetId) }}
                    className="font-medium hover:underline"
                  >
                    {event.assetTag}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {event.assetName}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {event.jobIdentifier}
                </TableCell>
                <TableCell>{formatDate(event.detectedAt)}</TableCell>
                <TableCell>
                  {event.status === 'ASSESSED' && event.assessmentDecision ? (
                    <div className="space-y-0.5">
                      <Badge
                        variant={
                          event.assessmentDecision === 'IMPACT_ESCALATED'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {DECISION_LABELS[event.assessmentDecision] ??
                          event.assessmentDecision}
                      </Badge>
                      {event.assessmentCreatedAt ? (
                        <span className="block text-xs text-muted-foreground">
                          em {formatDate(event.assessmentCreatedAt)}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <Badge variant="outline">Pendente</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
