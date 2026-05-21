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
            Erro ao carregar não conformidades: {error.message}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Abertas</CardDescription>
              <CardTitle className="text-2xl text-destructive">
                {openCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Em Análise</CardDescription>
              <CardTitle className="text-2xl text-orange-600">
                {reviewCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Abertas &gt; 30 dias</CardDescription>
              <CardTitle className="text-2xl text-destructive">
                {summary.ageBrackets.moreThan30Days}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Abertas por Tipo</CardDescription>
              <CardTitle className="text-sm">
                {summary.byType.map((t) => (
                  <span key={t.type} className="mr-3">
                    {t.type === 'work'
                      ? 'Trabalho'
                      : t.type === 'equipment'
                        ? 'Equipamento'
                        : 'Doc'}{' '}
                    ({t.count})
                  </span>
                ))}
                {summary.byType.length === 0 && (
                  <span className="text-muted-foreground">Nenhuma</span>
                )}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Não Conformidades</CardTitle>
            <CardDescription>
              Controle de trabalhos não conformes - ISO 17025 Cláusula 8.7
            </CardDescription>
          </div>
          <Button
            render={
              <Link to="/dashboard/nc/new">
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                Registrar NC
              </Link>
            }
          />
        </CardHeader>
        <CardContent>
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
                setStatusFilter(v as NonConformanceStatus | '')
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
                setTypeFilter(v as NonConformanceType | '')
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
        </CardContent>
      </Card>
    </div>
  )
}
