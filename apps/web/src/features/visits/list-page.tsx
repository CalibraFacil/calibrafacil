import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Location01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Panel } from '@/components/instrument-panel'
import { cn } from '@/lib/utils'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { useVisitsListData } from '@/features/visits/queries'
import {
  formatVisitAddress,
  VISIT_STATUS_LABELS,
  VISIT_STATUS_VARIANTS,
  type VisitStatus,
} from '@/features/visits/types'

function formatDate(date: string | null | undefined) {
  if (!date) return 'A confirmar'
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const STATUS_FILTERS: Array<{ value: VisitStatus | ''; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'PROPOSED', label: 'Propostas' },
  { value: 'CONFIRMED', label: 'Confirmadas' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'COMPLETED', label: 'Concluídas' },
]

export function VisitsPage() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const [mine, setMine] = useState(true)
  const [status, setStatus] = useState<VisitStatus | ''>('')
  const [page, setPage] = useState(1)

  const enabled =
    Boolean(activeOrganizationId) &&
    !isContextSwitching &&
    !cloudOnlyUnavailable

  const { data, isLoading, error } = useVisitsListData({
    activeOrganizationId,
    enabled,
    page,
    status,
    mine,
  })

  if (cloudOnlyUnavailable) {
    return <CloudOnlyOfflineState title="Visitas indisponíveis offline" />
  }

  const visits = data?.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Calibração in loco
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Visitas
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Visitas técnicas agendadas no local do cliente, com os instrumentos
            de cada viagem.
          </p>
        </div>
      </div>

      <Panel className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.value || 'all'}
                variant={status === filter.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setStatus(filter.value)
                  setPage(1)
                }}
              >
                {filter.label}
              </Button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Button
              variant={mine ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setMine(true)
                setPage(1)
              }}
            >
              Minhas visitas
            </Button>
            <Button
              variant={!mine ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setMine(false)
                setPage(1)
              }}
            >
              Todas da unidade
            </Button>
          </div>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="size-7" />
            </div>
          ) : error ? (
            <div className="rounded-xl bg-destructive/10 p-4 text-center text-sm text-destructive">
              Erro ao carregar as visitas.
            </div>
          ) : visits.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Location01Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhuma visita</EmptyTitle>
                <EmptyDescription>
                  {mine
                    ? 'Você não tem visitas no local atribuídas neste filtro.'
                    : 'Nenhuma visita agendada para este filtro.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-2">
              {visits.map((visit) => {
                const addressText = formatVisitAddress(visit.address)
                return (
                  <div
                    key={visit.id}
                    className="flex flex-col gap-3 rounded-xl bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {visit.customerName}
                        </span>
                        <Badge variant={VISIT_STATUS_VARIANTS[visit.status]}>
                          {VISIT_STATUS_LABELS[visit.status]}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        <span className="font-mono tabular-nums">
                          {formatDate(visit.scheduledAt)}
                        </span>
                        {' · '}
                        {visit.assetCount}{' '}
                        {visit.assetCount === 1
                          ? 'instrumento'
                          : 'instrumentos'}
                        {visit.technicianName
                          ? ` · ${visit.technicianName}`
                          : ' · sem técnico'}
                        {addressText ? ` · ${addressText}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      render={
                        <Link
                          to="/dashboard/visits/$id"
                          params={{ id: String(visit.id) }}
                        />
                      }
                    >
                      Gerenciar
                      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {data && data.pagination.totalPages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </Button>
            <span className={cn('text-muted-foreground tabular-nums')}>
              {page} / {data.pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Próxima
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
