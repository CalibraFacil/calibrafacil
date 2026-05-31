import { Link } from '@tanstack/react-router'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  PlusSignIcon,
  AlertCircleIcon,
  Clock01Icon,
  CalendarRemove01Icon,
} from '@hugeicons/core-free-icons'

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
  ACTION_BUTTON_CLASS,
  Panel,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { DataTable } from '@/components/ui/data-table'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  useNonConformanceListData,
  useNonConformanceSummaryData,
} from '@/features/quality/queries'
import {
  NON_CONFORMANCE_STATUSES,
  NON_CONFORMANCE_TYPES,
  type NonConformanceStatus,
  type NonConformanceType,
} from '@/features/quality/types'
import { ncColumns } from '@/features/quality/components/nc-columns'

function parseNonConformanceStatus(
  value: string | null,
): NonConformanceStatus | '' {
  switch (value) {
    case 'open':
    case 'under_review':
    case 'resolved':
      return value
    default:
      return ''
  }
}

function parseNonConformanceType(value: string | null): NonConformanceType | '' {
  switch (value) {
    case 'work':
    case 'equipment':
    case 'documentation':
      return value
    default:
      return ''
  }
}

export function NCListPage() {
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useQueryState(
    'query',
    parseAsString.withDefault(''),
  )
  const [statusFilter, setStatusFilter] = useQueryState(
    'status',
    parseAsStringLiteral([...NON_CONFORMANCE_STATUSES, '']).withDefault(''),
  )
  const [typeFilter, setTypeFilter] = useQueryState(
    'type',
    parseAsStringLiteral([...NON_CONFORMANCE_TYPES, '']).withDefault(''),
  )

  const organizationId = activeOrganizationId ?? 'no-org'
  const canLoad =
    !cloudOnlyUnavailable &&
    Boolean(activeOrganizationId) &&
    !isContextSwitching

  const { data, isLoading, error } = useNonConformanceListData({
    organizationId,
    page,
    search,
    statusFilter,
    typeFilter,
    enabled: canLoad,
  })

  const { data: summary } = useNonConformanceSummaryData({
    organizationId,
    enabled: canLoad,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  const openCount =
    summary?.byStatus.find((s) => s.status === 'open')?.count ?? 0
  const reviewCount =
    summary?.byStatus.find((s) => s.status === 'under_review')?.count ?? 0

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Não conformidades indisponíveis offline" />
    )
  }

  if (isContextSwitching) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Carregando o contexto da organização ativa.
        </p>
      </Panel>
    )
  }

  if (error) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          Erro ao carregar não conformidades: {error.message}
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Qualidade
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Não conformidades
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Controle de trabalhos não conformes: registro, disposição e
            resolução.
          </p>
        </div>
        <Button
          render={<Link to="/dashboard/nc/new" />}
          className={`${ACTION_BUTTON_CLASS} shrink-0`}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
          Registrar NC
        </Button>
      </div>

      {summary && (
        <StaggerGroup className="grid gap-3 sm:grid-cols-3">
          <StaggerItem>
            <SignalTile
              icon={AlertCircleIcon}
              label="Abertas"
              value={openCount}
              tone={openCount > 0 ? 'critical' : 'ok'}
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={Clock01Icon}
              label="Em análise"
              value={reviewCount}
              tone={reviewCount > 0 ? 'warning' : 'neutral'}
            />
          </StaggerItem>
          <StaggerItem>
            <SignalTile
              icon={CalendarRemove01Icon}
              label="Abertas > 30 dias"
              value={summary.ageBrackets.moreThan30Days}
              tone={
                summary.ageBrackets.moreThan30Days > 0 ? 'critical' : 'neutral'
              }
            />
          </StaggerItem>
        </StaggerGroup>
      )}

      <Panel className="p-4 sm:p-5">
        <div>
          {/* Filters */}
          <form onSubmit={handleSearch} className="flex gap-4 mb-6">
            <Input
              placeholder="Buscar por número ou descrição..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(parseNonConformanceStatus(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="w-48">
                <span>
                  {statusFilter === 'open'
                    ? 'Abertas'
                    : statusFilter === 'under_review'
                      ? 'Em Análise'
                      : statusFilter === 'resolved'
                        ? 'Resolvidas'
                        : 'Todos os Status'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os Status</SelectItem>
                <SelectItem value="open">Abertas</SelectItem>
                <SelectItem value="under_review">Em Análise</SelectItem>
                <SelectItem value="resolved">Resolvidas</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(parseNonConformanceType(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="w-48">
                <span>
                  {typeFilter === 'work'
                    ? 'Trabalho'
                    : typeFilter === 'equipment'
                      ? 'Equipamento'
                      : typeFilter === 'documentation'
                        ? 'Documentação'
                        : 'Todos os Tipos'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os Tipos</SelectItem>
                <SelectItem value="work">Trabalho</SelectItem>
                <SelectItem value="equipment">Equipamento</SelectItem>
                <SelectItem value="documentation">Documentação</SelectItem>
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
                  <HugeiconsIcon icon={AlertCircleIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhuma não conformidade encontrada</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter || typeFilter
                    ? 'Nenhuma NC encontrada para os filtros aplicados.'
                    : 'Nenhuma não conformidade registrada ainda.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && !statusFilter && !typeFilter && (
                  <Button render={<Link to="/dashboard/nc/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Registrar NC
                  </Button>
                )}
                {(search || statusFilter || typeFilter) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('')
                      setTypeFilter('')
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
              columns={ncColumns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={setPage}
            />
          )}
        </div>
      </Panel>
    </div>
  )
}
