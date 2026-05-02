import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { parseAsInteger, useQueryState } from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import { ClipboardIcon, PlusSignIcon } from '@hugeicons/core-free-icons'

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
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { jobsColumns } from './-components/columns'
import { loadJobsIndexData, type JobsListStatus } from './-index.data'
import { useJobsListData } from './-index.db'

export const Route = createFileRoute('/dashboard/jobs/')({
  loader: ({ context }) => loadJobsIndexData(context.queryClient),
  head: () => ({
    meta: [{ title: 'Calibrações | CalibraFacil' }],
  }),
  component: JobsListPage,
})

const statusLabels: Record<JobsListStatus, string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em Execução',
  REVIEW: 'Em Revisão',
  GENERATING_PDF: 'Gerando PDF',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CANCELED: 'Cancelado',
}

function JobsListPage() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<JobsListStatus | ''>('')

  const { data, isLoading, error } = useJobsListData({
    activeOrganizationId,
    enabled: !isContextSwitching,
    page,
    search,
    statusFilter,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
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
            Erro ao carregar calibrações: {error.message}
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
            <CardTitle>Calibrações</CardTitle>
            <CardDescription>
              Gerencie jobs de calibração e emissão de certificados
            </CardDescription>
          </div>
          <Button
            render={
              <Link to="/dashboard/jobs/new">
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                Nova Calibração
              </Link>
            }
          />
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <form onSubmit={handleSearch} className="flex gap-4 mb-6">
            <Input
              placeholder="Buscar por número da calibração..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as JobsListStatus | '')
                setPage(1)
              }}
            >
              <SelectTrigger className="w-40">
                <span>
                  {statusFilter ? statusLabels[statusFilter] : 'Todos'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos</SelectItem>
                <SelectItem value="DRAFT">Rascunho</SelectItem>
                <SelectItem value="IN_PROGRESS">Em Execução</SelectItem>
                <SelectItem value="REVIEW">Em Revisão</SelectItem>
                <SelectItem value="GENERATING_PDF">Gerando PDF</SelectItem>
                <SelectItem value="APPROVED">Aprovado</SelectItem>
                <SelectItem value="REJECTED">Rejeitado</SelectItem>
                <SelectItem value="CANCELED">Cancelado</SelectItem>
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
                  <HugeiconsIcon icon={ClipboardIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhuma calibração encontrada</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter
                    ? 'Nenhuma ordem encontrada para os filtros aplicados.'
                    : 'Comece criando sua primeira calibração'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && !statusFilter && (
                  <Button render={<Link to="/dashboard/jobs/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Nova Calibração
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
              columns={jobsColumns}
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
