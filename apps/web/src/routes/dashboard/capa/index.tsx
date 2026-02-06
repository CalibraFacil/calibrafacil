import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { parseAsInteger, useQueryState } from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon, AlertCircleIcon } from '@hugeicons/core-free-icons'

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
import { type CAPARow, capaColumns } from './-components/columns'

export const Route = createFileRoute('/dashboard/capa/')({
  head: () => ({
    meta: [{ title: 'Ações Corretivas (CAPA) | CalibraFacil' }],
  }),
  component: CAPAListPage,
})

type StatusFilter =
  | 'OPEN'
  | 'INVESTIGATION'
  | 'IMPLEMENTATION'
  | 'VERIFICATION'
  | 'CLOSED'
  | ''
type SeverityFilter = 'minor' | 'major' | 'critical' | ''
type CategoryFilter =
  | 'method'
  | 'equipment'
  | 'personnel'
  | 'procedure'
  | 'environment'
  | 'other'
  | ''

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

function CAPAListPage() {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('')

  const limit = 20

  const { data, isLoading, error } = useQuery({
    queryKey: [
      'capas',
      page,
      search,
      statusFilter,
      severityFilter,
      categoryFilter,
    ],
    queryFn: async () => {
      const res = await api.api.capa.$get({
        query: {
          page: String(page),
          limit: String(limit),
          query: search || undefined,
          status: statusFilter || undefined,
          severity: severityFilter || undefined,
          category: categoryFilter || undefined,
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar CAPAs')
      }

      return res.json() as Promise<{
        data: Array<CAPARow>
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }>
    },
  })

  const { data: summary } = useQuery({
    queryKey: ['capas-summary'],
    queryFn: async () => {
      const res = await api.api.capa.summary.$get()
      if (!res.ok) throw new Error('Falha ao carregar resumo')
      return res.json() as Promise<{
        byStatus: Array<{ status: string; count: number }>
        bySeverity: Array<{ severity: string; count: number }>
        byCategory: Array<{ category: string; count: number }>
        overdue: number
        effectivenessRate: number
        totalClosed: number
      }>
    },
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  const getStatusCount = (status: string) =>
    summary?.byStatus.find((s) => s.status === status)?.count ?? 0

  const hasFilters = search || statusFilter || severityFilter || categoryFilter

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
                setStatusFilter(v as StatusFilter)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-48">
                <span>
                  {statusFilter ? STATUS_LABELS[statusFilter] : 'Todos os Status'}
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
                setSeverityFilter(v as SeverityFilter)
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
                setCategoryFilter(v as CategoryFilter)
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
