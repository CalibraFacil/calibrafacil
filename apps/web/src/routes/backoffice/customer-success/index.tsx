import type { ReactNode } from 'react'
import { useDeferredValue, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { AccountBoard } from '@/features/backoffice/customer-success/boards'
import {
  useCustomerSuccessOrganizations,
  useSupportQueue,
  useUpdateAccountHealth,
} from '@/features/backoffice/customer-success/hooks'
import type {
  OrganizationFilter,
  OrganizationQueueItem,
} from '@/features/backoffice/customer-success/model'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/backoffice/customer-success/')({
  head: () => ({
    meta: [{ title: 'Customer Success | Contas | CalibraFácil' }],
  }),
  component: CustomerSuccessOverviewPage,
})

const organizationFilters: Array<[OrganizationFilter, string]> = [
  ['all', 'Todas'],
  ['attention', 'Precisam de atenção'],
  ['critical', 'Críticas'],
  ['priority', 'Priority support'],
  ['onboarding', 'Onboarding ativo'],
  ['migration', 'Migração ativa'],
  ['overdue', 'Ação atrasada'],
  ['unassigned', 'Sem owner'],
  ['escalation', 'Escalação'],
]

function CustomerSuccessOverviewPage() {
  const organizationsQuery = useCustomerSuccessOrganizations()
  const supportQueueQuery = useSupportQueue()
  const updateHealthMutation = useUpdateAccountHealth()
  const [organizationFilter, setOrganizationFilter] =
    useState<OrganizationFilter>('all')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())

  const organizations = useMemo(
    () => organizationsQuery.data?.data ?? [],
    [organizationsQuery.data?.data],
  )
  const supportQueue = useMemo(
    () => supportQueueQuery.data?.data ?? [],
    [supportQueueQuery.data?.data],
  )
  const filteredOrganizations = useMemo(
    () =>
      filterOrganizations({
        items: organizations,
        organizationFilter,
        search: deferredSearch,
      }),
    [deferredSearch, organizationFilter, organizations],
  )

  const totalOrganizations = organizations.length
  const attentionCount = organizations.filter(
    (item) => item.operationalSummary.needsAttention,
  ).length
  const priorityCount = organizations.filter(
    (item) => item.operationalSummary.prioritySupport,
  ).length
  const breachedCount = supportQueue.filter(
    (request) => request.slaStatus === 'BREACHED',
  ).length
  const escalationCount = supportQueue.filter(
    (request) => request.needsEscalation,
  ).length

  if (organizationsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-[520px] w-full" />
      </div>
    )
  }

  if (organizationsQuery.isError) {
    return (
      <div className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-8 text-sm text-destructive">
        {organizationsQuery.error instanceof Error
          ? organizationsQuery.error.message
          : 'Falha ao carregar contas'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 border-b pb-5 md:grid-cols-4">
        <Metric label="Contas acompanhadas" value={totalOrganizations} />
        <Metric label="Precisam de atenção" value={attentionCount} />
        <Metric label="Priority support" value={priorityCount} />
        <Metric label="Escalação pendente" value={escalationCount}>
          {breachedCount} fora do SLA
        </Metric>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">
              Contas por saúde operacional
            </h2>
            <p className="text-sm text-muted-foreground">
              Arraste uma conta para atualizar a saúde e abra o detalhe para
              operar postura, próximos passos e tickets.
            </p>
          </div>
          <Input
            className="lg:w-80"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar conta, slug, owner ou operador"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {organizationFilters.map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={organizationFilter === value ? 'default' : 'outline'}
              onClick={() => setOrganizationFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span>{filteredOrganizations.length} contas no board</span>
          <span>
            {
              filteredOrganizations.filter((item) => !item.internalOwnerUser)
                .length
            }{' '}
            sem owner interno
          </span>
          <span>
            {
              filteredOrganizations.filter(
                (item) =>
                  item.operationalSummary.nextActionStatus === 'OVERDUE',
              ).length
            }{' '}
            com ação atrasada
          </span>
        </div>

        <AccountBoard
          organizations={filteredOrganizations}
          onMoveHealth={(organizationId, healthStatus) =>
            updateHealthMutation.mutate({ organizationId, healthStatus })
          }
        />
      </section>
    </div>
  )
}

function filterOrganizations(params: {
  items: OrganizationQueueItem[]
  organizationFilter: OrganizationFilter
  search: string
}) {
  return params.items.filter((organization) => {
    const matchesSearch =
      params.search.length === 0 ||
      organization.name.toLowerCase().includes(params.search) ||
      organization.slug.toLowerCase().includes(params.search) ||
      (organization.accountOwnerName ?? '')
        .toLowerCase()
        .includes(params.search) ||
      (organization.internalOwnerUser?.name ?? '')
        .toLowerCase()
        .includes(params.search)

    if (!matchesSearch) return false

    switch (params.organizationFilter) {
      case 'attention':
        return organization.operationalSummary.needsAttention
      case 'critical':
        return organization.operationalSummary.healthStatus === 'CRITICAL'
      case 'priority':
        return organization.operationalSummary.prioritySupport
      case 'onboarding':
        return (
          organization.workflow.onboardingState !== 'INACTIVE' &&
          organization.workflow.onboardingState !== 'COMPLETED'
        )
      case 'migration':
        return (
          organization.workflow.migrationState !== 'INACTIVE' &&
          organization.workflow.migrationState !== 'COMPLETED'
        )
      case 'overdue':
        return (
          organization.operationalSummary.nextActionStatus === 'OVERDUE' ||
          organization.operationalSummary.breachedRequestsCount > 0
        )
      case 'unassigned':
        return organization.workflow.accountOwnershipStatus !== 'ASSIGNED'
      case 'escalation':
        return organization.workflow.supportState === 'ESCALATED'
      default:
        return true
    }
  })
}

function Metric(props: { label: string; value: number; children?: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {props.label}
      </p>
      <p className="text-3xl font-semibold tracking-tight">{props.value}</p>
      {props.children ? (
        <p className="text-xs text-muted-foreground">{props.children}</p>
      ) : null}
    </div>
  )
}
