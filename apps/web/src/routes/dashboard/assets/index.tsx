import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Cancel01Icon,
  PlusSignIcon,
  Search01Icon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'
import { parseAsInteger, useQueryState } from 'nuqs'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { DataTable } from '@/components/ui/data-table'
import {
  type Asset,
  type AssetsTableMeta,
  assetsColumns,
} from './-components/columns'

export const Route = createFileRoute('/dashboard/assets/')({
  head: () => ({
    meta: [{ title: 'Ativos | CalibraFácil' }],
  }),
  component: AssetsPage,
})

type AssetStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'SCRAPPED'

const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Manutenção',
  SCRAPPED: 'Descartado',
}

function AssetsPage() {
  const navigate = useNavigate()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const organizationQueryKey = activeOrganizationId ?? 'no-org'
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const limit = 20

  const [customerIdParam, setCustomerIdParam] = useQueryState(
    'customerId',
    parseAsInteger,
  )
  const [customerSearch, setCustomerSearch] = useState('')

  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers', organizationQueryKey, 'search', customerSearch],
    enabled: Boolean(activeOrganizationId) && !isContextSwitching,
    queryFn: async () => {
      const res = await api.api.customers.$get({
        query: {
          page: '1',
          limit: '50',
          query: customerSearch || undefined,
        },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar clientes')
      }
      return res.json()
    },
    staleTime: 30000,
  })

  const selectedCustomerName = useMemo(() => {
    if (!customerIdParam || !customersData?.data) return ''
    const customer = customersData.data.find((c) => c.id === customerIdParam)
    return customer?.name || ''
  }, [customerIdParam, customersData?.data])

  const { data, isLoading, error } = useQuery({
    queryKey: [
      'assets',
      organizationQueryKey,
      page,
      limit,
      search,
      statusFilter,
      customerIdParam,
    ],
    enabled: Boolean(activeOrganizationId) && !isContextSwitching,
    queryFn: async () => {
      const res = await api.api.assets.$get({
        query: {
          page: String(page),
          limit: String(limit),
          query: search || undefined,
          status: (statusFilter as AssetStatus) || undefined,
          customerId: customerIdParam ? String(customerIdParam) : undefined,
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar ativos')
      }

      return res.json() as Promise<{
        data: Asset[]
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }>
    },
  })

  const tableMeta: AssetsTableMeta = {
    onCustomerClick: (customerId) => {
      setCustomerIdParam(customerId)
      setPage(1)
    },
  }

  const handleRowClick = (asset: Asset) => {
    navigate({
      to: '/dashboard/assets/$id',
      params: { id: String(asset.id) },
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Ativos</CardTitle>
              <CardDescription>
                Gerencie os ativos e instrumentos do laboratório.
              </CardDescription>
            </div>
            <Button render={<Link to="/dashboard/assets/new" />}>
              <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
              Novo Ativo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search and filters */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
            <div className="relative flex-1 min-w-50">
              <HugeiconsIcon
                icon={Search01Icon}
                className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                placeholder="Buscar por nome, tag, serie..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="pl-9"
              />
            </div>

            {/* Customer filter */}
            <div className="w-full sm:w-55">
              <Combobox
                value={customerIdParam ? String(customerIdParam) : ''}
                onValueChange={(value) => {
                  setCustomerIdParam(value ? Number(value) : null)
                  setPage(1)
                }}
              >
                <ComboboxInput
                  placeholder="Filtrar por cliente..."
                  value={selectedCustomerName || customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  showClear={!!customerIdParam}
                />
                <ComboboxContent>
                  <ComboboxList>
                    <ComboboxEmpty>
                      {customersLoading
                        ? 'Carregando...'
                        : 'Nenhum cliente encontrado'}
                    </ComboboxEmpty>
                    {customersData?.data?.map((customer) => (
                      <ComboboxItem
                        key={customer.id}
                        value={String(customer.id)}
                      >
                        {customer.name}
                      </ComboboxItem>
                    ))}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>

            {/* Status filter */}
            <Select
              value={statusFilter || 'all'}
              onValueChange={(value) => {
                setStatusFilter(value === 'all' || value === null ? '' : value)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <span>
                  {statusFilter
                    ? statusLabels[statusFilter as AssetStatus]
                    : 'Status'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ACTIVE">Ativo</SelectItem>
                <SelectItem value="INACTIVE">Inativo</SelectItem>
                <SelectItem value="MAINTENANCE">Manutenção</SelectItem>
                <SelectItem value="SCRAPPED">Descartado</SelectItem>
              </SelectContent>
            </Select>

            {/* Clear filters button */}
            {(search || statusFilter || customerIdParam) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('')
                  setStatusFilter('')
                  setCustomerIdParam(null)
                  setPage(1)
                }}
                className="h-9"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="mr-2 size-4" />
                Limpar filtros
              </Button>
            )}
          </div>

          {/* Error state */}
          {error && (
            <div className="text-destructive py-8 text-center">
              Erro ao carregar ativos. Tente novamente.
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && data?.data?.length === 0 && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Wrench01Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum ativo encontrado</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter || customerIdParam
                    ? 'Nenhum ativo corresponde aos filtros aplicados.'
                    : 'Comece adicionando seu primeiro ativo.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && !statusFilter && !customerIdParam && (
                  <Button render={<Link to="/dashboard/assets/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Novo Ativo
                  </Button>
                )}
                {(search || statusFilter || customerIdParam) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('')
                      setCustomerIdParam(null)
                      setPage(1)
                    }}
                  >
                    Limpar filtros
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          )}

          {/* Data table */}
          {!error && (data?.data?.length ?? 0) > 0 && (
            <DataTable
              columns={assetsColumns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={setPage}
              onRowClick={handleRowClick}
              meta={tableMeta}
            />
          )}

          {/* Loading state when no data yet */}
          {isLoading && !data && (
            <DataTable columns={assetsColumns} data={[]} isLoading={true} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
