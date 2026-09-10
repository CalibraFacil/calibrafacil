import { Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useOpenSyncConflictsData } from '@/features/sync/queries'
import { calibraApi } from '@/utils/api'
import { useSyncStatus } from '@/runtime/sync-status'
import {
  buildSyncConflictFieldDiffs,
  getSyncConflictEditTarget,
  type SyncConflictEditTarget,
  type SyncConflictFieldDiff,
} from '@/runtime/sync-conflict-actions'
import { getSyncConflictReturnSearch } from '@/runtime/sync-conflict-return'

export function SyncConflictsPage() {
  const sync = useSyncStatus()
  const conflictsQuery = useOpenSyncConflictsData({
    enabled: sync.isDesktop,
  })
  const resolveMutation = useMutation({
    mutationFn: (input: { id: string; status: 'resolved' | 'ignored' }) =>
      calibraApi.sync.resolveConflict(input.id, input.status),
    onSuccess: async (_data, variables) => {
      await Promise.all([conflictsQuery.refetch(), sync.refresh()])
      toast.success(
        variables.status === 'ignored'
          ? 'Estado da nuvem mantido.'
          : 'Alteração local liberada para nova tentativa.',
      )
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao resolver conflito de sincronização.',
      )
    },
  })

  if (!sync.isDesktop) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Conflitos de sincronização</CardTitle>
          <CardDescription>
            Esta fila existe apenas no aplicativo desktop.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (conflictsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    )
  }

  if (conflictsQuery.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Conflitos de sincronização</CardTitle>
          <CardDescription>
            Não foi possível carregar os conflitos locais.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            {conflictsQuery.error.message}
          </p>
        </CardContent>
      </Card>
    )
  }

  const conflicts = conflictsQuery.data?.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Conflitos de sincronização
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Revise alterações locais que precisam de decisão antes de a
            sincronização voltar ao estado normal.
          </p>
        </div>
        <Badge
          variant={conflicts.length > 0 ? 'destructive' : 'secondary'}
          className="shrink-0"
        >
          {conflicts.length} aberto{conflicts.length === 1 ? '' : 's'}
        </Badge>
      </div>

      {conflicts.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Nenhum conflito aberto no banco local.
            </p>
          </CardContent>
        </Card>
      ) : (
        conflicts.map((conflict) => {
          const editTarget = getSyncConflictEditTarget(conflict)

          return (
            <Card key={conflict.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">
                      {entityLabel(conflict.entityType)} · {conflict.entityId}
                    </CardTitle>
                    <CardDescription>
                      {conflictTypeLabel(conflict.conflictType)} · criado em{' '}
                      {formatDate(conflict.createdAt)}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">{conflict.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConflictSummary conflict={conflict} />
                <div className="grid gap-4 md:grid-cols-2">
                  <PayloadPanel title="Local" value={conflict.localPayload} />
                  <PayloadPanel title="Nuvem" value={conflict.remotePayload} />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {editTarget ? (
                    <ConflictEditButton
                      target={editTarget}
                      conflictId={conflict.id}
                    />
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() =>
                      resolveMutation.mutate({
                        id: conflict.id,
                        status: 'ignored',
                      })
                    }
                    disabled={resolveMutation.isPending}
                  >
                    Manter nuvem
                  </Button>
                  <Button
                    onClick={() =>
                      resolveMutation.mutate({
                        id: conflict.id,
                        status: 'resolved',
                      })
                    }
                    disabled={resolveMutation.isPending}
                  >
                    Tentar novamente com local
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}

function ConflictEditButton({
  target,
  conflictId,
}: {
  target: SyncConflictEditTarget
  conflictId: string
}) {
  const search = getSyncConflictReturnSearch(conflictId)

  switch (target.kind) {
    case 'asset':
      return (
        <Button
          variant="outline"
          render={
            <Link
              to="/dashboard/assets/$id/edit"
              params={{ id: target.id }}
              search={search}
            />
          }
        >
          Editar antes de tentar
        </Button>
      )
    case 'calibration_job':
      return (
        <Button
          variant="outline"
          render={
            <Link
              to="/dashboard/jobs/$id/execute"
              params={{ id: target.id }}
              search={search}
            />
          }
        >
          Editar antes de tentar
        </Button>
      )
    case 'customer':
      return (
        <Button
          variant="outline"
          render={
            <Link
              to="/dashboard/clients/$id/info"
              params={{ id: target.id }}
              search={search}
            />
          }
        >
          Editar antes de tentar
        </Button>
      )
    case 'service_order':
      return (
        <Button
          variant="outline"
          render={
            <Link
              to="/dashboard/service-orders/$publicId"
              params={{ publicId: target.id }}
              search={search}
            />
          }
        >
          Editar antes de tentar
        </Button>
      )
  }
}

function ConflictSummary({
  conflict,
}: {
  conflict: {
    entityType: string
    entityId: string
    localPayload: unknown
    remotePayload: unknown
  }
}) {
  const diffs = buildSyncConflictFieldDiffs(conflict)

  if (diffs.length === 0) return null

  return (
    <div className="overflow-hidden rounded-md border bg-muted/20">
      <div className="grid grid-cols-[minmax(7rem,0.85fr)_minmax(0,1fr)_minmax(0,1fr)_7rem] border-b px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
        <span>Campo</span>
        <span>Alteração local</span>
        <span>Estado na nuvem</span>
        <span>Diferença</span>
      </div>
      <div className="divide-y">
        {diffs.map((diff) => (
          <ConflictDiffRow key={diff.key} diff={diff} />
        ))}
      </div>
    </div>
  )
}

function ConflictDiffRow({ diff }: { diff: SyncConflictFieldDiff }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,0.85fr)_minmax(0,1fr)_minmax(0,1fr)_7rem] gap-3 px-3 py-2 text-sm">
      <div className="font-medium">{diff.label}</div>
      <div className="min-w-0 truncate text-muted-foreground">
        {diff.localValue}
      </div>
      <div className="min-w-0 truncate text-muted-foreground">
        {diff.remoteValue}
      </div>
      <div>
        <Badge variant={diff.state === 'changed' ? 'destructive' : 'secondary'}>
          {diffStateLabel(diff.state)}
        </Badge>
      </div>
    </div>
  )
}

function PayloadPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="rounded-md border bg-muted/30 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Payload bruto · {title}
      </summary>
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

function entityLabel(value: string) {
  const labels: Record<string, string> = {
    asset: 'Ativo',
    attachment: 'Anexo',
    calibration_job: 'Calibração',
    customer: 'Cliente',
    service_order: 'Ordem de serviço',
  }

  return labels[value] ?? value
}

function conflictTypeLabel(value: string) {
  const labels: Record<string, string> = {
    concurrent_update: 'Atualização concorrente',
    deleted_remotely: 'Removido na nuvem',
    missing_remote_dependency: 'Dependência ausente na nuvem',
    status_transition: 'Transição de status',
    validation_failed: 'Validação recusada',
  }

  return labels[value] ?? value
}

function diffStateLabel(value: SyncConflictFieldDiff['state']) {
  const labels: Record<SyncConflictFieldDiff['state'], string> = {
    changed: 'Diferente',
    local_only: 'Só local',
    remote_only: 'Só nuvem',
    same: 'Igual',
  }

  return labels[value]
}

const DATETIME_SHORT_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatDate(value: string) {
  return DATETIME_SHORT_FORMAT.format(new Date(value))
}
