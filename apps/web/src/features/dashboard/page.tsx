import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
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
} from '@hugeicons/core-free-icons'
import { useActiveOrganization, useSession } from '@calibra-facil/auth/client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { cn } from '@/lib/utils'
import { jobRouteId } from '@/lib/route-identifiers'
import {
  useDashboardIndexData,
  type DashboardJob,
  type DashboardJobStatus,
  type DashboardStats,
} from '@/features/dashboard/queries'

const DASHBOARD_INDEX_MOUNT_MARK = 'dashboard:index:mount'
const DASHBOARD_INDEX_DATA_READY_MARK = 'dashboard:index:data:ready'
const DASHBOARD_INDEX_FIRST_CONTENT_MARK = 'dashboard:index:first-content'

const surface =
  'rounded-2xl bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_rgba(15,23,42,0.05)] ring-1 ring-foreground/10'

const queueSkeletonKeys = ['priority-1', 'priority-2', 'priority-3']
const deliverySkeletonKeys = ['delivery-1', 'delivery-2', 'delivery-3']
const traceabilitySkeletonKeys = ['standard-1', 'standard-2']

const statusLabel: Record<DashboardJobStatus, string> = {
  DRAFT: 'Preparação',
  IN_PROGRESS: 'Em execução',
  REVIEW: 'Revisão técnica',
  GENERATING_PDF: 'Emitindo PDF',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELED: 'Cancelada',
  SUPERSEDED: 'Substituída',
}

type ActionKind =
  | 'overdue'
  | 'deadline'
  | 'review'
  | 'request'
  | 'standard'
  | 'quality'

type ActionTarget =
  | { type: 'job'; id: string; execute: boolean }
  | { type: 'requests' }
  | { type: 'standard'; id: string }
  | { type: 'nc' }
  | { type: 'capa' }

type OperationalAction = {
  key: string
  kind: ActionKind
  label: string
  title: string
  context: string
  deadline: string
  action: string
  target: ActionTarget
}

const actionIcon: Record<
  ActionKind,
  Parameters<typeof HugeiconsIcon>[0]['icon']
> = {
  overdue: Alert02Icon,
  deadline: Clock01Icon,
  review: CheckmarkCircle01Icon,
  request: Notebook01Icon,
  standard: RulerIcon,
  quality: Alert02Icon,
}

const actionTone: Record<ActionKind, string> = {
  overdue: 'bg-destructive/10 text-destructive',
  deadline: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  review: 'bg-primary/10 text-primary',
  request: 'bg-muted text-muted-foreground',
  standard: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  quality: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
}

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
  const priorities = buildOperationalActions(data, isManager).slice(0, 3)
  const reviewCount =
    data?.statusBreakdown.find((item) => item.status === 'REVIEW')?.count ?? 0

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
    <div className="@container mx-auto w-full max-w-[1440px] space-y-5 pb-8">
      <DashboardIndexMountMarker />
      {!isLoading ? (
        <>
          <DashboardIndexDataReadyMarker />
          <DashboardIndexFirstContentMarker />
        </>
      ) : null}

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">
            {formatCurrentDate()}
          </p>
          {isLoading ? (
            <Skeleton className="mt-2 h-10 w-full max-w-xl rounded-lg" />
          ) : (
            <h1 className="mt-1 max-w-3xl text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              {priorities.length > 0
                ? `${priorities.length} ${priorities.length === 1 ? 'prioridade' : 'prioridades'} para agora`
                : 'Operação em dia'}
            </h1>
          )}
          <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
            {isLoading
              ? 'Carregando prioridades do contexto selecionado.'
              : priorities.length > 0
                ? 'Comece pelo que afeta prazo, liberação ou continuidade do laboratório.'
                : 'Nenhuma pendência crítica foi encontrada no contexto selecionado.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void refreshDashboard()}
            disabled={isRefetching}
            className="min-h-10 transition-[background-color,transform] motion-safe:active:scale-[0.96]"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              className={cn('size-4', isRefetching && 'animate-spin')}
            />
            Atualizado {updatedAt}
          </Button>
          <Button
            className="min-h-10 transition-transform motion-safe:active:scale-[0.96]"
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

      <section className="flex flex-col gap-4 xl:grid xl:items-start xl:grid-cols-[minmax(0,1.55fr)_minmax(19rem,0.68fr)]">
        <div className="contents xl:block xl:space-y-4">
          <ActionQueue
            priorities={priorities}
            overdueCount={data?.overdueJobs ?? 0}
            isLoading={isLoading}
          />
          <UpcomingDeliveries
            jobs={data?.dueSoonJobs ?? []}
            isLoading={isLoading}
          />
        </div>

        <aside className="space-y-4">
          <OperationSummary
            overdue={data?.overdueJobs ?? 0}
            dueToday={data?.dueToday ?? 0}
            review={reviewCount}
            dueNextSevenDays={data?.dueNextSevenDays ?? 0}
            isLoading={isLoading}
          />
          <TraceabilitySummary
            standards={data?.standardsWatchlist ?? []}
            isLoading={isLoading}
          />
        </aside>
      </section>
    </div>
  )
}

function ActionQueue({
  priorities,
  overdueCount,
  isLoading,
}: {
  priorities: OperationalAction[]
  overdueCount: number
  isLoading: boolean
}) {
  return (
    <section className={`${surface} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-1 pb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Fila de ação</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ordenada por prazo e bloqueio operacional.
          </p>
        </div>
        {!isLoading && overdueCount > 0 ? (
          <span className="rounded-full bg-destructive/10 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-destructive">
            {overdueCount} {overdueCount === 1 ? 'atrasada' : 'atrasadas'}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {queueSkeletonKeys.map((key) => (
            <Skeleton key={key} className="h-[6.5rem] rounded-xl" />
          ))}
        </div>
      ) : priorities.length > 0 ? (
        <ol className="space-y-2">
          {priorities.map((item, index) => (
            <li key={item.key}>
              <article className="group grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 rounded-xl bg-muted/35 p-3.5 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center sm:p-4">
                <span
                  className={`grid size-10 place-items-center rounded-lg ${actionTone[item.kind]}`}
                  aria-hidden="true"
                >
                  <HugeiconsIcon
                    icon={actionIcon[item.kind]}
                    className="size-[18px]"
                  />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {item.label}
                    </span>
                    <span
                      className={cn(
                        'text-xs font-semibold tabular-nums',
                        item.kind === 'overdue'
                          ? 'text-destructive'
                          : 'text-muted-foreground',
                      )}
                    >
                      {item.deadline}
                    </span>
                  </div>
                  <h3 className="mt-1 text-sm font-semibold sm:text-[15px]">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    {item.context}
                  </p>
                </div>
                <OperationalActionLink item={item} />
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          icon={CheckmarkCircle01Icon}
          title="Nenhuma ação crítica"
          description="A fila está limpa para o contexto selecionado."
        />
      )}
    </section>
  )
}

function OperationalActionLink({ item }: { item: OperationalAction }) {
  const className =
    'col-span-2 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-primary transition-[background-color,transform] hover:bg-primary/10 motion-safe:active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:col-span-1 sm:justify-start'
  const content = (
    <>
      {item.action}
      <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
    </>
  )

  switch (item.target.type) {
    case 'job':
      return item.target.execute ? (
        <Link
          to="/dashboard/jobs/$id/execute"
          params={{ id: item.target.id }}
          preload="intent"
          className={className}
        >
          {content}
        </Link>
      ) : (
        <Link
          to="/dashboard/jobs/$id"
          params={{ id: item.target.id }}
          preload="intent"
          className={className}
        >
          {content}
        </Link>
      )
    case 'requests':
      return (
        <Link
          to="/dashboard/requests"
          search={{ status: 'PENDING' }}
          className={className}
        >
          {content}
        </Link>
      )
    case 'standard':
      return (
        <Link
          to="/dashboard/standards/$id"
          params={{ id: item.target.id }}
          preload="intent"
          className={className}
        >
          {content}
        </Link>
      )
    case 'nc':
      return (
        <Link
          to="/dashboard/nc"
          search={{ status: 'open' }}
          className={className}
        >
          {content}
        </Link>
      )
    case 'capa':
      return (
        <Link
          to="/dashboard/capa"
          search={{ status: 'OPEN' }}
          className={className}
        >
          {content}
        </Link>
      )
  }
}

function UpcomingDeliveries({
  jobs,
  isLoading,
}: {
  jobs: DashboardJob[]
  isLoading: boolean
}) {
  return (
    <section className={`${surface} overflow-hidden`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Próximas entregas
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Calibrações abertas com prazo nos próximos sete dias.
          </p>
        </div>
        <SectionLink to="/dashboard/jobs">Abrir fila completa</SectionLink>
      </div>

      {isLoading ? (
        <div className="space-y-px border-t border-border/70 bg-border/70">
          {deliverySkeletonKeys.map((key) => (
            <Skeleton key={key} className="h-[4.25rem] rounded-none" />
          ))}
        </div>
      ) : jobs.length > 0 ? (
        <>
          <div className="divide-y divide-border/70 sm:hidden">
            {jobs.map((job) => (
              <UpcomingDeliveryCard key={job.id} job={job} />
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[38rem] text-start text-sm">
              <thead className="bg-muted/35 text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 text-start font-medium">
                    Calibração
                  </th>
                  <th className="px-4 py-3 text-start font-medium">Cliente</th>
                  <th className="px-4 py-3 text-start font-medium">Etapa</th>
                  <th className="px-6 py-3 text-end font-medium">Prazo</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <UpcomingDeliveryRow key={job.id} job={job} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="border-t border-border/70 p-5">
          <EmptyState
            icon={CheckmarkCircle01Icon}
            title="Nenhuma entrega próxima"
            description="Não há calibrações abertas vencendo nos próximos sete dias."
          />
        </div>
      )}
    </section>
  )
}

function UpcomingDeliveryCard({ job }: { job: DashboardJob }) {
  const routeId = jobRouteId(job)

  return (
    <Link
      to="/dashboard/jobs/$id"
      params={{ id: routeId }}
      preload="intent"
      className="block px-5 py-4 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs font-semibold tabular-nums">
          {job.jobId}
        </span>
        <span
          className={cn(
            'text-xs font-semibold tabular-nums',
            job.isOverdue ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {formatDueDate(job.dueDate, job.isOverdue)}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold">{jobTitle(job)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {job.customerName ?? 'Cliente não informado'} ·{' '}
        {statusLabel[job.status]}
      </p>
    </Link>
  )
}

function UpcomingDeliveryRow({ job }: { job: DashboardJob }) {
  const routeId = jobRouteId(job)

  return (
    <tr className="border-t border-border/70 transition-colors hover:bg-muted/30">
      <td className="px-6 py-3.5">
        <Link
          to="/dashboard/jobs/$id"
          params={{ id: routeId }}
          preload="intent"
          className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {jobTitle(job)}
          <span className="mt-1 block font-mono text-[11px] tabular-nums text-muted-foreground">
            {job.jobId}
          </span>
        </Link>
      </td>
      <td className="px-4 py-3.5 text-muted-foreground">
        {job.customerName ?? 'Cliente não informado'}
      </td>
      <td className="px-4 py-3.5">
        <span className="whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
          {statusLabel[job.status]}
        </span>
      </td>
      <td
        className={cn(
          'px-6 py-3.5 text-end text-xs font-medium tabular-nums',
          job.isOverdue ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {formatDueDate(job.dueDate, job.isOverdue)}
      </td>
    </tr>
  )
}

function OperationSummary({
  overdue,
  dueToday,
  review,
  dueNextSevenDays,
  isLoading,
}: {
  overdue: number
  dueToday: number
  review: number
  dueNextSevenDays: number
  isLoading: boolean
}) {
  const indicators = [
    { label: 'atrasadas', value: overdue, tone: 'text-destructive' },
    {
      label: 'até hoje',
      value: dueToday,
      tone: 'text-amber-700 dark:text-amber-400',
    },
    { label: 'em revisão', value: review, tone: 'text-primary' },
    {
      label: 'próximos 7 dias',
      value: dueNextSevenDays,
      tone: 'text-foreground',
    },
  ]

  return (
    <section className={`${surface} p-5`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Operação de hoje</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Contexto selecionado
          </p>
        </div>
        <HugeiconsIcon
          icon={Clock01Icon}
          className="size-5 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
      {isLoading ? (
        <div className="mt-5 grid grid-cols-2 gap-5">
          {['indicator-1', 'indicator-2', 'indicator-3', 'indicator-4'].map(
            (key) => (
              <Skeleton key={key} className="h-12 rounded-lg" />
            ),
          )}
        </div>
      ) : (
        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-5">
          {indicators.map((indicator) => (
            <div key={indicator.label}>
              <dt className="text-xs text-muted-foreground">
                {indicator.label}
              </dt>
              <dd
                className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${indicator.tone}`}
              >
                {indicator.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function TraceabilitySummary({
  standards,
  isLoading,
}: {
  standards: DashboardStats['standardsWatchlist']
  isLoading: boolean
}) {
  return (
    <section className={`${surface} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Rastreabilidade próxima</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Padrões que vencem em até 30 dias
          </p>
        </div>
        <HugeiconsIcon
          icon={RulerIcon}
          className="size-5 text-amber-700 dark:text-amber-400"
          aria-hidden="true"
        />
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-3">
          {traceabilitySkeletonKeys.map((key) => (
            <Skeleton key={key} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : standards.length > 0 ? (
        <div className="mt-4 space-y-2">
          {standards.slice(0, 2).map((standard) => (
            <Link
              key={standard.id}
              to="/dashboard/standards/$id"
              params={{ id: String(standard.id) }}
              preload="intent"
              className="block rounded-lg px-1 py-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <p className="text-sm font-medium">{standard.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {standard.serialNumber} ·{' '}
                {formatStandardDate(standard.nextCalibrationDate)}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Nenhum padrão ativo vence nos próximos 30 dias.
        </p>
      )}

      <SectionLink to="/dashboard/standards">Ver todos os padrões</SectionLink>
    </section>
  )
}

function SectionLink({
  to,
  children,
}: {
  to: '/dashboard/jobs' | '/dashboard/standards'
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 motion-safe:active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
      <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
    </Link>
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

function buildOperationalActions(
  data: DashboardStats | undefined,
  isManager: boolean,
): OperationalAction[] {
  if (!data) return []

  const actions: OperationalAction[] = []
  const addedJobIds = new Set<number>()
  const firstDueJob = data.dueSoonJobs[0]

  if (firstDueJob) {
    actions.push(jobAction(firstDueJob))
    addedJobIds.add(firstDueJob.id)
  }

  const reviewJob = data.reviewQueue.find((job) => !addedJobIds.has(job.id))
  if (reviewJob) {
    actions.push(jobAction(reviewJob, 'Sua revisão'))
    addedJobIds.add(reviewJob.id)
  }

  if (isManager && data.capasOverdue > 0) {
    actions.push({
      key: 'capas-overdue',
      kind: 'quality',
      label: 'Qualidade',
      title:
        data.capasOverdue === 1
          ? '1 CAPA está atrasada'
          : `${data.capasOverdue} CAPAs estão atrasadas`,
      context: 'Ações corretivas com prazo vencido',
      deadline: 'Prazo vencido',
      action: 'Tratar CAPAs',
      target: { type: 'capa' },
    })
  }

  if (isManager && data.nonConformancesAwaitingDisposition > 0) {
    actions.push({
      key: 'nc-awaiting-disposition',
      kind: 'quality',
      label: 'Qualidade',
      title:
        data.nonConformancesAwaitingDisposition === 1
          ? '1 NC aguarda disposição'
          : `${data.nonConformancesAwaitingDisposition} NCs aguardam disposição`,
      context: 'Decisão necessária para definir o impacto nos resultados',
      deadline: 'Ação pendente',
      action: 'Tratar não conformidades',
      target: { type: 'nc' },
    })
  }

  if (data.pendingCalibrationRequests > 0) {
    actions.push({
      key: 'pending-requests',
      kind: 'request',
      label: 'Triagem',
      title:
        data.pendingCalibrationRequests === 1
          ? '1 solicitação aguarda análise'
          : `${data.pendingCalibrationRequests} solicitações aguardam análise`,
      context: 'Recebidas pelo portal do cliente',
      deadline: 'Fila de entrada',
      action: 'Triar solicitações',
      target: { type: 'requests' },
    })
  }

  const firstStandard = data.standardsWatchlist[0]
  if (firstStandard) {
    actions.push({
      key: `standard-${firstStandard.id}`,
      kind: 'standard',
      label: 'Rastreabilidade',
      title: firstStandard.name,
      context: `${firstStandard.serialNumber} · certificado ${firstStandard.certificateNumber}`,
      deadline: formatStandardDate(firstStandard.nextCalibrationDate),
      action: 'Abrir padrão',
      target: { type: 'standard', id: String(firstStandard.id) },
    })
  }

  for (const job of data.dueSoonJobs) {
    if (addedJobIds.has(job.id)) continue
    actions.push(jobAction(job))
    addedJobIds.add(job.id)
  }

  return actions
}

function jobAction(job: DashboardJob, label?: string): OperationalAction {
  const isReview = job.status === 'REVIEW'
  const execute = job.status === 'IN_PROGRESS'

  return {
    key: `job-${job.id}`,
    kind: job.isOverdue ? 'overdue' : isReview ? 'review' : 'deadline',
    label:
      label ??
      (job.isOverdue
        ? 'Prazo vencido'
        : isReview
          ? 'Sua revisão'
          : 'Próxima entrega'),
    title: jobTitle(job),
    context: `${job.jobId} · ${job.customerName ?? 'Cliente não informado'} · ${statusLabel[job.status]}`,
    deadline: formatDueDate(job.dueDate, job.isOverdue),
    action: isReview
      ? 'Revisar calibração'
      : execute
        ? 'Continuar execução'
        : 'Abrir calibração',
    target: { type: 'job', id: jobRouteId(job), execute },
  }
}

function jobTitle(job: DashboardJob) {
  return job.assetName ?? job.serviceName ?? job.jobId
}

function formatCurrentDate() {
  const value = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatStandardDate(dateString: string | null) {
  if (!dateString) return 'Sem vencimento informado'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(dateString))
}

function formatDueDate(dateString: string | null, isOverdue?: boolean | null) {
  if (!dateString) return 'Sem prazo'

  const due = new Date(dateString)
  const today = new Date()
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  )
  const difference = Math.round(
    (startOfDue.getTime() - startOfToday.getTime()) / 86_400_000,
  )

  if (difference < 0 || isOverdue) {
    const days = Math.max(1, Math.abs(difference))
    return `Atrasada há ${days} ${days === 1 ? 'dia' : 'dias'}`
  }
  if (difference === 0) return 'Hoje'
  if (difference === 1) return 'Amanhã'
  return `Em ${difference} dias`
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
