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
import { type NonConformanceRow, ncColumns } from './-components/columns'

export const Route = createFileRoute('/dashboard/nc/')({
  head: () => ({
    meta: [{ title: 'Nao Conformidades | CalibraFacil' }],
  }),
  component: NCListPage,
})

type StatusFilter = 'open' | 'under_review' | 'resolved' | ''
type TypeFilter = 'work' | 'equipment' | 'documentation' | ''

function NCListPage() {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('')

  const limit = 20

  const { data, isLoading, error } = useQuery({
    queryKey: ['non-conformances', page, search, statusFilter, typeFilter],
    queryFn: async () => {
      const res = await api.api.nc.$get({
        query: {
          page: String(page),
          limit: String(limit),
          query: search || undefined,
          status: statusFilter || undefined,
          type: typeFilter || undefined,
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar nao conformidades')
      }

      return res.json() as Promise<{
        data: Array<NonConformanceRow>
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
    queryKey: ['non-conformances-summary'],
    queryFn: async () => {
      const res = await api.api.nc.summary.$get()
      if (!res.ok) throw new Error('Falha ao carregar resumo')
      return res.json() as Promise<{
        byStatus: Array<{ status: string; count: number }>
        byType: Array<{ type: string; count: number }>
        ageBrackets: { lessThan7Days: number; moreThan30Days: number }
      }>
    },
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  const openCount =
    summary?.byStatus.find((s) => s.status === 'open')?.count ?? 0
  const reviewCount =
    summary?.byStatus.find((s) => s.status === 'under_review')?.count ?? 0

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar nao conformidades: {error.message}
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
              <CardDescription>Em Analise</CardDescription>
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
            <CardTitle>Nao Conformidades</CardTitle>
            <CardDescription>
              Controle de trabalhos nao conformes - ISO 17025 Clausula 8.7
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
              placeholder="Buscar por numero ou descricao..."
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
                  {statusFilter === 'open'
                    ? 'Abertas'
                    : statusFilter === 'under_review'
                      ? 'Em Analise'
                      : statusFilter === 'resolved'
                        ? 'Resolvidas'
                        : 'Todos os Status'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os Status</SelectItem>
                <SelectItem value="open">Abertas</SelectItem>
                <SelectItem value="under_review">Em Analise</SelectItem>
                <SelectItem value="resolved">Resolvidas</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v as TypeFilter)
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
                        ? 'Documentacao'
                        : 'Todos os Tipos'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os Tipos</SelectItem>
                <SelectItem value="work">Trabalho</SelectItem>
                <SelectItem value="equipment">Equipamento</SelectItem>
                <SelectItem value="documentation">Documentacao</SelectItem>
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
                <EmptyTitle>Nenhuma nao conformidade encontrada</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter || typeFilter
                    ? 'Nenhuma NC encontrada para os filtros aplicados.'
                    : 'Nenhuma nao conformidade registrada ainda.'}
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
