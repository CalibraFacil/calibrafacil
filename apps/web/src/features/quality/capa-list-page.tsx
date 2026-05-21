import { Link } from '@tanstack/react-router'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon, AlertCircleIcon } from '@hugeicons/core-free-icons'

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
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { useCapaListData, useCapaSummaryData } from '@/features/quality/queries'
import {
  CAPA_CATEGORIES,
  CAPA_SEVERITIES,
  CAPA_STATUSES,
  type CapaCategory,
  type CapaSeverity,
  type CapaStatus,
} from '@/features/quality/types'
import { capaColumns } from '@/features/quality/components/capa-columns'

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Abertas',
  INVESTIGATION: 'Em Investigação',
  IMPLEMENTATION: 'Implementação',
  VERIFICATION: 'Verificação',
  CLOSED: 'Fechadas',
}

const SEVERITY_LABELS: Record<string, string> = {
  minor: 'Menor',
  major: 'Maior',
  critical: 'Crítica',
}

const CATEGORY_LABELS: Record<string, string> = {
  method: 'Método',
  equipment: 'Equipamento',
  personnel: 'Pessoal',
  procedure: 'Procedimento',
  environment: 'Ambiente',
  other: 'Outro',
}

function parseCapaStatusFilter(value: string | null): CapaStatus | '' {
  switch (value) {
    case 'OPEN':
    case 'INVESTIGATION':
    case 'IMPLEMENTATION':
    case 'VERIFICATION':
    case 'CLOSED':
      return value
    default:
      return ''
  }
}

function parseCapaSeverityFilter(value: string | null): CapaSeverity | '' {
  switch (value) {
    case 'minor':
    case 'major':
    case 'critical':
      return value
    default:
      return ''
  }
}

function parseCapaCategoryFilter(value: string | null): CapaCategory | '' {
  switch (value) {
    case 'method':
    case 'equipment':
    case 'personnel':
    case 'procedure':
    case 'environment':
    case 'other':
      return value
    default:
      return ''
  }
}

export function CAPAListPage() {
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
    parseAsStringLiteral([...CAPA_STATUSES, '']).withDefault(''),
  )
  const [severityFilter, setSeverityFilter] = useQueryState(
    'severity',
    parseAsStringLiteral([...CAPA_SEVERITIES, '']).withDefault(''),
  )
  const [categoryFilter, setCategoryFilter] = useQueryState(
    'category',
    parseAsStringLiteral([...CAPA_CATEGORIES, '']).withDefault(''),
  )

  const organizationId = activeOrganizationId ?? 'no-org'
  const canLoad =
    !cloudOnlyUnavailable &&
    Boolean(activeOrganizationId) &&
    !isContextSwitching

  const { data, isLoading, error } = useCapaListData({
    organizationId,
    page,
    search,
    statusFilter,
    severityFilter,
    categoryFilter,
    enabled: canLoad,
  })

  const { data: summary } = useCapaSummaryData({
    organizationId,
    enabled: canLoad,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  const getStatusCount = (status: string) =>
    summary?.byStatus.find((s) => s.status === status)?.count ?? 0

  const hasFilters = search || statusFilter || severityFilter || categoryFilter

  if (cloudOnlyUnavailable) {
    return <CloudOnlyOfflineState title="CAPA indisponível offline" />
  }

  if (isContextSwitching) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">
            Carregando o contexto da organização ativa.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar CAPAs: {error.message}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Abertas</CardDescription>
              <CardTitle className="text-2xl text-destructive">
                {getStatusCount('OPEN')}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Em Investigação</CardDescription>
              <CardTitle className="text-2xl text-yellow-600">
                {getStatusCount('INVESTIGATION')}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Implementação</CardDescription>
              <CardTitle className="text-2xl text-blue-600">
                {getStatusCount('IMPLEMENTATION')}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Atrasadas</CardDescription>
              <CardTitle className="text-2xl text-destructive">
                {summary.overdue}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Taxa Eficácia</CardDescription>
              <CardTitle className="text-2xl text-green-600">
                {summary.effectivenessRate}%
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Ações Corretivas (CAPA)</CardTitle>
            <CardDescription>
              Ações corretivas e preventivas - ISO 17025 Cláusula 8.2
            </CardDescription>
          </div>
          <Button
            render={
              <Link to="/dashboard/capa/new">
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                Nova CAPA
              </Link>
            }
          />
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <form onSubmit={handleSearch} className="flex flex-wrap gap-4 mb-6">
            <Input
              placeholder="Buscar por número ou título..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(parseCapaStatusFilter(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="w-48">
                <span>
                  {statusFilter
                    ? STATUS_LABELS[statusFilter]
                    : 'Todos os Status'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os Status</SelectItem>
                <SelectItem value="OPEN">Abertas</SelectItem>
                <SelectItem value="INVESTIGATION">Em Investigação</SelectItem>
                <SelectItem value="IMPLEMENTATION">Implementação</SelectItem>
                <SelectItem value="VERIFICATION">Verificação</SelectItem>
                <SelectItem value="CLOSED">Fechadas</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={severityFilter}
              onValueChange={(v) => {
                setSeverityFilter(parseCapaSeverityFilter(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="w-40">
                <span>
                  {severityFilter
                    ? SEVERITY_LABELS[severityFilter]
                    : 'Severidade'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todas</SelectItem>
                <SelectItem value="minor">Menor</SelectItem>
                <SelectItem value="major">Maior</SelectItem>
                <SelectItem value="critical">Crítica</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={categoryFilter}
              onValueChange={(v) => {
                setCategoryFilter(parseCapaCategoryFilter(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="w-40">
                <span>
                  {categoryFilter
                    ? CATEGORY_LABELS[categoryFilter]
                    : 'Categoria'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todas</SelectItem>
                <SelectItem value="method">Método</SelectItem>
                <SelectItem value="equipment">Equipamento</SelectItem>
                <SelectItem value="personnel">Pessoal</SelectItem>
                <SelectItem value="procedure">Procedimento</SelectItem>
                <SelectItem value="environment">Ambiente</SelectItem>
                <SelectItem value="other">Outro</SelectItem>
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
                <EmptyTitle>Nenhuma CAPA encontrada</EmptyTitle>
                <EmptyDescription>
                  {hasFilters
                    ? 'Nenhuma CAPA encontrada para os filtros aplicados.'
                    : 'Comece registrando sua primeira ação corretiva para atender a ISO 17025 Cláusula 8.2.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!hasFilters && (
                  <Button render={<Link to="/dashboard/capa/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Nova CAPA
                  </Button>
                )}
                {hasFilters && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('')
                      setSeverityFilter('')
                      setCategoryFilter('')
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
              columns={capaColumns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
