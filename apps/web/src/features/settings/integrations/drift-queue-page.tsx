import { useState } from 'react'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { calibraApi } from '@/utils/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

export interface IntegrationDriftRow {
  linkId: string
  integrationId: string
  providerLabel: string
  target: string
  targetLabel: string
  localEntityId: string
  remoteEntityId: string | null
  remoteDisplayId: string | null
  driftStatus: 'REMOTE_MISSING'
  driftCheckedAt: string | null
  driftReason: string | null
  lastSyncedAt: string | null
}

function driftQueueQueryOptions() {
  return queryOptions<{ data: IntegrationDriftRow[] }>({
    queryKey: ['integrations', 'drift'],
    queryFn: () =>
      calibraApi.integrations.listDrift<{ data: IntegrationDriftRow[] }>(),
  })
}

function formatDate(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

interface AcknowledgeDialogProps {
  open: boolean
  linkId: string | null
  onClose: () => void
}

function AcknowledgeDialog({ open, linkId, onClose }: AcknowledgeDialogProps) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()
  const disabled = trimmed.length === 0 || linkId === null

  const mutation = useMutation({
    mutationFn: () => {
      if (linkId === null) throw new Error('Drift inválido')
      return calibraApi.integrations.acknowledgeDrift(linkId, { reason: trimmed })
    },
    onSuccess: () => {
      toast.success('Divergência marcada como resolvida')
      queryClient.invalidateQueries({ queryKey: ['integrations', 'drift'] })
      setReason('')
      onClose()
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Falha ao marcar como resolvido',
      )
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('')
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar divergência como resolvida</DialogTitle>
          <DialogDescription>
            Use quando a divergência foi tratada fora do CalibraFácil e não
            deve mais aparecer na fila. O motivo fica registrado para
            auditoria.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="drift-ack-reason">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="drift-ack-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              placeholder="Ex.: cliente migrou para outro CNPJ — registro remoto será descartado"
              data-testid="drift-ack-reason"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => {
              setReason('')
              onClose()
            }}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="default"
            onClick={() => mutation.mutate()}
            disabled={disabled || mutation.isPending}
            data-testid="drift-ack-submit"
          >
            {mutation.isPending ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Marcando...
              </>
            ) : (
              'Marcar resolvido'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function IntegrationDriftQueuePage() {
  const { data, isLoading, error } = useQuery(driftQueueQueryOptions())
  const [ackLinkId, setAckLinkId] = useState<string | null>(null)

  const rows = data?.data ?? []

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Divergências da integração financeira
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Registros locais sem correspondente remoto. Cada linha mostra o
          objeto local, o provedor onde o remoto deveria existir, e a última
          verificação. Marque como resolvido quando a divergência tiver sido
          tratada externamente.
        </p>
      </header>

      {isLoading && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Carregando divergências...
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Não foi possível carregar a fila de divergências.
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nenhuma divergência pendente.
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {rows.length} divergência{rows.length === 1 ? '' : 's'} pendente
              {rows.length === 1 ? '' : 's'}
            </CardTitle>
            <CardDescription>
              Provedor sem registro correspondente para o objeto local.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {rows.map((row) => {
                const checkedAt = formatDate(row.driftCheckedAt)
                const lastSyncedAt = formatDate(row.lastSyncedAt)
                return (
                  <li
                    key={row.linkId}
                    className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                    data-testid="drift-row"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{row.targetLabel}</Badge>
                        <Badge
                          variant="outline"
                          className="border-destructive/40 text-destructive"
                        >
                          Remoto ausente
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {row.providerLabel}
                        </span>
                      </div>
                      <p className="text-sm font-mono truncate">
                        {row.localEntityId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Última verificação: {checkedAt ?? 'sem registro'} ·
                        Última sincronização: {lastSyncedAt ?? 'sem registro'}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAckLinkId(row.linkId)}
                    >
                      Marcar resolvido
                    </Button>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <AcknowledgeDialog
        open={ackLinkId !== null}
        linkId={ackLinkId}
        onClose={() => setAckLinkId(null)}
      />
    </div>
  )
}
