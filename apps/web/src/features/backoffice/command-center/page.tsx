import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Activity03Icon,
  Alert02Icon,
  AlertDiamondIcon,
  ArrowRight02Icon,
   ArrowUp01Icon,
  CheckmarkCircle01Icon,
  DatabaseSync01Icon,
  Hold05Icon,
  InboxIcon,
  PlusSignIcon,
  RefreshIcon,
  Rocket01Icon,
  TimeHalfPassIcon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import { cn } from '@/lib/utils'
import {
  AttentionRow,
  ConsoleEmpty,
  ConsolePageHeader,
  HealthDot,
  MetricStat,
  SectionPanel,
  StatusChip,
  status,
} from '@/features/backoffice/console'
import {
  useCustomerSuccessOrganizations,
  useRefreshCustomerSuccess,
  useSupportQueue,
} from '@/features/backoffice/customer-success/hooks'
import {
  formatRelativeSla,
  type HealthStatus,
  type OrganizationQueueItem,
  type SupportRequest,
} from '@/features/backoffice/customer-success/model'
import {
  computePlatformVitals,
  migrationPipeline,
  onboardingPipeline,
  topAttentionAccounts,
  topAttentionTickets,
  type PipelineBucket,
} from './metrics'

const HEALTH_ORDER: ReadonlyArray<HealthStatus> = [
  'CRITICAL',
  'ATTENTION',
  'HEALTHY',
]

const HEALTH_BAR_TONE: Record<HealthStatus, string> = {
  CRITICAL: 'bg-destructive',
  ATTENTION: 'bg-amber-500',
  HEALTHY: 'bg-emerald-500',
}

export function BackofficeCommandCenter() {
  const accountsQuery = useCustomerSuccessOrganizations()
  const ticketsQuery = useSupportQueue()
  const refresh = useRefreshCustomerSuccess()

  const accounts = useMemo(
    () => accountsQuery.data?.data ?? [],
    [accountsQuery.data?.data],
  )
  const tickets = useMemo(
    () => ticketsQuery.data?.data ?? [],
    [ticketsQuery.data?.data],
  )
  const isLoading = accountsQuery.isPending || ticketsQuery.isPending
  const isFetching = accountsQuery.isFetching || ticketsQuery.isFetching

  const vitals = useMemo(
    () => computePlatformVitals(accounts, tickets),
    [accounts, tickets],
  )
  const onboarding = useMemo(() => onboardingPipeline(accounts), [accounts])
  const migration = useMemo(() => migrationPipeline(accounts), [accounts])
  const riskAccounts = useMemo(() => topAttentionAccounts(accounts), [accounts])
  const riskTickets = useMemo(() => topAttentionTickets(tickets), [tickets])

  return (
    <div className="space-y-5 @container">
      <ConsolePageHeader
        live
        liveLabel="Centro de operações · tempo real"
        title="Comando da plataforma"
        description="O que precisa de você agora: contas em risco, SLA estourado e trabalho sem dono — priorizado pelo score operacional."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh()}
              disabled={isFetching}
              className="min-h-10 transition-transform active:scale-[0.96]"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                className={cn('size-4', isFetching && 'animate-spin')}
              />
              Atualizar
            </Button>
            <Button
              size="sm"
              className="min-h-10 transition-transform active:scale-[0.96]"
              render={
                <Link to="/backoffice/accounts" search={{ new: 'lab' }} />
              }
            >
              <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
              Provisionar LAB
            </Button>
          </>
        }
      />

      {/* Act-now vitals */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[5.5rem] rounded-xl" />
          ))}
        </div>
      ) : (
        <StaggerGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StaggerItem>
            <MetricStat
              icon={AlertDiamondIcon}
              label="Contas críticas"
              value={vitals.healthCounts.CRITICAL}
              tone={vitals.healthCounts.CRITICAL > 0 ? 'critical' : 'ok'}
              to="/backoffice/accounts"
              search={{ filter: 'critical' }}
            />
          </StaggerItem>
          <StaggerItem>
            <MetricStat
              icon={Alert02Icon}
              label="Precisam de atenção"
              value={vitals.accountsNeedingAttention}
              tone={vitals.accountsNeedingAttention > 0 ? 'warning' : 'ok'}
              to="/backoffice/accounts"
              search={{ filter: 'attention' }}
            />
          </StaggerItem>
          <StaggerItem>
            <MetricStat
              icon={TimeHalfPassIcon}
              label="SLA estourado"
              value={vitals.breachedTickets}
              tone={vitals.breachedTickets > 0 ? 'critical' : 'ok'}
              to="/backoffice/support"
              search={{ filter: 'breached' }}
            />
          </StaggerItem>
          <StaggerItem>
            <MetricStat
              icon={ArrowUp01Icon}
              label="Escalações"
              value={vitals.escalationTickets}
              tone={vitals.escalationTickets > 0 ? 'critical' : 'neutral'}
              to="/backoffice/support"
              search={{ filter: 'escalation' }}
            />
          </StaggerItem>
          <StaggerItem>
            <MetricStat
              icon={InboxIcon}
              label="Sem atribuição"
              value={vitals.unassignedTickets}
              tone={vitals.unassignedTickets > 0 ? 'warning' : 'neutral'}
              to="/backoffice/support"
              search={{ filter: 'unassigned' }}
            />
          </StaggerItem>
          <StaggerItem>
            <MetricStat
              icon={UserRemove01Icon}
              label="Sem owner"
              value={vitals.missingOwners}
              tone={vitals.missingOwners > 0 ? 'warning' : 'ok'}
              to="/backoffice/accounts"
              search={{ filter: 'unassigned' }}
            />
          </StaggerItem>
        </StaggerGroup>
      )}

      {/* Portfolio health + support load */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <SectionPanel
          eyebrow="Carteira"
          title="Saúde das contas"
          description="Distribuição da carteira por estado operacional."
          action={
            <Button
              variant="ghost"
              size="sm"
              className="min-h-10 transition-transform active:scale-[0.96]"
              render={<Link to="/backoffice/accounts" />}
            >
              Ver contas
              <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
            </Button>
          }
        >
          {isLoading ? (
            <Skeleton className="h-28 w-full rounded-xl" />
          ) : vitals.totalAccounts === 0 ? (
            <ConsoleEmpty
              icon={Activity03Icon}
              title="Nenhuma conta ainda"
              description="Provisione o primeiro laboratório para começar a operar."
            />
          ) : (
            <HealthDistribution vitals={vitals} />
          )}
        </SectionPanel>

        <SectionPanel
          eyebrow="Atendimento"
          title="Carga de suporte"
          description="Fila priorizada da operação."
          action={
            <Button
              variant="ghost"
              size="sm"
              className="min-h-10 transition-transform active:scale-[0.96]"
              render={<Link to="/backoffice/support" />}
            >
              Abrir fila
              <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
            </Button>
          }
        >
          {isLoading ? (
            <Skeleton className="h-28 w-full rounded-xl" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SupportStat label="Em aberto" value={vitals.openTickets} tone="info" />
              <SupportStat
                label="SLA estourado"
                value={vitals.breachedTickets}
                tone={vitals.breachedTickets > 0 ? 'critical' : 'ok'}
              />
              <SupportStat
                label="SLA vencendo"
                value={vitals.dueSoonTickets}
                tone={vitals.dueSoonTickets > 0 ? 'warning' : 'neutral'}
              />
              <SupportStat
                label="Sem dono"
                value={vitals.unassignedTickets}
                tone={vitals.unassignedTickets > 0 ? 'warning' : 'neutral'}
              />
            </div>
          )}
        </SectionPanel>
      </div>

      {/* Lifecycle pipelines */}
      <SectionPanel
        eyebrow="Ciclo de vida"
        title="Onboarding & migração"
        description="Trabalho de implantação distribuído por etapa."
      >
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <PipelineStrip
              icon={Rocket01Icon}
              title="Onboarding"
              buckets={onboarding}
              tone="info"
            />
            <PipelineStrip
              icon={DatabaseSync01Icon}
              title="Migração"
              buckets={migration}
              tone="info"
            />
          </div>
        )}
      </SectionPanel>

      {/* Attention feed */}
      <div className="grid gap-5 xl:grid-cols-2">
        <SectionPanel
          eyebrow="Risco"
          title="Contas que precisam de você"
          description="Ranqueadas pelo score de atenção."
        >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : riskAccounts.length ? (
            <div className="space-y-2">
              {riskAccounts.map((account) => (
                <RiskAccountRow key={account.id} account={account} />
              ))}
            </div>
          ) : (
            <ConsoleEmpty
              icon={CheckmarkCircle01Icon}
              title="Carteira sob controle"
              description="Nenhuma conta com sinal de risco no momento."
            />
          )}
        </SectionPanel>

        <SectionPanel
          eyebrow="Fila"
          title="Suporte prioritário"
          description="Tickets ranqueados por SLA e urgência."
        >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : riskTickets.length ? (
            <div className="space-y-2">
              {riskTickets.map((ticket) => (
                <RiskTicketRow key={ticket.id} ticket={ticket} />
              ))}
            </div>
          ) : (
            <ConsoleEmpty
              icon={CheckmarkCircle01Icon}
              title="Fila limpa"
              description="Nenhum ticket aguardando triagem."
            />
          )}
        </SectionPanel>
      </div>
    </div>
  )
}

function HealthDistribution({
  vitals,
}: {
  vitals: ReturnType<typeof computePlatformVitals>
}) {
  const total = vitals.totalAccounts || 1
  return (
    <div className="space-y-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {HEALTH_ORDER.map((health) => {
          const count = vitals.healthCounts[health]
          if (count === 0) return null
          return (
            <div
              key={health}
              className={cn('h-full', HEALTH_BAR_TONE[health])}
              style={{ width: `${(count / total) * 100}%` }}
            />
          )
        })}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {HEALTH_ORDER.map((health) => {
          const descriptor = status.healthStatus(health)
          return (
            <Link
              key={health}
              to="/backoffice/accounts"
              search={{
                filter: health === 'CRITICAL' ? 'critical' : 'attention',
              }}
              className="rounded-xl p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] transition-colors hover:bg-muted/50 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
            >
              <span className="flex items-center gap-2">
                <HealthDot tone={descriptor.tone} />
                <span className="text-xs text-muted-foreground">
                  {descriptor.label}
                </span>
              </span>
              <span className="mt-1.5 block font-mono text-2xl font-semibold leading-none tabular-nums">
                {vitals.healthCounts[health]}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function SupportStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: SignalTone
}) {
  return (
    <div className="rounded-xl bg-muted/40 p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <span className="flex items-center gap-1.5">
        <HealthDot tone={tone} />
        <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </span>
      </span>
      <span className="mt-1.5 block font-mono text-xl font-semibold tabular-nums">
        {value}
      </span>
    </div>
  )
}

function PipelineStrip({
  icon,
  title,
  buckets,
  tone,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]['icon']
  title: string
  buckets: ReadonlyArray<PipelineBucket<string>>
  tone: SignalTone
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <HugeiconsIcon icon={icon} className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {buckets.map((bucket) => (
          <div
            key={bucket.status}
            className="min-w-[5.5rem] flex-1 rounded-xl bg-muted/40 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
          >
            <span className="block truncate text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {bucket.label}
            </span>
            <span
              className={cn(
                'mt-1 block font-mono text-lg font-semibold tabular-nums',
                bucket.count > 0 && bucket.status === 'BLOCKED' && 'text-destructive',
                bucket.count > 0 &&
                  bucket.status !== 'BLOCKED' &&
                  tone === 'info' &&
                  'text-primary',
              )}
            >
              {bucket.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RiskAccountRow({ account }: { account: OrganizationQueueItem }) {
  const summary = account.operationalSummary
  const health = status.healthStatus(summary.healthStatus)
  const signals: Array<string> = []
  if (summary.breachedRequestsCount > 0) {
    signals.push(`${summary.breachedRequestsCount} SLA estourado`)
  }
  if (summary.activeBlockersCount > 0) {
    signals.push(`${summary.activeBlockersCount} bloqueio(s)`)
  }
  if (summary.nextActionOverdue) signals.push('próx. ação atrasada')
  if (!summary.hasInternalOwner && summary.workflow.hasActiveWorkflows) {
    signals.push('sem owner')
  }
  if (signals.length === 0 && summary.openRequestsCount > 0) {
    signals.push(`${summary.openRequestsCount} solicitação(ões) aberta(s)`)
  }

  return (
    <AttentionRow
      render={
        <Link to="/backoffice/accounts/$id" params={{ id: account.id }} />
      }
      tone={health.tone}
      icon={summary.healthStatus === 'CRITICAL' ? AlertDiamondIcon : Alert02Icon}
      title={
        <>
          <span className="truncate">{account.name}</span>
          <StatusChip status={health} />
        </>
      }
      subtitle={signals.join(' · ') || account.slug}
      meta={
        <span className="font-mono font-semibold text-foreground">
          {summary.attentionScore}
        </span>
      }
    />
  )
}

function RiskTicketRow({ ticket }: { ticket: SupportRequest }) {
  const sla = status.supportSlaStatus(ticket.slaStatus)
  const priority = status.supportPriority(ticket.priority)
  const orgId = ticket.organization?.id

  const content = (
    <>
      <span className="truncate">{ticket.subject}</span>
      <StatusChip status={priority} />
    </>
  )
  const subtitle = `${ticket.organization?.name ?? 'Conta desconhecida'} · ${formatRelativeSla(ticket.timeToSlaMs)}`

  if (orgId) {
    return (
      <AttentionRow
        render={<Link to="/backoffice/accounts/$id" params={{ id: orgId }} />}
        tone={sla.tone}
        icon={ticket.slaStatus === 'BREACHED' ? TimeHalfPassIcon : Hold05Icon}
        title={content}
        subtitle={subtitle}
        meta={<StatusChip status={sla} />}
      />
    )
  }

  return (
    <AttentionRow
      tone={sla.tone}
      icon={ticket.slaStatus === 'BREACHED' ? TimeHalfPassIcon : Hold05Icon}
      title={content}
      subtitle={subtitle}
      meta={<StatusChip status={sla} />}
    />
  )
}
