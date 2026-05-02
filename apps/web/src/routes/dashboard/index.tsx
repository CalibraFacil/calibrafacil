import { Link, createFileRoute } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowRight02Icon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Notebook01Icon,
  PlusSignIcon,
  RefreshIcon,
  RulerIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { jobRouteId } from '@/lib/route-identifiers'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { useMountEffect } from '@/hooks/use-mount-effect'
import {
  loadDashboardIndexData,
  useDashboardIndexData,
  type DashboardStats,
} from './-index.data'
import { SectionCards } from './-components/section-cards'
import { ChartCalibrations } from './-components/chart-calibrations'
import { RecentJobsTable } from './-components/recent-jobs-table'

const DASHBOARD_INDEX_MOUNT_MARK = 'dashboard:index:mount'
const DASHBOARD_INDEX_DATA_READY_MARK = 'dashboard:index:data:ready'
const DASHBOARD_INDEX_FIRST_CONTENT_MARK = 'dashboard:index:first-content'

function mark(name: string) {
  if (typeof window === 'undefined' || !window.performance) return
  window.performance.mark(name)
}

function measure(name: string, startMark: string, endMark: string) {
  if (typeof window === 'undefined' || !window.performance) return

  try {
    window.performance.measure(name, startMark, endMark)
  } catch {
    // no-op: marks may not exist if navigation interrupted
  }
}

export const Route = createFileRoute('/dashboard/')({
  loader: ({ context }) => loadDashboardIndexData(context.queryClient),
  head: () => ({
    meta: [
      {
        title: 'Dashboard | CalibraFácil',
        name: 'description',
        content: 'Painel de Controle - Visão geral do laboratório',
      },
    ],
  }),
  component: DashboardIndex,
})

function DashboardIndex() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()

  const { data, isPending, isFetching, refetch, isRefetching } =
    useDashboardIndexData({
      activeOrganizationId,
      enabled: !isContextSwitching,
    })

  const isLoading = !data && (isPending || isFetching)

  return (
    <div className="space-y-5 @container">
      <DashboardIndexMountMarker />
      {!isLoading ? (
        <>
          <DashboardIndexDataReadyMarker />
          <DashboardIndexFirstContentMarker />
        </>
      ) : null}

      <div className="rounded-2xl bg-card px-4 py-4 text-card-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_32px_rgba(0,0,0,0.06)] ring-1 ring-foreground/10 sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={data?.overdueJobs ? 'destructive' : 'outline'}>
                {data?.overdueJobs
                  ? `${data.overdueJobs} em atraso`
                  : 'Operação em dia'}
              </Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                Atualiza automaticamente a cada 60s
              </span>
            </div>
            <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Operação do laboratório
            </h1>
            <p className="mt-1 max-w-3xl text-pretty text-sm text-muted-foreground">
              Priorize calibrações vencendo, libere certificados em revisão e
              mantenha padrões rastreáveis antes de distribuir o trabalho.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="min-h-10 active:scale-[0.96] transition-transform"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                className={cn('size-4', isRefetching && 'animate-spin')}
              />
              Atualizar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-10 active:scale-[0.96] transition-transform"
              render={<Link to="/dashboard/requests" />}
            >
              <HugeiconsIcon icon={Notebook01Icon} className="size-4" />
              Solicitações
            </Button>
            <Button
              size="sm"
              className="min-h-10 active:scale-[0.96] transition-transform"
              render={<Link to="/dashboard/jobs/new" />}
            >
              <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
              Nova calibração
            </Button>
          </div>
        </div>
      </div>

      <LabOperationsBoard data={data} isLoading={isLoading} />

      <SectionCards
        pendingCalibrations={data?.pendingCalibrations ?? 0}
        approvedThisMonth={data?.approvedThisMonth ?? 0}
        expiringStandards={data?.expiringStandards ?? 0}
        approvalRate={data?.approvalRate ?? 100}
        overdueJobs={data?.overdueJobs ?? 0}
        isLoading={isLoading}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
        <ChartCalibrations
          data={data?.calibrationTrend ?? []}
          isLoading={isLoading}
        />
        <RecentJobsTable jobs={data?.recentJobs ?? []} isLoading={isLoading} />
      </div>
    </div>
  )
}

function LabOperationsBoard({
  data,
  isLoading,
}: {
  data?: DashboardStats
  isLoading: boolean
}) {
  const statusCounts = new Map(
    (data?.statusBreakdown ?? []).map((item) => [item.status, item.count]),
  )
  const totalOpen = Math.max(data?.pendingCalibrations ?? 0, 1)
  const reviewCount = statusCounts.get('REVIEW') ?? 0
  const inProgressCount = statusCounts.get('IN_PROGRESS') ?? 0
  const draftCount = statusCounts.get('DRAFT') ?? 0

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
      <Card className="rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.05),0_16px_40px_rgba(0,0,0,0.05)]">
        <CardHeader className="gap-2">
          <CardTitle className="text-balance text-lg">
            Fila operacional
          </CardTitle>
          <CardDescription className="text-pretty">
            Trabalho aberto por urgência, execução e revisão.
          </CardDescription>
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-10 active:scale-[0.96] transition-transform"
              render={<Link to="/dashboard/jobs" />}
            >
              Ver fila
              <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <PriorityTile
            icon={Alert02Icon}
            label="Vencem hoje"
            value={data?.dueToday ?? 0}
            tone={(data?.dueToday ?? 0) > 0 ? 'critical' : 'neutral'}
            isLoading={isLoading}
          />
          <PriorityTile
            icon={Clock01Icon}
            label="Próximos 7 dias"
            value={data?.dueNextSevenDays ?? 0}
            tone={(data?.dueNextSevenDays ?? 0) > 0 ? 'warning' : 'neutral'}
            isLoading={isLoading}
          />
          <PriorityTile
            icon={CheckmarkCircle01Icon}
            label="Aguardando revisão"
            value={reviewCount}
            tone={reviewCount > 0 ? 'review' : 'neutral'}
            isLoading={isLoading}
          />
          <div className="space-y-3 rounded-xl bg-muted/35 p-4 md:col-span-3">
            <QueueBar label="Rascunho" value={draftCount} total={totalOpen} />
            <QueueBar
              label="Em execução"
              value={inProgressCount}
              total={totalOpen}
            />
            <QueueBar
              label="Em revisão"
              value={reviewCount}
              total={totalOpen}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.05),0_16px_40px_rgba(0,0,0,0.05)]">
        <CardHeader>
          <CardTitle className="text-balance text-lg">
            Padrões em atenção
          </CardTitle>
          <CardDescription className="text-pretty">
            Rastreabilidade vencendo nos próximos 30 dias.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, index) => (
                <Skeleton key={index} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : data?.standardsWatchlist.length ? (
            <div className="space-y-2">
              {data.standardsWatchlist.map((standard) => (
                <Link
                  key={standard.id}
                  to="/dashboard/standards/$id"
                  params={{ id: String(standard.id) }}
                  className="group flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)] transition-colors hover:bg-muted/60 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400">
                    <HugeiconsIcon icon={RulerIcon} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {standard.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {standard.serialNumber} · cert.{' '}
                      {standard.certificateNumber}
                    </span>
                  </span>
                  <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {formatDate(standard.nextCalibrationDate)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={RulerIcon}
              title="Sem vencimentos próximos"
              description="Nenhum padrão ativo vence nos próximos 30 dias."
            />
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.05),0_16px_40px_rgba(0,0,0,0.05)] xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-balance text-lg">
            Revisões para liberar
          </CardTitle>
          <CardDescription className="text-pretty">
            Certificados prontos para análise técnica ou qualidade.
          </CardDescription>
          <CardAction>
            <Badge variant={reviewCount > 0 ? 'default' : 'outline'}>
              <span className="tabular-nums">{reviewCount}</span> em revisão
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {[...Array(5)].map((_, index) => (
                <Skeleton key={index} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : data?.reviewQueue.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {data.reviewQueue.map((job) => (
                <Link
                  key={job.id}
                  to="/dashboard/jobs/$id"
                  params={{ id: jobRouteId(job) }}
                  className="group min-h-28 rounded-xl p-3 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] transition-colors hover:bg-muted/60 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {job.jobId}
                    </span>
                    {job.isOverdue ? (
                      <Badge variant="destructive">Atrasada</Badge>
                    ) : (
                      <Badge variant="outline">Revisar</Badge>
                    )}
                  </div>
                  <p className="mt-3 truncate text-sm font-medium">
                    {job.customerName ?? 'Cliente não informado'}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {job.assetName ?? job.serviceName ?? 'Ativo não informado'}
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <HugeiconsIcon icon={UserIcon} className="size-3.5" />
                    <span className="truncate">
                      {job.technicianName ?? 'Sem técnico'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CheckmarkCircle01Icon}
              title="Nada aguardando revisão"
              description="A fila de revisão está limpa para o contexto selecionado."
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PriorityTile({
  icon,
  label,
  value,
  tone,
  isLoading,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  label: string
  value: number
  tone: 'critical' | 'warning' | 'review' | 'neutral'
  isLoading: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl p-4 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]',
        tone === 'critical' && 'bg-destructive/8 text-destructive',
        tone === 'warning' &&
          'bg-amber-500/10 text-amber-700 dark:text-amber-400',
        tone === 'review' && 'bg-primary/10 text-primary',
        tone === 'neutral' && 'bg-muted/40 text-foreground',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <HugeiconsIcon icon={icon} className="size-4" />
      </div>
      {isLoading ? (
        <Skeleton className="mt-4 h-9 w-16" />
      ) : (
        <div className="mt-3 text-3xl font-semibold tabular-nums">{value}</div>
      )}
    </div>
  )
}

function QueueBar({
  label,
  value,
  total,
}: {
  label: string
  value: number
  total: number
}) {
  const percent = Math.min(100, Math.round((value / total) * 100))

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-background shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-xl bg-muted/30 px-4 text-center">
      <HugeiconsIcon
        icon={icon}
        className="mb-2 size-5 text-muted-foreground"
      />
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-pretty text-xs text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR')
}

function DashboardIndexMountMarker() {
  useMountEffect(() => {
    mark(DASHBOARD_INDEX_MOUNT_MARK)
  })

  return null
}

function DashboardIndexDataReadyMarker() {
  useMountEffect(() => {
    mark(DASHBOARD_INDEX_DATA_READY_MARK)
    measure(
      'dashboard:index:data-ready',
      DASHBOARD_INDEX_MOUNT_MARK,
      DASHBOARD_INDEX_DATA_READY_MARK,
    )
  })

  return null
}

function DashboardIndexFirstContentMarker() {
  useMountEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      mark(DASHBOARD_INDEX_FIRST_CONTENT_MARK)
      measure(
        'dashboard:index:first-content',
        DASHBOARD_INDEX_MOUNT_MARK,
        DASHBOARD_INDEX_FIRST_CONTENT_MARK,
      )
    })

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  })

  return null
}
