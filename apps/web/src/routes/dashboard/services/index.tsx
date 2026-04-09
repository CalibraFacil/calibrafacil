import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { parseAsInteger, useQueryState } from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon, ShoppingBasket03Icon } from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { DataTable } from '@/components/ui/data-table'
import {
  type Service,
  type ServicesTableMeta,
  servicesColumns,
} from './-components/columns'

export const Route = createFileRoute('/dashboard/services/')({
  head: () => ({
    meta: [{ title: 'Serviços | CalibraFácil' }],
  }),
  component: ServicesListPage,
})

function ServicesListPage() {
  const queryClient = useQueryClient()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const organizationQueryKey = activeOrganizationId ?? 'no-org'
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | ''>(
    '',
  )

  const limit = 20

  const { data, isLoading, error } = useQuery({
    queryKey: ['services', organizationQueryKey, page, search, statusFilter],
    enabled: Boolean(activeOrganizationId) && !isContextSwitching,
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

  const tableMeta: ServicesTableMeta = {
    onDeactivate: (id) => deactivateMutation.mutate(id),
    onReactivate: (id) => reactivateMutation.mutate(id),
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

          {/* Empty State */}
          {!isLoading && data?.data.length === 0 ? (
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
            <DataTable
              columns={servicesColumns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={setPage}
              meta={tableMeta}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
