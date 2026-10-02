import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { integrationRunItemsQueryOptions } from '@/features/settings/queries'
import {
  formatIntegrationDateTime,
  integrationRunTriggerLabel,
  integrationTargetMeta,
} from '@/features/settings/integrations-model'
import type { IntegrationSummary } from '@/features/settings/types'
import type { ConnectorMutations } from './mutations'

export function IntegrationActivity({
  integration,
  retry,
}: {
  integration: IntegrationSummary
  retry: ConnectorMutations['retry']
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const runItemsQuery = useQuery(
    integrationRunItemsQueryOptions({
      integrationId: selectedRunId ? integration.id : null,
      runId: selectedRunId,
    }),
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          Execuções recentes
        </h3>
        <ScrollArea className="h-[26rem]">
          <div className="space-y-2 pr-3">
            {integration.recentRuns.length === 0 ? (
              <EmptyState>Nenhuma execução registrada.</EmptyState>
            ) : (
              integration.recentRuns.map((run) => {
                const isOpen = selectedRunId === run.id
                const runItems = isOpen ? (runItemsQuery.data?.data ?? []) : []
                const canRetry =
                  run.status !== 'PENDING' && run.status !== 'RUNNING'

                return (
                  <div
                    key={run.id}
                    className="rounded-lg bg-card p-3 text-sm ring-1 ring-inset ring-border/70"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">
                          {integrationTargetMeta[run.target].label}
                        </span>
                        <Badge variant="outline" className="font-normal">
                          {integrationRunTriggerLabel(run.trigger)}
                        </Badge>
                        <RunStatusBadge status={run.status} />
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs active:scale-[0.96]"
                          onClick={() =>
                            setSelectedRunId((current) =>
                              current === run.id ? null : run.id,
                            )
                          }
                        >
                          {isOpen ? 'Ocultar' : 'Itens'}
                        </Button>
                        {canRetry ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs active:scale-[0.96]"
                            onClick={() => retry.mutate({ runId: run.id })}
                            disabled={retry.isPending}
                          >
                            {retry.isPending ? 'Reprocessando…' : 'Reprocessar'}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {run.successCount}/{run.processedCount}
                      </span>{' '}
                      itens com sucesso ·{' '}
                      {formatIntegrationDateTime(run.createdAt)}
                    </p>
                    {run.errorSummary ? (
                      <p className="mt-1 text-xs text-destructive">
                        {run.errorSummary}
                      </p>
                    ) : null}
                    {isOpen ? (
                      <div className="mt-2.5 space-y-2 rounded-md bg-muted/40 p-2.5 ring-1 ring-inset ring-border/60">
                        {runItemsQuery.isLoading ? (
                          <Skeleton className="h-12 w-full" />
                        ) : runItems.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Nenhum item por registro retornado para esta
                            execução.
                          </p>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="tabular-nums">
                                {runItemsQuery.data?.summary.returnedCount ??
                                  runItems.length}{' '}
                                itens
                              </span>
                              {Object.entries(
                                runItemsQuery.data?.summary.statusCounts ?? {},
                              ).map(([status, count]) => (
                                <Badge
                                  key={status}
                                  variant="outline"
                                  className="font-normal tabular-nums"
                                >
                                  {status}: {count}
                                </Badge>
                              ))}
                            </div>
                            <div className="space-y-1.5">
                              {runItems.map((item) => (
                                <div
                                  key={item.id}
                                  className="rounded-md bg-background p-2 ring-1 ring-inset ring-border/60"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-medium">
                                      {item.localEntityId}
                                    </span>
                                    <RunItemStatusBadge status={item.status} />
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {item.operation} · tentativa{' '}
                                    <span className="tabular-nums">
                                      {item.attemptCount}
                                    </span>
                                    {item.remoteEntityId
                                      ? ` · remoto ${item.remoteEntityId}`
                                      : ''}
                                  </p>
                                  {item.lastErrorMessage ? (
                                    <p className="mt-1 text-xs text-destructive">
                                      {item.lastErrorCode
                                        ? `${item.lastErrorCode}: `
                                        : ''}
                                      {item.lastErrorMessage}
                                    </p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          Eventos recentes
        </h3>
        <ScrollArea className="h-[26rem]">
          <div className="space-y-2 pr-3">
            {integration.recentEvents.length === 0 ? (
              <EmptyState>Nenhum evento registrado.</EmptyState>
            ) : (
              integration.recentEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg bg-card p-3 text-sm ring-1 ring-inset ring-border/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{event.event}</span>
                    <Badge
                      variant={
                        event.level === 'error'
                          ? 'destructive'
                          : event.level === 'warning'
                            ? 'secondary'
                            : 'outline'
                      }
                      className="font-normal"
                    >
                      {event.level}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.message}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/80">
                    {formatIntegrationDateTime(event.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </section>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'FAILED'
      ? 'destructive'
      : status === 'COMPLETED'
        ? 'outline'
        : 'secondary'
  return (
    <Badge variant={variant} className="font-normal">
      {status}
    </Badge>
  )
}

function RunItemStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'FAILED' || status === 'DEAD_LETTER'
      ? 'destructive'
      : status === 'SUCCEEDED'
        ? 'outline'
        : 'secondary'
  return (
    <Badge variant={variant} className="font-normal">
      {status}
    </Badge>
  )
}
