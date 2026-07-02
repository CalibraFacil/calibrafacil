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
import { BoxIcon, PlusSignIcon } from '@hugeicons/core-free-icons'

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
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { DataTable } from '@/components/ui/data-table'
import {
  type MaterialsTableMeta,
  materialsColumns,
} from '@/features/materials/components/columns'
import {
  MATERIALS_LIST_LIMIT,
  useMaterialsListData,
} from '@/features/materials/queries'
import {
  MATERIALS_LIST_STATUSES,
  type MaterialsListStatus,
} from '@/features/materials/types'

export function MaterialsListPage() {
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
    parseAsStringLiteral([...MATERIALS_LIST_STATUSES, '']).withDefault(''),
  )

  const { data, isLoading, error } = useMaterialsListData({
    activeOrganizationId,
    enabled: Boolean(activeOrganizationId) && !isContextSwitching,
    page,
    limit: MATERIALS_LIST_LIMIT,
    search,
    statusFilter,
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => calibraApi.materials.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] })
      toast.success('Material desativado com sucesso')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: (id: number) =>
      calibraApi.materials.update(id, { isActive: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] })
      toast.success('Material reativado com sucesso')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  const tableMeta: MaterialsTableMeta = {
    onDeactivate: (id) => deactivateMutation.mutate(id),
    onReactivate: (id) => reactivateMutation.mutate(id),
  }

  if (error) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          Erro ao carregar materiais: {error.message}
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Cadastro
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Peças e materiais
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Gerencie o catálogo de peças e materiais consumidos nas ordens de
            serviço.
          </p>
        </div>
        <Button
          render={<Link to="/dashboard/materials/new" />}
          className={`${ACTION_BUTTON_CLASS} shrink-0`}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
          Novo material
        </Button>
      </div>

      <Panel className="p-4 sm:p-5">
        <div>
          {/* Filters */}
          <form onSubmit={handleSearch} className="flex gap-4 mb-6">
            <Input
              placeholder="Buscar por nome ou código..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                // oxlint-disable-next-line typescript/consistent-type-assertions -- Select options are limited to material list statuses.
                setStatusFilter(v as MaterialsListStatus | '')
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
                  <HugeiconsIcon icon={BoxIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum material encontrado</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter
                    ? 'Nenhum material encontrado para os filtros aplicados.'
                    : 'Comece adicionando sua primeira peça ou material ao catálogo'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && !statusFilter && (
                  <Button render={<Link to="/dashboard/materials/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Novo material
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
              columns={materialsColumns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={setPage}
              meta={tableMeta}
            />
          )}
        </div>
      </Panel>
    </div>
  )
}
