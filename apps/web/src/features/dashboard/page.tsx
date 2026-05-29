import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowRight02Icon,
  Calendar03Icon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Notebook01Icon,
  PlusSignIcon,
  RefreshIcon,
  RulerIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'
import { useSession, useActiveOrganization } from '@calibra-facil/auth/client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import { cn } from '@/lib/utils'
import { jobRouteId } from '@/lib/route-identifiers'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { usePathPrewarmIntent } from '@/lib/use-route-prewarm-intent'
import {
  useDashboardIndexData,
  type DashboardJob,
  type DashboardJobStatus,
} from '@/features/dashboard/queries'
import { RecentJobsTable } from '@/features/dashboard/components/recent-jobs-table'

const DASHBOARD_INDEX_MOUNT_MARK = 'dashboard:index:mount'
const DASHBOARD_INDEX_DATA_READY_MARK = 'dashboard:index:data:ready'
const DASHBOARD_INDEX_FIRST_CONTENT_MARK = 'dashboard:index:first-content'

const PIPELINE: ReadonlyArray<{ status: DashboardJobStatus; label: string }> = [
  { status: 'DRAFT', label: 'Rascunho' },
  { status: 'IN_PROGRESS', label: 'Em execução' },
  { status: 'REVIEW', label: 'Em revisão' },
  { status: 'GENERATING_PDF', label: 'Emitindo PDF' },
  { status: 'APPROVED', label: 'Aprovadas' },
]

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

function getCurrentMemberRole(
  currentUserId: string | undefined,
  members:
    | ReadonlyArray<{ userId?: string; user?: { id?: string }; role?: string }>
    | undefined,
): string {
  const member = members?.find(
    (m) => m.userId === currentUserId || m.user?.id === currentUserId,
  )
  return typeof member?.role === 'string' ? member.role : 'member'
}

export function DashboardIndex() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()

  const role = getCurrentMemberRole(session?.user?.id, activeOrg?.members)
  const isManager = role === 'owner' || role === 'admin'

  const { data, isPending, isFetching, refetch, isRefetching } =
    useDashboardIndexData({
      activeOrganizationId,
      enabled: !isContextSwitching,
    })

  const isLoading = !data && (isPending || isFetching)

  const statusCounts = new Map(
    (data?.statusBreakdown ?? []).map((item) => [item.status, item.count]),
  )
  const reviewCount = statusCounts.get('REVIEW') ?? 0

  return (
    <div className="space-y-5 @container">
      <DashboardIndexMountMarker />
      {!isLoading ? (
        <>
          <DashboardIndexDataReadyMarker />
          <DashboardIndexFirstContentMarker />
        </>
      ) : null}

      {/* Command header */}
      <Panel className="relative overflow-hidden p-5 sm:p-6">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Operação · atualização automática
              </p>
            </div>
            <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Operação do laboratório
            </h1>
            <p className="mt-1 max-w-3xl text-pretty text-sm text-muted-foreground">
              O que precisa de ação agora: priorize o que vence, libere o que
              está em revisão e mantenha a rastreabilidade dos padrões.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="min-h-10 transition-transform active:scale-[0.96]"
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
              className="min-h-10 transition-transform active:scale-[0.96]"
              render={<Link to="/dashboard/requests" />}
            >
              <HugeiconsIcon icon={Notebook01Icon} className="size-4" />
              Solicitações
            </Button>
            <Button
              size="sm"
              className={`${ACTION_BUTTON_CLASS} min-h-10`}
              render={<Link to="/dashboard/jobs/new" />}
            >
              <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
              Nova calibração
            </Button>
          </div>
        </div>
      </Panel>

      {/* Operational vitals — act-now counts */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[...Array(5)].map((_, index) => (
            <Skeleton key={index} className="h-[5.5rem] rounded-xl" />
          ))}
        </div>
      ) : (
        <StaggerGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StaggerItem>
            <SignalTile
              icon={Alert02Icon}
              label="Em atraso"
              value={data?.overdueJobs ?? 0}
              tone={(data?.overdueJobs ?? 0) > 0 ? 'critical' : 'ok'}
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={Clock01Icon}
              label="Vencem hoje"
              value={data?.dueToday ?? 0}
              tone={(data?.dueToday ?? 0) > 0 ? 'critical' : 'neutral'}
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={Calendar03Icon}
              label="Próximos 7 dias"
              value={data?.dueNextSevenDays ?? 0}
              tone={(data?.dueNextSevenDays ?? 0) > 0 ? 'warning' : 'neutral'}
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={CheckmarkCircle01Icon}
              label="Em revisão"
              value={reviewCount}
              tone={reviewCount > 0 ? 'info' : 'neutral'}
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={RulerIcon}
              label="Padrões vencendo"
              value={data?.expiringStandards ?? 0}
              tone={(data?.expiringStandards ?? 0) > 0 ? 'warning' : 'ok'}
            />
          </StaggerItem>
        </StaggerGroup>
      )}

      {/* Calibration pipeline */}
      <Panel className="p-5">
        <PanelHeader
          eyebrow="Fluxo"
          title="Pipeline de calibração"
          description="Trabalho em cada etapa do fluxo, do rascunho à emissão do certificado."
          action={
            <Button
              variant="ghost"
              size="sm"
              className="min-h-10 transition-transform active:scale-[0.96]"
              render={<Link to="/dashboard/jobs" />}
            >
              Ver fila
              <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
            </Button>
          }
        />
        {isLoading ? (
          <div className="mt-4 flex gap-1.5">
            {[...Array(5)].map((_, index) => (
              <Skeleton key={index} className="h-20 flex-1 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="mt-4 flex items-stretch gap-1.5 overflow-x-auto pb-1">
            {PIPELINE.map((stage, index) => {
              const count = statusCounts.get(stage.status) ?? 0
              const isReview = stage.status === 'REVIEW'
              const highlight = isReview && count > 0
              return (
                <div
                  key={stage.status}
                  className="flex flex-1 items-center gap-1.5"
                >
                  <Link
                    to="/dashboard/jobs"
                    search={{ status: stage.status }}
                    className={cn(
                      'flex min-w-[7rem] flex-1 flex-col rounded-xl px-3.5 py-3 transition-[background-color,box-shadow,transform] active:scale-[0.98]',
                      highlight
                        ? 'bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]'
                        : 'bg-muted/40 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] hover:bg-muted/60 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]',
                    )}
                  >
                    <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {stage.label}
                    </span>
                    <span
                      className={cn(
                        'mt-1.5 font-mono text-2xl font-semibold leading-none tabular-nums',
                        highlight && 'text-primary',
                      )}
                    >
                      {count}
                    </span>
                    {highlight && (
                      <span className="mt-1 text-[11px] text-primary">
                        aguardando você
                      </span>
                    )}
                  </Link>
                  {index < PIPELINE.length - 1 && (
                    <span className="hidden shrink-0 self-center text-muted-foreground/40 sm:block">
                      <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      {/* Cross-domain attention centers — managers only */}
      {isManager && !isLoading && data && (
        <StaggerGroup className="grid gap-4 md:grid-cols-3">
          <StaggerItem>
            <AttentionPanel
              title="Qualidade"
              to="/dashboard/nc"
              rows={[
                {
                  label: 'NCs aguardando disposição',
                  value: data.nonConformancesAwaitingDisposition,
                  tone: 'critical',
                  to: '/dashboard/nc',
                  search: { status: 'open' },
                },
                {
                  label: 'NCs abertas',
                  value: data.openNonConformances,
                  tone: 'warning',
                  to: '/dashboard/nc',
                  search: { status: 'open' },
                },
                {
                  label: 'CAPAs atrasadas',
                  value: data.capasOverdue,
                  tone: 'critical',
                  to: '/dashboard/capa',
                },
                {
                  label: 'CAPAs abertas',
                  value: data.capasOpen,
                  tone: 'info',
                  to: '/dashboard/capa',
                  search: { status: 'OPEN' },
                },
              ]}
            />
          </StaggerItem>
          <StaggerItem>
            <AttentionPanel
              title="Atendimento"
              to="/dashboard/requests"
              rows={[
                {
                  label: 'Solicitações p/ triagem',
                  value: data.pendingCalibrationRequests,
                  tone: 'warning',
                  to: '/dashboard/requests',
                  search: { status: 'PENDING' },
                },
                {
                  label: 'Ordens de serviço em andamento',
                  value: data.serviceOrdersInProgress,
                  tone: 'info',
                  to: '/dashboard/service-orders',
                },
              ]}
            />
          </StaggerItem>
          <StaggerItem>
            <AttentionPanel
              title="Pessoal"
              to="/dashboard/personnel"
              rows={[
                {
                  label: 'Competências aguardando avaliação',
                  value: data.competencesPendingEvaluation,
                  tone: 'warning',
                  to: '/dashboard/personnel',
                  search: { status: 'PENDING_EVALUATION' },
                },
                {
                  label: 'Competências vencendo (30d)',
                  value: data.competencesExpiring,
                  tone: 'critical',
                  to: '/dashboard/personnel',
                },
              ]}
            />
          </StaggerItem>
        </StaggerGroup>
      )}

      {/* Due agenda + traceability watch */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
        <Panel className="p-5">
          <PanelHeader
            eyebrow="Despache"
            title="Vencendo em 7 dias"
            description="Calibrações abertas a priorizar, incluindo atrasadas."
          />
          <div className="mt-4">
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : data?.dueSoonJobs.length ? (
              <div className="space-y-2">
                {data.dueSoonJobs.map((job) => (
                  <DueJobRow key={job.id} job={job} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={CheckmarkCircle01Icon}
                title="Nada vencendo agora"
                description="Nenhuma calibração aberta vence nos próximos 7 dias."
              />
            )}
          </div>
        </Panel>

        <Panel className="p-5">
          <PanelHeader
            eyebrow="Rastreabilidade"
            title="Padrões em atenção"
            description="Vencendo nos próximos 30 dias."
          />
          <div className="mt-4">
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
                    <span className="text-right text-xs tabular-nums text-muted-foreground">
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
          </div>
        </Panel>
      </div>

      {/* Review queue */}
      <Panel className="p-5">
        <PanelHeader
          eyebrow="Liberação"
          title="Revisões para liberar"
          description="Certificados prontos para análise técnica ou de qualidade."
          action={
            <Badge variant={reviewCount > 0 ? 'default' : 'outline'}>
              <span className="tabular-nums">{reviewCount}</span> em revisão
            </Badge>
          }
        />
        <div className="mt-4">
          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[...Array(4)].map((_, index) => (
                <Skeleton key={index} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : data?.reviewQueue.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {data.reviewQueue.map((job) => (
                <ReviewJobCard key={job.id} job={job} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CheckmarkCircle01Icon}
              title="Nada aguardando revisão"
              description="A fila de revisão está limpa para o contexto selecionado."
            />
          )}
        </div>
      </Panel>

      {/* Live activity */}
      <RecentJobsTable jobs={data?.recentJobs ?? []} isLoading={isLoading} />
    </div>
  )
}

type AttentionRow = {
  label: string
  value: number
  tone: SignalTone
  to: string
  search?: Record<string, string>
}

const TONE_VALUE_CLASS: Record<SignalTone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  critical: 'text-destructive',
  warning: 'text-amber-700 dark:text-amber-400',
  info: 'text-primary',
  neutral: 'text-muted-foreground',
}

const TONE_DOT_CLASS: Record<SignalTone, string> = {
  ok: 'bg-emerald-500',
  critical: 'bg-destructive',
  warning: 'bg-amber-500',
  info: 'bg-primary',
  neutral: 'bg-muted-foreground/40',
}

function AttentionPanel({
  title,
  to,
  rows,
}: {
  title: string
  to: string
  rows: AttentionRow[]
}) {
  return (
    <Panel className="flex h-full flex-col p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Link
          to={to}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Abrir
        </Link>
      </div>
      <div className="mt-3 space-y-1.5">
        {rows.map((row) => {
          const tone: SignalTone = row.value > 0 ? row.tone : 'neutral'
          return (
            <Link
              key={row.label}
              to={row.to}
              search={row.search}
              className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    TONE_DOT_CLASS[tone],
                  )}
                />
                <span className="truncate text-sm">{row.label}</span>
              </span>
              <span
                className={cn(
                  'font-mono text-sm font-semibold tabular-nums',
                  TONE_VALUE_CLASS[tone],
                )}
              >
                {row.value}
              </span>
            </Link>
          )
        })}
      </div>
    </Panel>
  )
}

function DueJobRow({ job }: { job: DashboardJob }) {
  const routeId = jobRouteId(job)
  const prewarmIntentHandlers = usePathPrewarmIntent(
    `/dashboard/jobs/${encodeURIComponent(routeId)}`,
  )

  return (
    <Link
      to="/dashboard/jobs/$id"
      params={{ id: routeId }}
      className="group flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)] transition-colors hover:bg-muted/60 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
      preload="intent"
      {...prewarmIntentHandlers}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          job.isOverdue
            ? 'bg-destructive/10 text-destructive'
            : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
        )}
      >
        <HugeiconsIcon
          icon={job.isOverdue ? Alert02Icon : Clock01Icon}
          className="size-4"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold tabular-nums">
            {job.jobId}
          </span>
          {job.isOverdue && <Badge variant="destructive">Atrasada</Badge>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {job.customerName ?? 'Cliente não informado'} ·{' '}
          {job.assetName ?? job.serviceName ?? 'Ativo não informado'}
        </span>
      </span>
      <span className="text-right text-xs tabular-nums text-muted-foreground">
        {formatDueDate(job.dueDate)}
      </span>
    </Link>
  )
}

function ReviewJobCard({ job }: { job: DashboardJob }) {
  const routeId = jobRouteId(job)
  const prewarmIntentHandlers = usePathPrewarmIntent(
    `/dashboard/jobs/${encodeURIComponent(routeId)}`,
  )

  return (
    <Link
      to="/dashboard/jobs/$id"
      params={{ id: routeId }}
      className="group min-h-28 rounded-xl p-3 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] transition-colors hover:bg-muted/60 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
      preload="intent"
      {...prewarmIntentHandlers}
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
        <span className="truncate">{job.technicianName ?? 'Sem técnico'}</span>
      </div>
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

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR')
}

function formatDueDate(dateString: string | null): string {
  if (!dateString) return '—'
  const due = new Date(dateString)
  const today = new Date()
  const startOfDue = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate(),
  )
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  )
  const diffDays = Math.round(
    (startOfDue.getTime() - startOfToday.getTime()) / 86_400_000,
  )
  if (diffDays === 0) return 'hoje'
  if (diffDays < 0) return `${Math.abs(diffDays)}d atrás`
  if (diffDays === 1) return 'amanhã'
  return `em ${diffDays}d`
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
