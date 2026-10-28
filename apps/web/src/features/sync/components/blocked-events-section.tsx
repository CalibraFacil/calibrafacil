import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { LocalBlockedOutboxEvent } from '@calibra-facil/contracts'
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
import {
  useBlockedSyncEventsData,
  useDeadSyncEventsData,
} from '@/features/sync/queries'
import { describeBlockedEvent } from '@/runtime/sync-dead-events'
import { useSyncStatus } from '@/runtime/sync-status'
import { calibraApi } from '@/utils/api'

/**
 * Changes that are not sent because another one they depend on (an earlier edit of the same
 * record, or the record's parent) was refused or is in conflict. They leave the queue by
 * themselves once that change is resolved (retry or discard it above); a change that can never
 * apply (its parent record never reached the cloud) can be discarded here, one by one.
 */
export function BlockedEventsSection() {
  const sync = useSyncStatus()
  const blockedQuery = useBlockedSyncEventsData({ enabled: sync.isDesktop })
  const deadQuery = useDeadSyncEventsData({ enabled: sync.isDesktop })
  const [confirmingEventId, setConfirmingEventId] = useState<string | null>(
    null,
  )

  const discardMutation = useMutation({
    mutationFn: (eventId: string) => calibraApi.sync.discardDeadEvent(eventId),
    onSuccess: async () => {
      setConfirmingEventId(null)
      await Promise.all([
        blockedQuery.refetch(),
        deadQuery.refetch(),
        sync.refresh(),
      ])
      toast.success('Alteração descartada. O descarte ficou registrado.')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao descartar a alteração.',
      )
    },
  })

  const events = blockedQuery.data?.data ?? []
  if (!sync.isDesktop || events.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-balance text-xl font-semibold tracking-tight">
            Alterações aguardando outra alteração
          </h2>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Estas alterações dependem de outra que foi recusada ou está em
            conflito, então não são enviadas por enquanto. Resolva a outra
            alteração e elas seguem sozinhas.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {events.length} aguardando
        </Badge>
      </div>

      {events.map((event) => (
        <BlockedEventCard
          key={event.eventId}
          event={event}
          busy={discardMutation.isPending}
          confirming={confirmingEventId === event.eventId}
          onAskDiscard={() => setConfirmingEventId(event.eventId)}
          onCancelDiscard={() => setConfirmingEventId(null)}
          onConfirmDiscard={() => discardMutation.mutate(event.eventId)}
        />
      ))}
    </div>
  )
}

function BlockedEventCard({
  event,
  busy,
  confirming,
  onAskDiscard,
  onCancelDiscard,
  onConfirmDiscard,
}: {
  event: LocalBlockedOutboxEvent
  busy: boolean
  confirming: boolean
  onAskDiscard: () => void
  onCancelDiscard: () => void
  onConfirmDiscard: () => void
}) {
  const description = describeBlockedEvent(event)

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
        {confirming ? (
          <div
            role="alert"
            className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
          >
            <p className="text-sm font-medium">Descartar esta alteração?</p>
            <p className="text-sm text-muted-foreground">
              O registro local permanece neste computador, mas esta alteração
              sai da fila e não será enviada à nuvem. O descarte fica registrado
              com seu nome e a data.
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
                Descartar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onAskDiscard} disabled={busy}>
              Descartar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
