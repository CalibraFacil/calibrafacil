import { Link, useNavigate } from '@tanstack/react-router'

import {
  DollarCircleIcon,
  Invoice01Icon,
  UserAccountIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { formatMoney } from '@calibra-facil/shared'
import type {
  CustomerFinancialTimelineDocument,
  CustomerFinancialTimeline,
  FinancialFreshness,
} from '@calibra-facil/shared'
import {
  useCustomerDetailData,
  useCustomerFinancialTimelineData,
} from '@/features/customers/queries'
import type { CustomerDetail } from '@/features/customers/types'
import {
  customerFinancialTimelineRow,
  customerTimelineFreshnessLabel,
} from '@/features/customers/financial-timeline-model'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { clientRouteId } from '@/lib/route-identifiers'
import {
  ClientMetric,
  ClientMetricStrip,
  ClientPanel,
  ClientPanelBody,
} from '@/features/customers/components/client-detail-ui'
import { CustomerEditForm } from '@/features/customers/components/customer-edit-form'
import {
  shouldReturnToSyncConflicts,
  SyncConflictReturnNotice,
  type SyncConflictReturnSearch,
} from '@/runtime/sync-conflict-return'
import { usePlanAccess } from '@/hooks/use-plan-access'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { useCustomerGroupsList } from '@/features/customer-groups/queries'

export function ClientInfoTab({
  id,
  conflictReturn,
}: {
  id: string
  conflictReturn: SyncConflictReturnSearch
}) {
  const { data: customer, isLoading } = useCustomerDetailData(id)

  if (isLoading) {
    return <InfoSkeleton />
  }

  if (!customer) {
    return (
      <div className="rounded-2xl bg-card px-6 py-10 text-center text-sm text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05),0_18px_45px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 dark:shadow-none">
        Cliente não encontrado
      </div>
    )
  }

  return (
    <ClientInfoForm
      key={customer.id}
      customer={customer}
      customerId={id}
      conflictReturn={conflictReturn}
    />
  )
}

export function CustomerFinancialTimelineBlock({
  documents,
  summary,
  freshness,
  loading,
  error,
  onRetry,
}: {
  documents: CustomerFinancialTimelineDocument[]
  summary: CustomerFinancialTimeline['summary'] | null
  freshness: FinancialFreshness | null
  loading: boolean
  error: Error | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <ClientPanelBody>
        <div
          aria-live="polite"
          className="border-b border-border/70 py-5 text-sm text-muted-foreground"
        >
          Carregando linha do tempo financeira...
        </div>
      </ClientPanelBody>
    )
  }

  if (error) {
    return (
      <ClientPanelBody>
        <div
          aria-live="polite"
          className="flex flex-col gap-3 border-b border-border/70 py-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
        >
          <span>Linha do tempo financeira indisponível no momento.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        </div>
      </ClientPanelBody>
    )
  }

  return (
    <ClientPanelBody>
      <section className="border-b border-border/70 py-6">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/10"
          >
            <HugeiconsIcon icon={Invoice01Icon} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">Linha do tempo financeira</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {customerTimelineFreshnessLabel(freshness)}
            </p>
            {documents.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhum documento financeiro registrado para este cliente.
              </p>
            ) : (
              <>
                {summary ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
                      <p className="text-xs text-muted-foreground">
                        Documentos
                      </p>
                      <p className="mt-1 text-sm font-medium tabular-nums">
                        {summary.totalDocuments === summary.documents
                          ? summary.documents
                          : `${summary.documents} de ${summary.totalDocuments}`}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
                      <p className="text-xs text-muted-foreground">Em aberto</p>
                      <p className="mt-1 text-sm font-medium tabular-nums">
                        {formatMoney(summary.openCents)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
                      <p className="text-xs text-muted-foreground">Vencido</p>
                      <p
                        className={`mt-1 text-sm font-medium tabular-nums ${
                          summary.overdueCents > 0 ? 'text-destructive' : ''
                        }`}
                      >
                        {formatMoney(summary.overdueCents)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
                      <p className="text-xs text-muted-foreground">Recebido</p>
                      <p className="mt-1 text-sm font-medium tabular-nums">
                        {formatMoney(summary.receivedCents)}
                      </p>
                    </div>
                  </div>
                ) : null}
                {summary?.scopeLabel ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Resumo financeiro: {summary.scopeLabel}.
                  </p>
                ) : null}
                <div className="mt-4 divide-y divide-border/70 border-y border-border/70">
                  {documents.map((document) => {
                    const row = customerFinancialTimelineRow(document)
                    return (
                      <article
                        key={document.id}
                        className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_9rem_9rem]"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-sm">{row.title}</p>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {row.statusLabel}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {row.fiscalLabel ? `${row.fiscalLabel} · ` : ''}
                            {row.evidenceLabel}
                          </p>
                          {row.evidenceReconnectPath &&
                          row.evidenceReconnectLabel ? (
                            <p className="mt-1 text-xs">
                              <Button
                                render={<Link to={row.evidenceReconnectPath} />}
                                variant="link"
                                size="xs"
                                className="h-auto p-0 text-xs"
                              >
                                {row.evidenceReconnectLabel}
                              </Button>
                            </p>
                          ) : null}
                        </div>
                        <div className="text-sm tabular-nums">
                          <p className="text-muted-foreground">Vencimento</p>
                          <p>{row.dueDateLabel}</p>
                        </div>
                        <div className="text-sm tabular-nums">
                          <p className="text-muted-foreground">Total / pago</p>
                          <p>
                            {row.amountLabel} / {row.paidLabel}
                          </p>
                        </div>
                      </article>
                    )
                  })}
                </div>
                {summary?.isTruncated ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Mostrando os {summary.documents} de {summary.totalDocuments}{' '}
                    documentos financeiros mais recentes.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </section>
    </ClientPanelBody>
  )
}

function ClientInfoForm({
  customer,
  customerId,
  conflictReturn,
}: {
  customer: CustomerDetail
  customerId: string
  conflictReturn: SyncConflictReturnSearch
}) {
  const navigate = useNavigate()
  const accessQuery = usePlanAccess()
  const { activeOrganizationId } = useDashboardContextState()
  const hasFinancial =
    accessQuery.data?.entitlements.includes('financial') ?? false
  const hasCustomerGroups =
    accessQuery.data?.entitlements.includes('customer_group') ?? false
  const financialTimelineQuery = useCustomerFinancialTimelineData({
    enabled: hasFinancial,
    id: customerId,
  })
  const groupsQuery = useCustomerGroupsList(
    activeOrganizationId,
    hasCustomerGroups,
  )
  const groups = groupsQuery.data?.data ?? []

  const financialSummary = customer.financialSummary

  return (
    <div className="space-y-6">
      <SyncConflictReturnNotice search={conflictReturn} />
      <ClientPanel
        eyebrow="Cadastro"
        title="Informações do Cliente"
        description="Dados cadastrais, contato principal e endereço usados no atendimento, nas ordens de serviço e nos documentos financeiros."
        icon={<HugeiconsIcon icon={UserAccountIcon} className="size-5" />}
      >
        <ClientMetricStrip>
          <ClientMetric
            icon={<HugeiconsIcon icon={Invoice01Icon} className="size-4" />}
            label="Documentos em Aberto"
            value={String(financialSummary?.openDocumentsCount ?? 0)}
          />
          <ClientMetric
            icon={<HugeiconsIcon icon={Invoice01Icon} className="size-4" />}
            label="Documentos Vencidos"
            tone={
              (financialSummary?.overdueDocumentsCount ?? 0) > 0
                ? 'danger'
                : 'default'
            }
            value={String(financialSummary?.overdueDocumentsCount ?? 0)}
          />
          <ClientMetric
            icon={<HugeiconsIcon icon={DollarCircleIcon} className="size-4" />}
            label="Saldo em Aberto"
            value={formatMoney(financialSummary?.openBalanceCents ?? 0)}
          />
          <ClientMetric
            icon={<HugeiconsIcon icon={DollarCircleIcon} className="size-4" />}
            label="Saldo Vencido"
            tone={financialSummary?.overdueBalanceFlag ? 'danger' : 'default'}
            value={formatMoney(financialSummary?.overdueBalanceCents ?? 0)}
          />
        </ClientMetricStrip>

        {hasFinancial ? (
          <CustomerFinancialTimelineBlock
            loading={financialTimelineQuery.isLoading}
            error={financialTimelineQuery.error}
            documents={financialTimelineQuery.data?.data.data ?? []}
            summary={financialTimelineQuery.data?.data.summary ?? null}
            freshness={financialTimelineQuery.data?.data.freshness ?? null}
            onRetry={() => {
              void financialTimelineQuery.refetch()
            }}
          />
        ) : null}

        <CustomerEditForm
          customer={customer}
          customerId={customerId}
          groups={groups}
          showGroupField={hasCustomerGroups}
          onSaved={(updated) => {
            if (shouldReturnToSyncConflicts(conflictReturn)) {
              navigate({ to: '/dashboard/sync/conflicts' })
              return
            }
            navigate({
              to: '/dashboard/clients/$id/info',
              params: {
                id: clientRouteId({
                  name: (updated.name ?? '').trim(),
                  taxId: updated.taxId?.trim() || null,
                }),
              },
            })
          }}
        />
      </ClientPanel>
    </div>
  )
}

function InfoSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.05),0_18px_45px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 dark:shadow-none">
      <div className="border-b border-border/70 px-5 py-5 sm:px-6">
        <div className="flex items-start gap-3">
          <Skeleton className="size-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
        </div>
      </div>
      <div className="grid divide-y divide-border/70 border-b border-border/70 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="px-5 py-4 sm:px-6">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-3 h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="space-y-8 px-5 py-6 sm:px-6 sm:py-7">
        <SkeletonFormSection />
        <SkeletonFormSection />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    </div>
  )
}

function SkeletonFormSection() {
  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="flex gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    </div>
  )
}
