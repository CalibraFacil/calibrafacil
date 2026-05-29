import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowRight02Icon,
  Building02Icon,
  PlusSignIcon,
  RefreshIcon,
  UserCheck01Icon,
} from '@hugeicons/core-free-icons'
import { useBackofficeSession } from '@calibra-facil/auth/client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  ConsoleEmpty,
  ConsolePageHeader,
  ConsoleSearch,
  HealthDot,
  PreviewSheet,
  SectionPanel,
  SegmentedFilter,
  StatusChip,
  status,
  type SegmentedOption,
} from '@/features/backoffice/console'
import {
  useCustomerSuccessOrganizations,
  useRefreshCustomerSuccess,
  useTakeOwnership,
  useUpdateAccountHealth,
} from '@/features/backoffice/customer-success/hooks'
import {
  type HealthStatus,
  type OrganizationFilter,
  type OrganizationQueueItem,
} from '@/features/backoffice/customer-success/model'
import { ProvisionDrawer } from './provision-drawer'
import {
  ACCOUNT_VIEWS,
  accountViewCounts,
  filterAccounts,
} from './selectors'

const VIEW_TONE: Partial<Record<OrganizationFilter, SegmentedOption<OrganizationFilter>['tone']>> =
  {
    critical: 'critical',
    attention: 'warning',
    escalation: 'critical',
    overdue: 'warning',
    unassigned: 'warning',
  }

const HEALTH_VALUES: ReadonlyArray<HealthStatus> = [
  'HEALTHY',
  'ATTENTION',
  'CRITICAL',
]

export function AccountsDirectoryPage({
  filter,
  provisionOpen,
}: {
  filter: OrganizationFilter
  provisionOpen: boolean
}) {
  const navigate = useNavigate()
  const accountsQuery = useCustomerSuccessOrganizations()
  const refresh = useRefreshCustomerSuccess()
  const [query, setQuery] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)

  const accounts = useMemo(
    () => accountsQuery.data?.data ?? [],
    [accountsQuery.data?.data],
  )
  const counts = useMemo(() => accountViewCounts(accounts), [accounts])
  const filtered = useMemo(
    () => filterAccounts(accounts, filter, query),
    [accounts, filter, query],
  )
  const previewAccount = useMemo(
    () => accounts.find((account) => account.id === previewId) ?? null,
    [accounts, previewId],
  )

  const viewOptions: Array<SegmentedOption<OrganizationFilter>> =
    ACCOUNT_VIEWS.map((view) => ({
      value: view.value,
      label: view.label,
      count: counts[view.value],
      tone: VIEW_TONE[view.value],
    }))

  const setFilter = (value: OrganizationFilter) => {
    navigate({ to: '/backoffice/accounts', search: { filter: value } })
  }

  const ownerless = filtered.filter(
    (account) => account.workflow.accountOwnershipStatus !== 'ASSIGNED',
  ).length
  const overdue = filtered.filter(
    (account) => account.operationalSummary.nextActionStatus === 'OVERDUE',
  ).length

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        eyebrow="Operação de contas"
        title="Contas"
        description="Diretório operacional unificado: saúde, ciclo de vida, suporte e cobrança de cada laboratório — em um só lugar."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh()}
              disabled={accountsQuery.isFetching}
              className="min-h-10 transition-transform active:scale-[0.96]"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                className={cn(
                  'size-4',
                  accountsQuery.isFetching && 'animate-spin',
                )}
              />
              Atualizar
            </Button>
            <Button
              size="sm"
              className="min-h-10 transition-transform active:scale-[0.96]"
              onClick={() =>
                navigate({
                  to: '/backoffice/accounts',
                  search: { filter, new: 'lab' },
                })
              }
            >
              <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
              Provisionar LAB
            </Button>
          </>
        }
      />

      <SectionPanel
        eyebrow="Carteira"
        title="Diretório"
        description={
          accountsQuery.isPending
            ? undefined
            : `${filtered.length} conta(s) · ${ownerless} sem owner · ${overdue} com ação atrasada`
        }
        contentClassName="space-y-4"
      >
        <ConsoleSearch
          value={query}
          onChange={setQuery}
          placeholder="Buscar por nome, slug, owner ou e-mail…"
        />
        <SegmentedFilter
          options={viewOptions}
          value={filter}
          onChange={setFilter}
        />

        {accountsQuery.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <ConsoleEmpty
            icon={Building02Icon}
            title="Nenhuma conta neste recorte"
            description="Ajuste a busca ou a visão salva para ver outras contas."
          />
        ) : (
          <div className="overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <div className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_auto_auto] gap-3 border-b bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground md:grid">
              <span>Conta</span>
              <span>Owner interno</span>
              <span>Ciclo de vida</span>
              <span className="text-right">Suporte</span>
              <span className="text-right">Score</span>
            </div>
            <div className="divide-y">
              {filtered.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  onPreview={() => setPreviewId(account.id)}
                />
              ))}
            </div>
          </div>
        )}
      </SectionPanel>

      <AccountPreview
        account={previewAccount}
        onClose={() => setPreviewId(null)}
      />

      <ProvisionDrawer
        open={provisionOpen}
        onClose={() =>
          navigate({ to: '/backoffice/accounts', search: { filter } })
        }
      />
    </div>
  )
}

function AccountRow({
  account,
  onPreview,
}: {
  account: OrganizationQueueItem
  onPreview: () => void
}) {
  const summary = account.operationalSummary
  const health = status.healthStatus(summary.healthStatus)
  const onboarding = status.onboardingStatus(account.profile.onboardingStatus)
  const migration = status.migrationStatus(account.profile.migrationStatus)
  const nextAction = status.nextActionStatus(summary.nextActionStatus)
  const showMigration = account.profile.migrationStatus !== 'NOT_REQUIRED'

  return (
    <button
      type="button"
      onClick={onPreview}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_auto_auto]"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <HealthDot tone={health.tone} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {account.name}
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {account.slug}
          </span>
        </span>
      </span>

      <span className="hidden min-w-0 md:block">
        {account.internalOwnerUser ? (
          <span className="truncate text-sm text-muted-foreground">
            {account.internalOwnerUser.name}
          </span>
        ) : (
          <StatusChip tone="warning">Sem owner</StatusChip>
        )}
      </span>

      <span className="hidden flex-wrap items-center gap-1.5 md:flex">
        <StatusChip status={onboarding} />
        {showMigration ? <StatusChip status={migration} /> : null}
      </span>

      <span className="hidden items-center justify-end gap-2 md:flex">
        {summary.breachedRequestsCount > 0 ? (
          <StatusChip tone="critical">
            {summary.breachedRequestsCount} SLA
          </StatusChip>
        ) : summary.openRequestsCount > 0 ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {summary.openRequestsCount} abertos
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </span>

      <span className="flex items-center justify-end gap-2">
        {summary.nextActionStatus === 'OVERDUE' ? (
          <StatusChip status={nextAction} />
        ) : null}
        <span
          className={cn(
            'font-mono text-sm font-semibold tabular-nums',
            summary.attentionScore > 0
              ? 'text-foreground'
              : 'text-muted-foreground',
          )}
        >
          {summary.attentionScore}
        </span>
        <HugeiconsIcon
          icon={ArrowRight02Icon}
          className="size-4 text-muted-foreground/40"
        />
      </span>
    </button>
  )
}

function AccountPreview({
  account,
  onClose,
}: {
  account: OrganizationQueueItem | null
  onClose: () => void
}) {
  const session = useBackofficeSession()
  const userId = session.data?.user?.id
  const updateHealth = useUpdateAccountHealth()
  const takeOwnership = useTakeOwnership(account?.id ?? '', userId)

  const summary = account?.operationalSummary
  const health = summary ? status.healthStatus(summary.healthStatus) : null

  return (
    <PreviewSheet
      open={Boolean(account)}
      onOpenChange={(next) => (next ? undefined : onClose())}
      eyebrow="Conta"
      title={account?.name ?? ''}
      description={account?.slug}
      actions={
        account ? (
          <>
            <Button
              size="sm"
              className="min-h-9 transition-transform active:scale-[0.96]"
              render={
                <Link
                  to="/backoffice/accounts/$id"
                  params={{ id: account.id }}
                />
              }
            >
              Abrir conta
              <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" />
            </Button>
            {account.workflow.accountOwnershipStatus !== 'ASSIGNED' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={takeOwnership.isPending || !userId}
                onClick={() => takeOwnership.mutate()}
                className="min-h-9 transition-transform active:scale-[0.96]"
              >
                <HugeiconsIcon icon={UserCheck01Icon} className="size-4" />
                Assumir conta
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {account && summary && health ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={health} dot />
            <StatusChip status={status.slaTier(summary.effectiveSlaTier)} />
            {summary.prioritySupport ? (
              <StatusChip tone="info">Priority support</StatusChip>
            ) : null}
            <StatusChip tone="neutral">{account.plan.name}</StatusChip>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <PreviewFact
              label="Onboarding"
              value={
                <StatusChip
                  status={status.onboardingStatus(
                    account.profile.onboardingStatus,
                  )}
                />
              }
            />
            <PreviewFact
              label="Migração"
              value={
                <StatusChip
                  status={status.migrationStatus(
                    account.profile.migrationStatus,
                  )}
                />
              }
            />
            <PreviewFact
              label="Go-live"
              value={
                <StatusChip
                  status={status.goLiveStatus(account.profile.goLiveStatus)}
                />
              }
            />
            <PreviewFact
              label="Próxima ação"
              value={
                <StatusChip
                  status={status.nextActionStatus(summary.nextActionStatus)}
                />
              }
            />
            <PreviewFact
              label="Solicitações abertas"
              value={
                <span className="font-mono tabular-nums">
                  {summary.openRequestsCount}
                </span>
              }
            />
            <PreviewFact
              label="SLA estourado"
              value={
                <span
                  className={cn(
                    'font-mono tabular-nums',
                    summary.breachedRequestsCount > 0 && 'text-destructive',
                  )}
                >
                  {summary.breachedRequestsCount}
                </span>
              }
            />
            <PreviewFact
              label="Owner interno"
              value={account.internalOwnerUser?.name ?? 'Sem owner'}
            />
            <PreviewFact
              label="Bloqueios ativos"
              value={
                <span
                  className={cn(
                    'font-mono tabular-nums',
                    summary.activeBlockersCount > 0 && 'text-amber-600',
                  )}
                >
                  {summary.activeBlockersCount}
                </span>
              }
            />
          </div>

          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Definir saúde
            </p>
            <div className="flex gap-2">
              {HEALTH_VALUES.map((value) => {
                const descriptor = status.healthStatus(value)
                const active = summary.healthStatus === value
                return (
                    <Button
                      key={value}
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      disabled={updateHealth.isPending}
                      onClick={() =>
                        updateHealth.mutate({
                          organizationId: account.id,
                          healthStatus: value,
                        })
                      }
                      className="min-h-9 flex-1 transition-transform active:scale-[0.96]"
                    >
                      {!active ? <HealthDot tone={descriptor.tone} /> : null}
                      {descriptor.label}
                    </Button>
                  )
                },
              )}
            </div>
          </div>

          {summary.needsAttention ? (
            <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <HugeiconsIcon
                icon={Alert02Icon}
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                Esta conta está sinalizada para atenção. Abra a conta para tratar
                próximos passos, bloqueios e tickets.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </PreviewSheet>
  )
}

function PreviewFact({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  )
}
