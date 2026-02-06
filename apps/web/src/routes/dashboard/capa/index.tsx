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

function CAPAListPage() {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('')

  const limit = 20

  const { data, isLoading } = useQuery({
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

  const getStatusCount = (status: string) =>
    summary?.byStatus.find((s) => s.status === status)?.count ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Ações Corretivas (CAPA)
          </h1>
          <p className="text-muted-foreground">
            ISO 17025 Cláusula 8.2 - Ações corretivas e preventivas
          </p>
        </div>
        <Button render={<Link to="/dashboard/capa/new" />}>
          <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
          Nova CAPA
        </Button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Abertas</CardDescription>
              <CardTitle className="text-2xl text-red-600">
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
              <CardTitle className="text-2xl text-red-700">
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

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Buscar por número ou título..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          className="max-w-xs"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as StatusFilter)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[180px]">
            {statusFilter
              ? {
                  OPEN: 'Aberta',
                  INVESTIGATION: 'Investigação',
                  IMPLEMENTATION: 'Implementação',
                  VERIFICATION: 'Verificação',
                  CLOSED: 'Fechada',
                }[statusFilter]
              : 'Todos os status'}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos os status</SelectItem>
            <SelectItem value="OPEN">Aberta</SelectItem>
            <SelectItem value="INVESTIGATION">Investigação</SelectItem>
            <SelectItem value="IMPLEMENTATION">Implementação</SelectItem>
            <SelectItem value="VERIFICATION">Verificação</SelectItem>
            <SelectItem value="CLOSED">Fechada</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={severityFilter}
          onValueChange={(v) => {
            setSeverityFilter(v as SeverityFilter)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[160px]">
            {severityFilter
              ? { minor: 'Menor', major: 'Maior', critical: 'Crítica' }[
                  severityFilter
                ]
              : 'Severidade'}
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
          <SelectTrigger className="w-[160px]">
            {categoryFilter
              ? {
                  method: 'Método',
                  equipment: 'Equipamento',
                  personnel: 'Pessoal',
                  procedure: 'Procedimento',
                  environment: 'Ambiente',
                  other: 'Outro',
                }[categoryFilter]
              : 'Categoria'}
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
      </div>

      {/* Data Table */}
      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Carregando...
          </CardContent>
        </Card>
      ) : data && data.data.length > 0 ? (
        <DataTable
          columns={capaColumns}
          data={data.data}
          pagination={data.pagination}
          onPageChange={setPage}
        />
      ) : (
        <Empty>
          <EmptyMedia>
            <HugeiconsIcon
              icon={AlertCircleIcon}
              className="h-12 w-12 text-muted-foreground"
            />
          </EmptyMedia>
          <EmptyContent>
            <EmptyHeader>
              <EmptyTitle>Nenhuma CAPA encontrada</EmptyTitle>
              <EmptyDescription>
                {search || statusFilter || severityFilter || categoryFilter
                  ? 'Nenhum resultado para os filtros selecionados.'
                  : 'Comece registrando sua primeira ação corretiva para atender a ISO 17025 Cláusula 8.2.'}
              </EmptyDescription>
            </EmptyHeader>
            {!search && !statusFilter && !severityFilter && !categoryFilter && (
              <Button render={<Link to="/dashboard/capa/new" />}>
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                Nova CAPA
              </Button>
            )}
          </EmptyContent>
        </Empty>
      )}
    </div>
  )
}
