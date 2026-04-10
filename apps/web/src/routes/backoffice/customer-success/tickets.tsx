import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { TicketBoard } from './-customer-success/boards'
import {
  useSupportQueue,
  useUpdateRequestStatus,
} from './-customer-success/hooks'
import type { SupportQueueItem, TicketFilter } from './-customer-success/model'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useBackofficeSession } from '@calibra-facil/auth/client'

export const Route = createFileRoute('/backoffice/customer-success/tickets')({
  head: () => ({
    meta: [{ title: 'Customer Success | Tickets | CalibraFácil' }],
  }),
  component: CustomerSuccessTicketsPage,
})

const ticketFilters: Array<[TicketFilter, string]> = [
  ['all', 'Todos'],
  ['breached', 'SLA violado'],
  ['due', 'SLA vencendo'],
  ['open', 'Em tratamento'],
  ['mine', 'Meus tickets'],
  ['waiting', 'Aguardando laboratório'],
  ['unassigned', 'Sem responsável'],
  ['escalation', 'Escalação'],
]

function CustomerSuccessTicketsPage() {
  const { data: session } = useBackofficeSession()
  const supportQueueQuery = useSupportQueue()
  const updateStatusMutation = useUpdateRequestStatus()
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>('all')
  const supportQueue = supportQueueQuery.data?.data ?? []
  const filteredSupportQueue = useMemo(
    () =>
      filterSupportQueue({
        items: supportQueue,
        ticketFilter,
        userId: session?.user?.id,
      }),
    [session?.user?.id, supportQueue, ticketFilter],
  )

  if (supportQueueQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-[560px] w-full" />
      </div>
    )
  }

  if (supportQueueQuery.isError) {
    return (
      <div className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-8 text-sm text-destructive">
        {supportQueueQuery.error instanceof Error
          ? supportQueueQuery.error.message
          : 'Falha ao carregar tickets'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 border-b pb-5 md:grid-cols-4">
        <Metric label="Tickets visíveis" value={filteredSupportQueue.length} />
        <Metric
          label="SLA violado"
          value={
            filteredSupportQueue.filter((item) => item.slaStatus === 'BREACHED')
              .length
          }
        />
        <Metric
          label="Escalação pendente"
          value={
            filteredSupportQueue.filter((item) => item.needsEscalation).length
          }
        />
        <Metric
          label="Sem responsável"
          value={
            filteredSupportQueue.filter((item) => !item.assignedToUser).length
          }
        />
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">Tickets por status</h2>
          <p className="text-sm text-muted-foreground">
            Arraste para atualizar status e use o detalhe da conta para
            responder, atribuir ou escalar.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {ticketFilters.map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={ticketFilter === value ? 'default' : 'outline'}
              onClick={() => setTicketFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        <TicketBoard
          requests={filteredSupportQueue}
          onMoveStatus={(requestId, status) =>
            updateStatusMutation.mutate({ requestId, status })
          }
        />
      </section>
    </div>
  )
}

function filterSupportQueue(params: {
  items: SupportQueueItem[]
  ticketFilter: TicketFilter
  userId?: string
}) {
  return params.items.filter((request) => {
    const isMine = request.assignedToUser?.id === params.userId

    switch (params.ticketFilter) {
      case 'breached':
        return request.slaStatus === 'BREACHED'
      case 'due':
        return request.slaStatus === 'DUE_SOON'
      case 'open':
        return request.status === 'OPEN' || request.status === 'IN_PROGRESS'
      case 'mine':
        return isMine
      case 'waiting':
        return request.status === 'WAITING_ON_CUSTOMER'
      case 'unassigned':
        return !request.assignedToUser
      case 'escalation':
        return request.needsEscalation || Boolean(request.escalationReason)
      default:
        return true
    }
  })
}

function Metric(props: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {props.label}
      </p>
      <p className="text-3xl font-semibold tracking-tight">{props.value}</p>
    </div>
  )
}
