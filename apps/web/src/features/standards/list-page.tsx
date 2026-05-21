import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon, RulerIcon } from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
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
  type ReferenceStandard,
  type StandardsTableMeta,
  standardsColumns,
} from '@/features/standards/components/columns'
import {
  STANDARDS_LIST_LIMIT,
  useStandardsListData,
} from '@/features/standards/queries'
import {
  STANDARD_STATUSES,
  type StandardStatus,
} from '@/features/standards/types'

export function StandardsListPage() {
  const queryClient = useQueryClient()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useQueryState(
    'query',
    parseAsString.withDefault(''),
  )
  const [statusFilter, setStatusFilter] = useQueryState(
    'status',
    parseAsStringLiteral([...STANDARD_STATUSES, '']).withDefault(''),
  )

  const { data, isLoading, error } = useStandardsListData({
    activeOrganizationId,
    enabled: Boolean(activeOrganizationId) && !isContextSwitching,
    page,
    limit: STANDARDS_LIST_LIMIT,
    search,
    statusFilter,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => calibraApi.standards.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standards'] })
      toast.success('Padrão removido com sucesso')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: number
      status: ReferenceStandard['status']
    }) => {
      return calibraApi.standards.update(id, { status })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standards'] })
      toast.success('Status atualizado com sucesso')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  const tableMeta: StandardsTableMeta = {
    onStatusChange: (id, status) => statusMutation.mutate({ id, status }),
    onDelete: (id) => deleteMutation.mutate(id),
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar padroes: {error.message}
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
            <CardTitle>Padrões de Referência</CardTitle>
            <CardDescription>
              Gerencie os padrões e equipamentos de calibração do laboratório
            </CardDescription>
          </div>
          <Button
            render={
              <Link to="/dashboard/standards/new">
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                Novo Padrão
              </Link>
            }
          />
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <form onSubmit={handleSearch} className="flex gap-4 mb-6">
            <Input
              placeholder="Buscar por nome, série ou certificado..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as StandardStatus | '')
                setPage(1)
              }}
            >
              <SelectTrigger className="w-48">
                <span>
                  {statusFilter === 'ACTIVE'
                    ? 'Ativos'
                    : statusFilter === 'INACTIVE'
                      ? 'Inativos'
                      : statusFilter === 'OUT_OF_TOLERANCE'
                        ? 'Fora de Tolerancia'
                        : statusFilter === 'SENT_FOR_CALIBRATION'
                          ? 'Em Calibração'
                          : 'Todos os Status'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os Status</SelectItem>
                <SelectItem value="ACTIVE">Ativos</SelectItem>
                <SelectItem value="INACTIVE">Inativos</SelectItem>
                <SelectItem value="OUT_OF_TOLERANCE">
                  Fora de Tolerancia
                </SelectItem>
                <SelectItem value="SENT_FOR_CALIBRATION">
                  Em Calibração
                </SelectItem>
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
                  <HugeiconsIcon icon={RulerIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum padrão encontrado</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter
                    ? 'Nenhum padrão encontrado para os filtros aplicados.'
                    : 'Comece cadastrando seu primeiro padrão de referência'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && !statusFilter && (
                  <Button render={<Link to="/dashboard/standards/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Novo Padrão
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
              columns={standardsColumns}
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
