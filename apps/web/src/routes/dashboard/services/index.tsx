import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { parseAsInteger, useQueryState } from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
  ShoppingBasket03Icon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'

export const Route = createFileRoute('/dashboard/services/')({
  head: () => ({
    meta: [{ title: 'Serviços | CalibraFácil' }],
  }),
  component: ServicesListPage,
})

interface Service {
  id: number
  name: string
  description: string | null
  methodId: number | null
  methodName: string | null
  methodStatus: string | null
  assetTypeId: number | null
  assetTypeName: string | null
  price: number | null
  currency: string
  tat: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Format price from cents to BRL currency string
 * Returns "Sob consulta" for null prices
 */
function formatPrice(priceInCents: number | null, currency: string): string {
  if (priceInCents === null) {
    return 'Sob consulta'
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'BRL',
  }).format(priceInCents / 100)
}

/**
 * Format turnaround time in days
 */
function formatTat(tat: number | null): string {
  if (tat === null) {
    return '-'
  }
  return `${tat} ${tat === 1 ? 'dia' : 'dias'}`
}

function ServicesListPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | ''>(
    '',
  )

  const limit = 20

  // Fetch services
  const { data, isLoading, error } = useQuery({
    queryKey: ['services', page, search, statusFilter],
    queryFn: async () => {
      const res = await api.api.services.$get({
        query: {
          page: String(page),
          limit: String(limit),
          query: search || undefined,
          isActive:
            statusFilter === 'active'
              ? 'true'
              : statusFilter === 'inactive'
                ? 'false'
                : undefined,
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar serviços')
      }

      return res.json() as Promise<{
        data: Array<Service>
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }>
    },
  })

  // Deactivate mutation
  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.api.services[':id'].$delete({
        param: { id: String(id) },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao desativar',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      toast.success('Serviço desativado com sucesso')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Reactivate mutation
  const reactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.api.services[':id'].$put({
        param: { id: String(id) },
        json: { isActive: true },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao reativar',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      toast.success('Serviço reativado com sucesso')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar serviços: {error.message}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Catálogo de Serviços</CardTitle>
            <CardDescription>
              Gerencie os serviços oferecidos pelo laboratório
            </CardDescription>
          </div>
          <Button
            render={
              <Link to="/dashboard/services/new">
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                Novo Serviço
              </Link>
            }
          />
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <form onSubmit={handleSearch} className="flex gap-4 mb-6">
            <Input
              placeholder="Buscar por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as 'active' | 'inactive' | '')
                setPage(1)
              }}
            >
              <SelectTrigger className="w-40">
                <span>
                  {statusFilter === 'active'
                    ? 'Ativos'
                    : statusFilter === 'inactive'
                      ? 'Inativos'
                      : 'Todos'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos</SelectItem>
                <SelectItem value="active">Ativos</SelectItem>
                <SelectItem value="inactive">Inativos</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" variant="secondary">
              Buscar
            </Button>
          </form>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : data?.data.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={ShoppingBasket03Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum serviço encontrado</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter
                    ? 'Nenhum serviço encontrado para os filtros aplicados.'
                    : 'Comece adicionando seu primeiro serviço ao catálogo'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && !statusFilter && (
                  <Button render={<Link to="/dashboard/services/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Novo Serviço
                  </Button>
                )}
                {(search || statusFilter) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('')
                      setPage(1)
                    }}
                  >
                    Limpar filtros
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Tipo de Instrumento</TableHead>
                    <TableHead>Preço</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((service) => (
                    <TableRow
                      key={service.id}
                      className={!service.isActive ? 'opacity-60' : ''}
                    >
                      <TableCell>
                        <Link
                          to="/dashboard/services/$id/edit"
                          params={{ id: String(service.id) }}
                          className="font-medium hover:underline"
                        >
                          {service.name}
                        </Link>
                        {service.description && (
                          <p className="text-sm text-muted-foreground truncate max-w-xs">
                            {service.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        {service.methodName ? (
                          <Link
                            to="/dashboard/methods/$id"
                            params={{ id: String(service.methodId) }}
                            className="hover:underline text-primary"
                          >
                            {service.methodName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {service.assetTypeName || (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono">
                        {formatPrice(service.price, service.currency)}
                      </TableCell>
                      <TableCell>{formatTat(service.tat)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={service.isActive ? 'default' : 'secondary'}
                        >
                          {service.isActive ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon" />}
                          >
                            <HugeiconsIcon
                              icon={MoreHorizontalIcon}
                              className="h-4 w-4"
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              render={() => (
                                <Link
                                  to="/dashboard/services/$id/edit"
                                  params={{ id: String(service.id) }}
                                >
                                  <HugeiconsIcon
                                    icon={Edit02Icon}
                                    className="mr-2 h-4 w-4"
                                  />
                                  Editar
                                </Link>
                              )}
                            />
                            <DropdownMenuSeparator />
                            {service.isActive ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  deactivateMutation.mutate(service.id)
                                }
                                className="text-destructive"
                              >
                                <HugeiconsIcon
                                  icon={Cancel01Icon}
                                  className="mr-2 h-4 w-4"
                                />
                                Desativar
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() =>
                                  reactivateMutation.mutate(service.id)
                                }
                              >
                                <HugeiconsIcon
                                  icon={CheckmarkCircle02Icon}
                                  className="mr-2 h-4 w-4"
                                />
                                Reativar
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {data && data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Mostrando{' '}
                    {(data.pagination.page - 1) * data.pagination.limit + 1} a{' '}
                    {Math.min(
                      data.pagination.page * data.pagination.limit,
                      data.pagination.total,
                    )}{' '}
                    de {data.pagination.total} serviços
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page - 1)}
                      disabled={page === 1}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page + 1)}
                      disabled={page >= data.pagination.totalPages}
                    >
                      Próximo
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
