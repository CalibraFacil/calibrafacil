import { Link, useNavigate } from '@tanstack/react-router'
import type { ActivationStepId } from '@calibra-facil/client-runtime'
import { OnboardingStepHint } from '@/features/onboarding/step-hint'
import {
  Building02Icon,
  PlusSignIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { DataTable } from '@/components/ui/data-table'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  CUSTOMERS_LIST_LIMIT,
  useCustomersListData,
} from '@/features/customers/queries'
import {
  type Client,
  clientsColumns,
} from '@/features/customers/components/columns'
import { clientRouteId } from '@/lib/route-identifiers'

export function ClientsPage({
  onboardingStep,
}: {
  /** Set when the laboratory arrived here from the activation checklist. */
  onboardingStep?: ActivationStepId
} = {}) {
  const navigate = useNavigate()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [search, setSearch] = useQueryState(
    'query',
    parseAsString.withDefault(''),
  )
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))

  const { data, isLoading, error } = useCustomersListData({
    activeOrganizationId,
    enabled: !isContextSwitching,
    page,
    limit: CUSTOMERS_LIST_LIMIT,
    search,
  })

  const handleRowClick = (client: Client) => {
    navigate({
      to: '/dashboard/clients/$id',
      params: { id: clientRouteId(client) },
    })
  }

  return (
    <div className="space-y-6">
      <OnboardingStepHint step={onboardingStep} expected="customer" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Cadastro
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Clientes
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Gerencie os clientes do laboratório.
          </p>
        </div>
        <Button
          render={<Link to="/dashboard/clients/new" />}
          className={`${ACTION_BUTTON_CLASS} shrink-0`}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
          Novo Cliente
        </Button>
      </div>

      <Panel className="p-4 sm:p-5">
        <div>
          {/* Search */}
          <div className="mb-6">
            <div className="relative max-w-sm">
              <HugeiconsIcon
                icon={Search01Icon}
                className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                placeholder="Buscar por nome, CNPJ ou email..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="pl-9"
              />
            </div>
          </div>

          {/* Error state */}
          {error && (
            <div className="text-destructive py-8 text-center">
              Erro ao carregar clientes. Tente novamente.
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && data?.data?.length === 0 && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Building02Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum cliente encontrado</EmptyTitle>
                <EmptyDescription>
                  {search
                    ? 'Nenhum cliente corresponde a sua busca.'
                    : 'Comece adicionando seu primeiro cliente.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && (
                  <Button render={<Link to="/dashboard/clients/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Novo Cliente
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          )}

          {/* Data table */}
          {!error && (data?.data?.length ?? 0) > 0 && (
            <DataTable
              columns={clientsColumns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={setPage}
              onRowClick={handleRowClick}
            />
          )}

          {/* Loading state when no data yet */}
          {isLoading && !data && (
            <DataTable columns={clientsColumns} data={[]} isLoading={true} />
          )}
        </div>
      </Panel>
    </div>
  )
}
