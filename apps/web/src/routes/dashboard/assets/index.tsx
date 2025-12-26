import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Cancel01Icon,
  PlusSignIcon,
  Search01Icon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState, useMemo } from 'react'
import { useQueryState, parseAsInteger } from 'nuqs'

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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

export const Route = createFileRoute('/dashboard/assets/')({
  head: () => ({
    meta: [{ title: 'Ativos | CalibraFacil' }],
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

const statusVariants: Record<
  AssetStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  ACTIVE: 'default',
  INACTIVE: 'secondary',
  MAINTENANCE: 'outline',
  SCRAPPED: 'destructive',
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-'
  const d = new Date(date)
  return d.toLocaleDateString('pt-BR')
}

function AssetsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const limit = 20

  // Customer filter with URL sync via nuqs
  const [customerIdParam, setCustomerIdParam] = useQueryState(
    'customerId',
    parseAsInteger,
  )
  const [customerSearch, setCustomerSearch] = useState('')

  // Fetch customers for the filter combobox
  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers', 'search', customerSearch],
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

  // Get the selected customer name for display
  const selectedCustomerName = useMemo(() => {
    if (!customerIdParam || !customersData?.data) return ''
    const customer = customersData.data.find((c) => c.id === customerIdParam)
    return customer?.name || ''
  }, [customerIdParam, customersData?.data])

  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', page, limit, search, statusFilter, customerIdParam],
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

      return res.json()
    },
  })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Ativos</CardTitle>
              <CardDescription>
                Gerencie os ativos e instrumentos do laboratorio.
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
            <div className="relative flex-1 min-w-[200px]">
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
            <div className="w-full sm:w-[220px]">
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
              <SelectTrigger className="w-full sm:w-[160px]">
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

          {/* Loading state */}
          {isLoading && <AssetsTableSkeleton />}

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
          {!isLoading && !error && data?.data && data.data.length > 0 && (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tag</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Fabricante</TableHead>
                      <TableHead>N. Serie</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Prox. Calibracao</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((asset) => (
                      <TableRow
                        key={asset.id}
                        className="cursor-pointer"
                        onClick={() =>
                          navigate({
                            to: '/dashboard/assets/$id',
                            params: { id: String(asset.id) },
                          })
                        }
                      >
                        <TableCell className="font-mono font-medium">
                          {asset.tag}
                        </TableCell>
                        <TableCell>{asset.name}</TableCell>
                        <TableCell>{asset.manufacturer || '-'}</TableCell>
                        <TableCell className="font-mono">
                          {asset.serialNumber}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="cursor-pointer hover:bg-accent"
                            onClick={(e) => {
                              e.stopPropagation()
                              setCustomerIdParam(asset.customerId)
                              setPage(1)
                            }}
                          >
                            {asset.customerName}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              statusVariants[asset.status as AssetStatus]
                            }
                          >
                            {statusLabels[asset.status as AssetStatus]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {formatDate(asset.nextCalibrationDate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {data.pagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-muted-foreground text-sm">
                    Pagina {data.pagination.page} de{' '}
                    {data.pagination.totalPages} ({data.pagination.total}{' '}
                    ativos)
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPage((p) =>
                          Math.min(data.pagination.totalPages, p + 1),
                        )
                      }
                      disabled={page === data.pagination.totalPages}
                    >
                      Proximo
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AssetsTableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tag</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Fabricante</TableHead>
              <TableHead>N. Serie</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Prox. Calibracao</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
