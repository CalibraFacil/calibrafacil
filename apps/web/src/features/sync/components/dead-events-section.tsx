import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { LocalDeadOutboxEvent } from '@calibra-facil/contracts'
import { formatInstant } from '@calibra-facil/shared/format'

import { Badge } from '@calibra-facil/ui/badge'
import { Button } from '@calibra-facil/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@calibra-facil/ui/card'
import { useDeadSyncEventsData } from '@/features/sync/queries'
import {
  describeDeadEvent,
  getDeadEventDiscardWarning,
} from '@/runtime/sync-dead-events'
import { useSyncStatus } from '@/runtime/sync-status'
import { calibraApi } from '@/utils/api'

/**
 * Changes the cloud refused for good. They are out of the push queue (so they
 * cannot crowd newer work out) and wait here: discard one, or send it again
 * once what the cloud objected to has been fixed.
 */
export function DeadEventsSection() {
  const sync = useSyncStatus()
  const deadEventsQuery = useDeadSyncEventsData({ enabled: sync.isDesktop })
  const [confirmingEventId, setConfirmingEventId] = useState<string | null>(
    null,
  )

  const discardMutation = useMutation({
    mutationFn: (eventId: string) => calibraApi.sync.discardDeadEvent(eventId),
    onSuccess: async () => {
      setConfirmingEventId(null)
      await Promise.all([deadEventsQuery.refetch(), sync.refresh()])
      toast.success('Alteração descartada. O descarte ficou registrado.')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao descartar a alteração recusada.',
      )
    },
  })

  const requeueMutation = useMutation({
    mutationFn: (eventId: string) => calibraApi.sync.requeueDeadEvent(eventId),
    onSuccess: async () => {
      await Promise.all([deadEventsQuery.refetch(), sync.refresh()])
      toast.success('Alteração colocada de volta na fila de envio.')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao reenviar a alteração recusada.',
      )
    },
  })

  const events = deadEventsQuery.data?.data ?? []
  if (!sync.isDesktop || events.length === 0) return null

  const busy = discardMutation.isPending || requeueMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-balance text-xl font-semibold tracking-tight">
            Alterações recusadas pela nuvem
          </h2>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            A nuvem não aceitará estas alterações como estão, então elas saíram
            da fila de envio. Corrija o problema e tente novamente, ou descarte
            a alteração.
          </p>
        </div>
        <Badge variant="destructive" className="shrink-0">
          {events.length} recusada{events.length === 1 ? '' : 's'}
        </Badge>
      </div>

      {events.map((event) => (
        <DeadEventCard
          key={event.eventId}
          event={event}
          busy={busy}
          confirming={confirmingEventId === event.eventId}
          onAskDiscard={() => setConfirmingEventId(event.eventId)}
          onCancelDiscard={() => setConfirmingEventId(null)}
          onConfirmDiscard={() => discardMutation.mutate(event.eventId)}
          onRequeue={() => requeueMutation.mutate(event.eventId)}
        />
      ))}
    </div>
  )
}

function DeadEventCard({
  event,
  busy,
  confirming,
  onAskDiscard,
  onCancelDiscard,
  onConfirmDiscard,
  onRequeue,
}: {
  event: LocalDeadOutboxEvent
  busy: boolean
  confirming: boolean
  onAskDiscard: () => void
  onCancelDiscard: () => void
  onConfirmDiscard: () => void
  onRequeue: () => void
}) {
  const description = describeDeadEvent(event)
  const warning = getDeadEventDiscardWarning(event)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base">{description.title}</CardTitle>
            <CardDescription>
              {event.entityId} · registrado em{' '}
              {formatInstant(event.occurredAt, 'date-time')}
            </CardDescription>
          </div>
          {event.regulated ? (
            <Badge variant="outline">Leituras de calibração</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{description.reason}</p>
        {description.detail ? (
          <p className="break-words text-xs text-muted-foreground">
            Resposta da nuvem: {description.detail}
          </p>
        ) : null}

        {confirming ? (
          <div
            role="alert"
            className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
          >
            <p className="text-sm font-medium">{warning.title}</p>
            <p className="text-sm text-muted-foreground">
              {warning.description}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={onCancelDiscard}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={onConfirmDiscard}
                disabled={busy}
              >
                {warning.confirmLabel}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onAskDiscard} disabled={busy}>
              Descartar
            </Button>
            <Button onClick={onRequeue} disabled={busy}>
              Tentar novamente
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
