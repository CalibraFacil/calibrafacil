import { Link } from '@tanstack/react-router'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from 'nuqs'
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
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { DataTable } from '@/components/ui/data-table'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { JOBS_LIST_STATUSES, type JobsListStatus } from '@/features/jobs/types'
import { useJobsListData } from '@/features/jobs/use-jobs-list-data'
import { jobsColumns } from '@/features/jobs/components/columns'

const statusLabels: Record<(typeof JOBS_LIST_STATUSES)[number], string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em Execução',
  REVIEW: 'Em Revisão',
  GENERATING_PDF: 'Gerando PDF',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CANCELED: 'Cancelado',
}

export function JobsListPage() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useQueryState(
    'query',
    parseAsString.withDefault(''),
  )
  const [statusFilter, setStatusFilter] = useQueryState(
    'status',
    parseAsStringLiteral([...JOBS_LIST_STATUSES, '']).withDefault(''),
  )

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
          Erro ao carregar calibrações: {error.message}
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Calibrações
          </h1>
          <p className="mt-0.5 max-w-2xl text-pretty text-sm text-muted-foreground">
            Gerencie ordens de calibração e a emissão de certificados.
          </p>
        </div>
        <Button
          render={<Link to="/dashboard/jobs/new" />}
          className={`${ACTION_BUTTON_CLASS} shrink-0`}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
          Nova Calibração
        </Button>
      </div>

      <Panel className="p-4 sm:p-5">
        <div>
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
                // oxlint-disable-next-line typescript/consistent-type-assertions -- Select options are limited to job list statuses.
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
        </div>
      </Panel>
    </div>
  )
}
