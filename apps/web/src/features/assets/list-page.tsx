import { Link, useNavigate } from '@tanstack/react-router'
import {
  Cancel01Icon,
  PlusSignIcon,
  Search01Icon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from 'nuqs'

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
} from '@/features/assets/components/columns'
import { assetRouteId } from '@/lib/route-identifiers'
import { ASSETS_LIST_LIMIT, useAssetsListData } from '@/features/assets/queries'
import { ASSET_STATUSES, type AssetStatus } from '@/features/assets/types'
import { useCustomersSearchData } from '@/features/customers/queries'

const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Manutenção',
  SCRAPPED: 'Descartado',
}

export function AssetsPage() {
  const navigate = useNavigate()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [search, setSearch] = useQueryState(
    'query',
    parseAsString.withDefault(''),
  )
  const [statusFilter, setStatusFilter] = useQueryState(
    'status',
    parseAsStringLiteral([...ASSET_STATUSES, '']).withDefault(''),
  )
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))

  const [customerIdParam, setCustomerIdParam] = useQueryState(
    'customerId',
    parseAsInteger,
  )
  const [customerSearch, setCustomerSearch] = useState('')

  const { data: customersData, isLoading: customersLoading } =
    useCustomersSearchData({
      activeOrganizationId,
      search: customerSearch,
      enabled: Boolean(activeOrganizationId) && !isContextSwitching,
    })

  const selectedCustomerName = useMemo(() => {
    if (!customerIdParam || !customersData?.data) return ''
    const customer = customersData.data.find((c) => c.id === customerIdParam)
    return customer?.name || ''
  }, [customerIdParam, customersData?.data])

  const { data, isLoading, error } = useAssetsListData({
    activeOrganizationId,
    enabled: Boolean(activeOrganizationId) && !isContextSwitching,
    page,
    limit: ASSETS_LIST_LIMIT,
    search,
    statusFilter,
    customerId: customerIdParam,
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
      params: { id: assetRouteId(asset) },
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
                setStatusFilter(
                  value === 'all' || value === null
                    ? ''
                    // oxlint-disable-next-line typescript/consistent-type-assertions -- Select options are limited to AssetStatus values.
                    : (value as AssetStatus),
                )
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <span>
                  {statusFilter ? statusLabels[statusFilter] : 'Status'}
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
