import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowRight02Icon,
  CheckmarkCircle01Icon,
  Notebook01Icon,
  PlusSignIcon,
  RefreshIcon,
  RulerIcon,
  ShieldIcon,
  UserMultipleIcon,
  ChartLineData01Icon,
} from '@hugeicons/core-free-icons'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import { useActiveOrganization, useSession } from '@calibra-facil/auth/client'

import { Button } from '@/components/ui/button'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { cn } from '@/lib/utils'
import { jobRouteId, standardRouteId } from '@/lib/route-identifiers'
import {
  useDashboardIndexData,
  type DashboardJob,
  type DashboardJobStatus,
  type DashboardStats,
} from '@/features/dashboard/queries'
import {
  buildHealthSignals,
  buildPipeline,
  buildTrendSeries,
  defaultQueueView,
  formatCurrentDate,
  formatDueDate,
  formatShortDate,
  formatStandardDue,
  jobTitle,
  QUEUE_VIEWS,
  selectQueueJobs,
  STATUS_LABEL,
  sumTrend,
  type HealthSignal,
  type HealthSignalKey,
  type PipelineStage,
  type QueueView,
  type TrendWindow,
} from '@/features/dashboard/dashboard-model'

const DASHBOARD_INDEX_MOUNT_MARK = 'dashboard:index:mount'
const DASHBOARD_INDEX_DATA_READY_MARK = 'dashboard:index:data:ready'
const DASHBOARD_INDEX_FIRST_CONTENT_MARK = 'dashboard:index:first-content'

type IconType = Parameters<typeof HugeiconsIcon>[0]['icon']

const SECTION_LINK_CLASS =
  'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary transition-[background-color,transform] hover:bg-primary/10 motion-safe:active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

const FOCUS_RING_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

const STAGE_BAR_TONE: Record<PipelineStage['status'], string> = {
  DRAFT: 'bg-foreground/45',
  IN_PROGRESS: 'bg-primary/55',
  REVIEW: 'bg-primary',
  GENERATING_PDF: 'bg-emerald-500',
}

const STATUS_DOT: Record<DashboardJobStatus, string> = {
  DRAFT: 'bg-foreground/25',
  IN_PROGRESS: 'bg-primary/60',
  REVIEW: 'bg-primary',
  GENERATING_PDF: 'bg-emerald-500',
  APPROVED: 'bg-emerald-500',
  REJECTED: 'bg-destructive',
  CANCELED: 'bg-foreground/15',
  SUPERSEDED: 'bg-foreground/15',
}

const HEALTH_ICON: Record<HealthSignalKey, IconType> = {
  nc: Alert02Icon,
  capa: ShieldIcon,
  standards: RulerIcon,
  competences: UserMultipleIcon,
  validity: ChartLineData01Icon,
  intake: Notebook01Icon,
}

const TREND_WINDOWS: ReadonlyArray<{ value: '30' | '90'; label: string }> = [
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
]

const trendChartConfig: ChartConfig = {
  approved: { label: 'Aprovadas', color: 'var(--primary)' },
  rejected: { label: 'Rejeitadas', color: 'var(--destructive)' },
}

const queueSkeletonKeys = ['q-1', 'q-2', 'q-3', 'q-4', 'q-5']
const healthSkeletonKeys = ['h-1', 'h-2', 'h-3', 'h-4', 'h-5', 'h-6']
const standardSkeletonKeys = ['s-1', 's-2', 's-3']

function mark(name: string) {
  if (typeof window === 'undefined' || !window.performance) return
  window.performance.mark(name)
}

function measure(name: string, startMark: string, endMark: string) {
  if (typeof window === 'undefined' || !window.performance) return

  try {
    window.performance.measure(name, startMark, endMark)
  } catch {
    // Marks may not exist if navigation was interrupted.
  }
}

function getCurrentMemberRole(
  currentUserId: string | undefined,
  members:
    | ReadonlyArray<{ userId?: string; user?: { id?: string }; role?: string }>
    | undefined,
): string {
  const member = members?.find(
    (item) => item.userId === currentUserId || item.user?.id === currentUserId,
  )
  return typeof member?.role === 'string' ? member.role : 'member'
}

export function DashboardIndex() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const [updatedAt, setUpdatedAt] = useState('agora')
  const [refreshMessage, setRefreshMessage] = useState('')

  const role = getCurrentMemberRole(session?.user?.id, activeOrg?.members)
  const isManager = role === 'owner' || role === 'admin'
  const { data, isPending, isFetching, refetch, isRefetching } =
    useDashboardIndexData({
      activeOrganizationId,
      enabled: !isContextSwitching,
    })

  const isLoading = !data && (isPending || isFetching)
  const pipeline = buildPipeline(data?.statusBreakdown)

  async function refreshDashboard() {
    const result = await refetch()
    if (result.error) return

    const time = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date())
    setUpdatedAt(time)
    setRefreshMessage(`Dados atualizados às ${time}`)
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4 pb-8">
      <DashboardIndexMountMarker />
      {!isLoading ? (
        <>
          <DashboardIndexDataReadyMarker />
          <DashboardIndexFirstContentMarker />
        </>
      ) : null}

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {formatCurrentDate()}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]">
            Operação do laboratório
          </h1>
          {isLoading ? (
            <Skeleton className="mt-2 h-5 w-72 rounded-md" />
          ) : (
            <StatusLine data={data} open={pipeline.open} />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void refreshDashboard()}
            disabled={isRefetching}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              className={cn('size-4', isRefetching && 'animate-spin')}
            />
            Atualizado {updatedAt}
          </Button>
          <Button
            className={ACTION_BUTTON_CLASS}
            render={<Link to="/dashboard/jobs/new" />}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
            Nova calibração
          </Button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {refreshMessage}
        </p>
      </header>

      <StaggerGroup className="space-y-4">
        <StaggerItem>
          <PipelinePanel
            stages={pipeline.stages}
            open={pipeline.open}
            data={data}
            isLoading={isLoading}
          />
        </StaggerItem>

        {/*
          Two independent columns so each side packs its own panels; a shared
          row grid would stretch the shorter panel to the taller neighbour and
          leave dead space. Below xl the columns dissolve (`contents`) and the
          `order-*` classes interleave the panels by importance.
        */}
        <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,0.8fr)] xl:items-start">
          <div className="contents xl:flex xl:flex-col xl:gap-4">
            <StaggerItem className="order-1 xl:order-none">
              <WorkQueuePanel
                key={data ? 'ready' : 'loading'}
                data={data}
                isManager={isManager}
                isLoading={isLoading}
              />
            </StaggerItem>
            <StaggerItem className="order-3 xl:order-none">
              <ThroughputPanel data={data} isLoading={isLoading} />
            </StaggerItem>
          </div>
          <div className="contents xl:flex xl:flex-col xl:gap-4">
            <StaggerItem className="order-2 xl:order-none">
              <HealthPanel data={data} isLoading={isLoading} />
            </StaggerItem>
            <StaggerItem className="order-4 xl:order-none">
              <TraceabilityPanel
                standards={data?.standardsWatchlist ?? []}
                isLoading={isLoading}
              />
            </StaggerItem>
          </div>
        </div>
      </StaggerGroup>
    </div>
  )
}

function StatusLine({
  data,
  open,
}: {
  data: DashboardStats | undefined
  open: number
}) {
  if (!data) return null

  const overdue = data.overdueJobs
  const attention =
    data.nonConformancesAwaitingDisposition +
    data.capasOverdue +
    data.spcChartsWithSignals +
    data.ptPlanOverdue

  const tone: SignalTone = overdue > 0 || attention > 0 ? 'critical' : 'ok'
  const summary =
    overdue > 0
      ? `${overdue} ${overdue === 1 ? 'calibração atrasada' : 'calibrações atrasadas'}`
      : 'Prazos em dia'
  const detail =
    attention > 0
      ? `${attention} ${attention === 1 ? 'sinal de qualidade' : 'sinais de qualidade'} aguardando decisão`
      : `${open} ${open === 1 ? 'calibração em aberto' : 'calibrações em aberto'}`

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'size-2 rounded-full',
            tone === 'critical' ? 'bg-destructive' : 'bg-emerald-500',
          )}
        />
        <span
          className={cn(
            'font-medium',
            tone === 'critical' ? 'text-destructive' : 'text-foreground',
          )}
        >
          {summary}
        </span>
      </span>
      <span aria-hidden="true">·</span>
      <span>{detail}</span>
    </p>
  )
}

// — Row 1: pipeline —

function PipelinePanel({
  stages,
  open,
  data,
  isLoading,
}: {
  stages: PipelineStage[]
  open: number
  data: DashboardStats | undefined
  isLoading: boolean
}) {
  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Calibrações"
        title="Pipeline"
        description="Trabalho em aberto por etapa, da preparação à emissão."
        action={
          isLoading ? (
            <Skeleton className="h-6 w-24 rounded-full" />
          ) : (
            <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs font-semibold tabular-nums">
              {open} em aberto
            </span>
          )
        }
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <div className="grid gap-px overflow-hidden rounded-xl bg-foreground/10 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] sm:grid-cols-4">
            {stages.map((stage) => (
              <Link
                key={stage.status}
                to="/dashboard/jobs"
                search={{ status: stage.status }}
                className={cn(
                  'group block bg-card px-3.5 py-3 transition-colors hover:bg-muted/50 focus-visible:z-10 focus-visible:ring-inset',
                  FOCUS_RING_CLASS,
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 rounded-full',
                      STAGE_BAR_TONE[stage.status],
                    )}
                  />
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {stage.label}
                  </span>
                </div>
                {isLoading ? (
                  <Skeleton className="mt-2 h-7 w-10 rounded-md" />
                ) : (
                  <div className="mt-1.5 flex items-baseline gap-2">
                    <span
                      className={cn(
                        'font-mono text-2xl font-semibold leading-none tabular-nums',
                        stage.count === 0 && 'text-muted-foreground/60',
                      )}
                    >
                      {stage.count}
                    </span>
                    {stage.count > 0 && open > stage.count ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {Math.round(stage.share * 100)}%
                      </span>
                    ) : null}
                  </div>
                )}
              </Link>
            ))}
          </div>

          <div
            className="mt-3 flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-foreground/10"
            aria-hidden="true"
          >
            {!isLoading && open > 0
              ? stages
                  .filter((stage) => stage.count > 0)
                  .map((stage) => (
                    <span
                      key={stage.status}
                      className={cn(
                        'h-full transition-[flex-basis] duration-500',
                        STAGE_BAR_TONE[stage.status],
                      )}
                      style={{ flexBasis: `${stage.share * 100}%` }}
                    />
                  ))
              : null}
          </div>
        </div>

        <MonthSummary data={data} isLoading={isLoading} />
      </div>
    </Panel>
  )
}

function MonthSummary({
  data,
  isLoading,
}: {
  data: DashboardStats | undefined
  isLoading: boolean
}) {
  const approved = data?.approvedThisMonth ?? 0
  const rejected = data?.rejectedThisMonth ?? 0
  const decided = approved + rejected
  const items = [
    {
      label: 'Aprovadas no mês',
      value: approved,
      tone:
        approved > 0
          ? 'text-emerald-700 dark:text-emerald-400'
          : 'text-muted-foreground/60',
    },
    {
      label: 'Rejeitadas',
      value: rejected,
      tone: rejected > 0 ? 'text-destructive' : 'text-muted-foreground/60',
    },
    {
      label: 'Taxa de aprovação',
      value: decided > 0 ? `${data?.approvalRate ?? 0}%` : '—',
      tone: decided > 0 ? '' : 'text-muted-foreground/60',
    },
  ]

  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-foreground/10 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] lg:grid-cols-1">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center justify-between gap-3 bg-muted/35 px-3.5 py-2.5 max-lg:flex-col max-lg:items-start max-lg:gap-1"
        >
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          {isLoading ? (
            <Skeleton className="h-5 w-10 rounded-md" />
          ) : (
            <dd
              className={cn(
                'font-mono text-lg font-semibold leading-none tabular-nums',
                item.tone,
              )}
            >
              {item.value}
            </dd>
          )}
        </div>
      ))}
    </dl>
  )
}

// — Row 2: work queue + health —

function WorkQueuePanel({
  data,
  isManager,
  isLoading,
}: {
  data: DashboardStats | undefined
  isManager: boolean
  isLoading: boolean
}) {
  const [view, setView] = useState<QueueView>(() =>
    defaultQueueView(data, isManager),
  )
  const jobs = selectQueueJobs(data, view)

  const deadlineStats = [
    {
      label: 'atrasadas',
      value: data?.overdueJobs ?? 0,
      tone: (data?.overdueJobs ?? 0) > 0 ? 'text-destructive' : '',
    },
    {
      label: 'até hoje',
      value: data?.dueToday ?? 0,
      tone:
        (data?.dueToday ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : '',
    },
    { label: 'em 7 dias', value: data?.dueNextSevenDays ?? 0, tone: '' },
    {
      label: 'em revisão',
      value: data?.reviewQueue.length ?? 0,
      tone: (data?.reviewQueue.length ?? 0) > 0 ? 'text-primary' : '',
    },
  ]

  return (
    <Panel className="overflow-hidden">
      <div className="px-5 pt-5">
        <PanelHeader
          eyebrow="Fila de trabalho"
          title={
            view === 'due'
              ? 'Por prazo'
              : view === 'review'
                ? 'Aguardando revisão'
                : 'Criadas recentemente'
          }
          description={
            view === 'due'
              ? 'Calibrações abertas vencidas ou com prazo nos próximos sete dias.'
              : view === 'review'
                ? 'Submetidas pela execução e aguardando aprovação técnica.'
                : 'Últimas calibrações registradas no contexto selecionado.'
          }
          action={
            <SegmentedControl
              name="dashboard-queue-view"
              value={view}
              onValueChange={setView}
              options={QUEUE_VIEWS}
            />
          }
        />

        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          {deadlineStats.map((stat) => (
            <div key={stat.label} className="flex items-baseline gap-1.5">
              {isLoading ? (
                <Skeleton className="h-5 w-6 rounded-md" />
              ) : (
                <dd
                  className={cn(
                    'font-mono text-base font-semibold leading-none tabular-nums',
                    stat.tone,
                  )}
                >
                  {stat.value}
                </dd>
              )}
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-4 border-t border-border/70">
        {isLoading ? (
          <div className="divide-y divide-border/70">
            {queueSkeletonKeys.map((key) => (
              <div key={key} className="px-5 py-3.5">
                <Skeleton className="h-10 rounded-md" />
              </div>
            ))}
          </div>
        ) : jobs.length > 0 ? (
          <ol className="divide-y divide-border/70">
            {jobs.map((job, index) => (
              <li key={job.id}>
                <QueueRow job={job} index={index} view={view} />
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            icon={CheckmarkCircle01Icon}
            title={
              view === 'due'
                ? 'Nenhum prazo próximo'
                : view === 'review'
                  ? 'Nada aguardando revisão'
                  : 'Nenhuma calibração registrada'
            }
            description={
              view === 'due'
                ? 'Não há calibrações vencidas nem com prazo nos próximos sete dias.'
                : view === 'review'
                  ? 'Todas as execuções submetidas já foram avaliadas.'
                  : 'Crie a primeira calibração para vê-la aqui.'
            }
          />
        )}
      </div>

      <div className="flex justify-end border-t border-border/70 px-3 py-2">
        <Link
          to="/dashboard/jobs"
          search={view === 'review' ? { status: 'REVIEW' } : {}}
          className={SECTION_LINK_CLASS}
        >
          Abrir todas as calibrações
          <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
        </Link>
      </div>
    </Panel>
  )
}

function QueueRow({
  job,
  index,
  view,
}: {
  job: DashboardJob
  index: number
  view: QueueView
}) {
  const routeId = jobRouteId(job)
  const isOverdue = Boolean(job.isOverdue)
  const trailing =
    view === 'recent'
      ? formatShortDate(job.createdAt)
      : formatDueDate(job.dueDate, job.isOverdue)
  const trailingTone =
    view !== 'recent' && isOverdue
      ? 'text-destructive'
      : view === 'due' && trailing === 'Hoje'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-muted-foreground'

  const rowClass = cn(
    'grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-5 py-3 transition-colors hover:bg-muted/40 sm:grid-cols-[1.5rem_minmax(0,1fr)_8rem_7.5rem]',
    'focus-visible:outline-none focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
  )

  const content = (
    <>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 rounded-full',
            isOverdue && view !== 'recent'
              ? 'bg-destructive'
              : STATUS_DOT[job.status],
          )}
        />
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {String(index + 1).padStart(2, '0')}
        </span>
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium">{jobTitle(job)}</span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {job.jobId}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {job.customerName ?? 'Cliente não informado'}
          {job.technicianName ? ` · ${job.technicianName}` : ''}
          <span className="sm:hidden"> · {STATUS_LABEL[job.status]}</span>
        </span>
      </span>
      <span className="hidden sm:block">
        <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
          {STATUS_LABEL[job.status]}
        </span>
      </span>
      <span
        className={cn(
          'text-end text-xs font-medium tabular-nums',
          trailingTone,
        )}
      >
        {trailing}
      </span>
    </>
  )

  if (job.status === 'IN_PROGRESS' && view === 'due') {
    return (
      <Link
        to="/dashboard/jobs/$id/execute"
        params={{ id: routeId }}
        preload="intent"
        className={rowClass}
      >
        {content}
      </Link>
    )
  }

  return (
    <Link
      to="/dashboard/jobs/$id"
      params={{ id: routeId }}
      preload="intent"
      className={rowClass}
    >
      {content}
    </Link>
  )
}

function HealthPanel({
  data,
  isLoading,
}: {
  data: DashboardStats | undefined
  isLoading: boolean
}) {
  const signals = data ? buildHealthSignals(data) : []

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="ISO/IEC 17025"
        title="Saúde do laboratório"
        description="Sinais de qualidade, rastreabilidade e pessoal."
      />
      {isLoading ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {healthSkeletonKeys.map((key) => (
            <Skeleton key={key} className="h-[4.75rem] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {signals.map((signal) => (
            <HealthLink key={signal.key} signal={signal}>
              <SignalTile
                icon={HEALTH_ICON[signal.key]}
                label={signal.label}
                value={signal.value}
                hint={signal.hint}
                tone={signal.tone}
                className="h-full transition-[box-shadow] group-hover:shadow-[inset_0_0_0_1px_rgba(15,23,42,0.18)] dark:group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]"
              />
            </HealthLink>
          ))}
        </div>
      )}
    </Panel>
  )
}

function HealthLink({
  signal,
  children,
}: {
  signal: HealthSignal
  children: ReactNode
}) {
  const className = cn('group block rounded-xl', FOCUS_RING_CLASS)

  switch (signal.key) {
    case 'nc':
      return (
        <Link
          to="/dashboard/nc"
          search={{ status: 'open' }}
          className={className}
        >
          {children}
        </Link>
      )
    case 'capa':
      return (
        <Link
          to="/dashboard/capa"
          search={{ status: 'OPEN' }}
          className={className}
        >
          {children}
        </Link>
      )
    case 'standards':
      return (
        <Link to="/dashboard/standards" className={className}>
          {children}
        </Link>
      )
    case 'competences':
      return (
        <Link to="/dashboard/personnel" className={className}>
          {children}
        </Link>
      )
    case 'validity':
      return (
        <Link to="/dashboard/spc" className={className}>
          {children}
        </Link>
      )
    case 'intake':
      return (
        <Link
          to="/dashboard/requests"
          search={{ status: 'PENDING' }}
          className={className}
        >
          {children}
        </Link>
      )
  }
}

// — Row 3: throughput + traceability —

function ThroughputPanel({
  data,
  isLoading,
}: {
  data: DashboardStats | undefined
  isLoading: boolean
}) {
  const [range, setRange] = useState<'30' | '90'>('30')
  const days: TrendWindow = range === '90' ? 90 : 30
  const series = buildTrendSeries(data?.calibrationTrend, days)
  const totals = sumTrend(series)

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Ritmo"
        title="Decisões por dia"
        description="Calibrações aprovadas e rejeitadas na revisão técnica."
        action={
          <SegmentedControl
            name="dashboard-trend-window"
            value={range}
            onValueChange={setRange}
            options={TREND_WINDOWS}
          />
        }
      />

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <TrendTotal
          label="aprovadas"
          value={totals.approved}
          swatch="bg-primary"
          isLoading={isLoading}
        />
        <TrendTotal
          label="rejeitadas"
          value={totals.rejected}
          swatch="bg-destructive"
          isLoading={isLoading}
        />
      </dl>

      {isLoading ? (
        <Skeleton className="mt-4 h-40 rounded-xl" />
      ) : totals.approved + totals.rejected === 0 ? (
        <div className="mt-4 flex h-40 flex-col items-center justify-center rounded-xl bg-muted/35 px-4 text-center shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
          <p className="text-sm font-medium">Nenhuma decisão no período</p>
          <p className="mt-1 max-w-xs text-pretty text-xs text-muted-foreground">
            O ritmo aparece aqui conforme calibrações forem aprovadas ou
            rejeitadas na revisão técnica.
          </p>
        </div>
      ) : (
        <ChartContainer
          config={trendChartConfig}
          className="mt-4 aspect-auto h-40 w-full"
        >
          <AreaChart
            data={series}
            margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
          >
            <defs>
              <linearGradient
                id="dashboard-approved"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="var(--color-approved)"
                  stopOpacity={0.28}
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-approved)"
                  stopOpacity={0.02}
                />
              </linearGradient>
              <linearGradient
                id="dashboard-rejected"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="var(--color-rejected)"
                  stopOpacity={0.22}
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-rejected)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value: string) =>
                new Intl.DateTimeFormat('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                }).format(new Date(`${value}T12:00:00`))
              }
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(value) =>
                    new Intl.DateTimeFormat('pt-BR', {
                      weekday: 'short',
                      day: '2-digit',
                      month: 'short',
                    }).format(new Date(`${String(value)}T12:00:00`))
                  }
                />
              }
            />
            <Area
              dataKey="rejected"
              type="monotone"
              stroke="var(--color-rejected)"
              strokeWidth={1.5}
              fill="url(#dashboard-rejected)"
              isAnimationActive={false}
            />
            <Area
              dataKey="approved"
              type="monotone"
              stroke="var(--color-approved)"
              strokeWidth={1.5}
              fill="url(#dashboard-approved)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </Panel>
  )
}

function TrendTotal({
  label,
  value,
  swatch,
  isLoading,
}: {
  label: string
  value: number
  swatch: string
  isLoading: boolean
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        aria-hidden="true"
        className={cn('size-2 translate-y-[-1px] rounded-full', swatch)}
      />
      {isLoading ? (
        <Skeleton className="h-5 w-6 rounded-md" />
      ) : (
        <dd className="font-mono text-base font-semibold leading-none tabular-nums">
          {value}
        </dd>
      )}
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  )
}

function TraceabilityPanel({
  standards,
  isLoading,
}: {
  standards: DashboardStats['standardsWatchlist']
  isLoading: boolean
}) {
  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Rastreabilidade"
        title="Padrões a vencer"
        description="Padrões ativos com calibração vencendo em até 30 dias."
      />

      {isLoading ? (
        <div className="mt-4 space-y-2">
          {standardSkeletonKeys.map((key) => (
            <Skeleton key={key} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : standards.length > 0 ? (
        <ol className="mt-3 divide-y divide-border/70">
          {standards.map((standard) => {
            const due = formatStandardDue(standard.nextCalibrationDate)
            return (
              <li key={standard.id}>
                <Link
                  to="/dashboard/standards/$id"
                  params={{ id: standardRouteId(standard) }}
                  preload="intent"
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-lg px-1 py-2.5 transition-colors hover:bg-muted/40',
                    FOCUS_RING_CLASS,
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {standard.name}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                      {standard.serialNumber} · cert.{' '}
                      {standard.certificateNumber}
                    </span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block text-xs font-medium tabular-nums text-amber-700 dark:text-amber-400">
                      {due}
                    </span>
                    <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatShortDate(standard.nextCalibrationDate)}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-emerald-500/10 p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
          <HugeiconsIcon
            icon={CheckmarkCircle01Icon}
            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <p className="text-sm">
            <span className="font-medium">
              Cadeia de rastreabilidade em dia.
            </span>{' '}
            <span className="text-muted-foreground">
              Nenhum padrão vence nos próximos 30 dias.
            </span>
          </p>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <Link to="/dashboard/standards" className={SECTION_LINK_CLASS}>
          Ver todos os padrões
          <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
        </Link>
      </div>
    </Panel>
  )
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: IconType
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center px-4 text-center">
      <span className="mb-2 grid size-8 place-items-center rounded-full bg-emerald-500/10">
        <HugeiconsIcon
          icon={icon}
          className="size-4 text-emerald-600 dark:text-emerald-400"
        />
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-pretty text-xs text-muted-foreground">
        {description}
      </p>
    </div>
  )
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
    const frame = window.requestAnimationFrame(() => {
      mark(DASHBOARD_INDEX_FIRST_CONTENT_MARK)
      measure(
        'dashboard:index:first-content',
        DASHBOARD_INDEX_MOUNT_MARK,
        DASHBOARD_INDEX_FIRST_CONTENT_MARK,
      )
    })

    return () => window.cancelAnimationFrame(frame)
  })

  return null
}
