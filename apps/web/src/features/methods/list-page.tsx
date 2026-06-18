import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  AiChemistry02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

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
import { DataTable } from '@/components/ui/data-table'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  METHODS_LIST_LIMIT,
  useMethodsListData,
} from '@/features/methods/queries'
import { METHOD_STATUSES, type MethodStatus } from '@/features/methods/types'
import {
  type Method,
  type MethodsTableMeta,
  methodsColumns,
} from '@/features/methods/components/columns'
import { methodRouteId } from '@/lib/route-identifiers'
import { isDesktopRuntime } from '@/runtime/desktop'

// The from-template catalog is cloud-only (the route is cloud-gated); hide the
// affordance entirely in the desktop/offline runtime.
const isCloudRuntime = !isDesktopRuntime()

const statusLabels: Record<MethodStatus, string> = {
  DRAFT: 'Rascunho',
  PENDING_APPROVAL: 'Em aprovação',
  TECHNICAL_REVIEWED: 'Revisão técnica',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
}

function parseMethodStatus(value: string | null): MethodStatus | '' {
  switch (value) {
    case 'DRAFT':
    case 'PENDING_APPROVAL':
    case 'TECHNICAL_REVIEWED':
    case 'PUBLISHED':
    case 'ARCHIVED':
      return value
    default:
      return ''
  }
}

export function MethodsListPage() {
  const navigate = useNavigate()
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
    parseAsStringLiteral([...METHOD_STATUSES, '']).withDefault(''),
  )

  const { data, isLoading, error } = useMethodsListData({
    activeOrganizationId,
    enabled: Boolean(activeOrganizationId) && !isContextSwitching,
    page,
    limit: METHODS_LIST_LIMIT,
    search,
    statusFilter,
  })

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      return calibraApi.methods.archive(id)
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
    mutationFn: async (id: number): Promise<Method> => {
      const result = await calibraApi.methods.createNewVersion(id)
      return {
        ...result,
        status: parseMethodStatus(result.status) || 'DRAFT',
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Nova versão criada')
      navigate({
        to: '/dashboard/methods/$id/edit',
        params: { id: methodRouteId(data) },
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
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          Erro ao carregar métodos: {error.message}
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
            Métodos de calibração
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Gerencie os métodos validados para calibração de instrumentos.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {isCloudRuntime ? (
            <Button
              render={<Link to="/dashboard/methods/from-template" />}
              className={ACTION_BUTTON_CLASS}
            >
              <HugeiconsIcon icon={Add01Icon} className="mr-2 size-4" />A partir de
              modelo
            </Button>
          ) : null}
          <Button
            render={<Link to="/dashboard/methods/new" />}
            variant={isCloudRuntime ? 'outline' : 'default'}
            className={isCloudRuntime ? undefined : ACTION_BUTTON_CLASS}
          >
            Método em branco
          </Button>
        </div>
      </div>

      <Panel className="p-4 sm:p-5">
        <div>
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
                setStatusFilter(parseMethodStatus(v))
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
                <SelectItem value="PENDING_APPROVAL">Em aprovação</SelectItem>
                <SelectItem value="TECHNICAL_REVIEWED">
                  Revisão técnica
                </SelectItem>
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
                  <div className="flex flex-wrap justify-center gap-2">
                    {isCloudRuntime ? (
                      <Button
                        render={
                          <Link to="/dashboard/methods/from-template" />
                        }
                      >
                        <HugeiconsIcon
                          icon={PlusSignIcon}
                          className="mr-2 size-4"
                        />
                        A partir de modelo
                      </Button>
                    ) : null}
                    <Button
                      render={<Link to="/dashboard/methods/new" />}
                      variant={isCloudRuntime ? 'outline' : 'default'}
                    >
                      Método em branco
                    </Button>
                  </div>
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
        </div>
      </Panel>
    </div>
  )
}
