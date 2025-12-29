import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { parseAsInteger, useQueryState } from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  AiChemistry02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

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
import { DataTable } from '@/components/ui/data-table'
import {
  type Method,
  type MethodsTableMeta,
  methodsColumns,
} from './-components/columns'

export const Route = createFileRoute('/dashboard/methods/')({
  head: () => ({
    meta: [{ title: 'Métodos de Calibração | CalibraFácil' }],
  }),
  component: MethodsListPage,
})

type MethodStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

const statusLabels: Record<MethodStatus, string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
}

function MethodsListPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<MethodStatus | ''>('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['methods', page, search, statusFilter],
    queryFn: async () => {
      const res = await api.api.methods.$get({
        query: {
          page: String(page),
          limit: '20',
          query: search || undefined,
          status: statusFilter || undefined,
          includeArchived: statusFilter === 'ARCHIVED' ? 'true' : 'false',
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar métodos')
      }

      return res.json() as Promise<{
        data: Array<Method>
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }>
    },
  })

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.api.methods[':id'].archive.$post({
        param: { id: String(id) },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao arquivar',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Método arquivado com sucesso')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const newVersionMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.api.methods[':id']['new-version'].$post({
        param: { id: String(id) },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao criar nova versão',
        )
      }
      return res.json() as Promise<{ id: number }>
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Nova versão criada')
      navigate({
        to: '/dashboard/methods/$id/edit',
        params: { id: String(data.id) },
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  const tableMeta: MethodsTableMeta = {
    onArchive: (id) => archiveMutation.mutate(id),
    onNewVersion: (id) => newVersionMutation.mutate(id),
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar métodos: {error.message}
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
            <CardTitle>Métodos de Calibração</CardTitle>
            <CardDescription>
              Gerencie os métodos validados para calibração de instrumentos
            </CardDescription>
          </div>
          <Button
            render={
              <Link to="/dashboard/methods/new">
                <HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" />
                Novo Método
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
                setStatusFilter(v as MethodStatus | '')
                setPage(1)
              }}
            >
              <SelectTrigger className="w-40">
                <span>
                  {statusFilter
                    ? statusLabels[statusFilter]
                    : 'Todos os status'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os status</SelectItem>
                <SelectItem value="DRAFT">Rascunho</SelectItem>
                <SelectItem value="PUBLISHED">Publicado</SelectItem>
                <SelectItem value="ARCHIVED">Arquivado</SelectItem>
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
                  <HugeiconsIcon icon={AiChemistry02Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum método encontrado</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter
                    ? 'Nenhum método encontrado para os filtros aplicados.'
                    : 'Comece adicionando seu primeiro método de calibração'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && !statusFilter && (
                  <Button render={<Link to="/dashboard/methods/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Novo Método
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
              columns={methodsColumns}
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
