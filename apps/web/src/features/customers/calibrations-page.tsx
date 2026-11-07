import type { JobStatus } from '@calibra-facil/schemas'
import { JOB_STATUS } from '@calibra-facil/schemas'
import { JobStatusBadge } from '@/features/jobs/components/job-status-badge'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Calendar03Icon,
  Certificate01Icon,
  MoreHorizontalIcon,
  Search01Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons'

import {
  useCustomerDetailData,
  useCustomerJobsData,
} from '@/features/customers/queries'
import type { CustomerJob } from '@/features/customers/types'
import { Button } from '@calibra-facil/ui/button'
import { Input } from '@calibra-facil/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@calibra-facil/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@calibra-facil/ui/select'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@calibra-facil/ui/empty'
import { DataTable } from '@calibra-facil/ui/data-table'
import { cn } from '@/lib/utils'
import { jobRouteId } from '@/lib/route-identifiers'
import {
  ClientPanel,
  ClientPanelBody,
  Toolbar,
} from '@/features/customers/components/client-detail-ui'
import { formatInstant } from '@calibra-facil/shared/format'

function formatJobDate(job: CustomerJob): string {
  return formatInstant(
    job.performedAt ?? job.approvedAt ?? job.createdAt,
    'date',
  )
}

const calibrationColumns: ColumnDef<CustomerJob>[] = [
  {
    accessorKey: 'jobId',
    header: 'Calibração',
    cell: ({ row }) => (
      <Link
        to="/dashboard/jobs/$id"
        params={{ id: jobRouteId(row.original) }}
        className="font-mono font-medium hover:underline"
      >
        {row.original.jobId}
      </Link>
    ),
  },
  {
    accessorKey: 'assetName',
    header: 'Ativo',
    cell: ({ row }) => (
      <div>
        <span className="font-medium">{row.original.assetName || '-'}</span>
        {row.original.assetTag && (
          <span className="text-sm text-muted-foreground ml-2">
            ({row.original.assetTag})
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'serviceName',
    header: 'Serviço',
    cell: ({ row }) => (
      <div>
        {row.original.serviceName || '-'}
        {row.original.methodName && (
          <span className="block text-xs text-muted-foreground">
            {row.original.methodName} v{row.original.methodVersion}
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'technicianName',
    header: 'Técnico',
    cell: ({ row }) =>
      row.original.technicianName || (
        <span className="text-muted-foreground italic">Não atribuído</span>
      ),
  },
  {
    id: 'date',
    header: 'Data',
    cell: ({ row }) => formatJobDate(row.original),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      return <JobStatusBadge status={row.original.status} />
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Mais ações" />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            render={(props) => (
              <Link
                {...props}
                to="/dashboard/jobs/$id"
                params={{ id: jobRouteId(row.original) }}
                className={cn(props.className, 'w-full flex items-center')}
              >
                <HugeiconsIcon icon={ViewIcon} className="mr-2 h-4 w-4" />
                Ver Detalhes
              </Link>
            )}
          />
          {row.original.status === 'DRAFT' && (
            <DropdownMenuItem
              render={(props) => (
                <Link
                  {...props}
                  to="/dashboard/jobs/$id/execute"
                  params={{ id: jobRouteId(row.original) }}
                  className={cn(props.className, 'w-full flex items-center')}
                >
                  <HugeiconsIcon
                    icon={Calendar03Icon}
                    className="mr-2 h-4 w-4"
                  />
                  Iniciar Execução
                </Link>
              )}
            />
          )}
          {(row.original.status === 'IN_PROGRESS' ||
            row.original.status === 'REJECTED') && (
            <DropdownMenuItem
              render={(props) => (
                <Link
                  {...props}
                  to="/dashboard/jobs/$id/execute"
                  params={{ id: jobRouteId(row.original) }}
                  className={cn(props.className, 'w-full flex items-center')}
                >
                  <HugeiconsIcon
                    icon={Calendar03Icon}
                    className="mr-2 h-4 w-4"
                  />
                  Continuar Execução
                </Link>
              )}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
]

export function ClientCalibrationsTab({ id }: { id: string }) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<JobStatus | ''>('')

  const limit = 20

  const { data: customer } = useCustomerDetailData(id)

  const customerId = customer?.id

  const { data, isLoading, error } = useCustomerJobsData({
    customerId,
    page,
    limit,
    search,
    statusFilter,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  return (
    <ClientPanel
      title="Histórico de Calibrações"
      description="Acompanhe ordens, certificados e execuções vinculadas a este cliente."
      icon={<HugeiconsIcon icon={Certificate01Icon} className="size-5" />}
    >
      <ClientPanelBody>
        <form onSubmit={handleSearch}>
          <Toolbar>
            <div className="relative max-w-sm flex-1">
              <HugeiconsIcon
                icon={Search01Icon}
                className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                placeholder="Buscar por número da calibração…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(JOB_STATUS.parse(value) ?? '')
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Filtrar por status" className="w-44">
                <span>
                  {statusFilter ? JOB_STATUS.label(statusFilter) : 'Todos'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos</SelectItem>
                {JOB_STATUS.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" variant="secondary">
              Buscar
            </Button>
          </Toolbar>
        </form>

        {error && (
          <div className="py-8 text-center text-sm text-destructive">
            Erro ao carregar calibrações. Tente novamente.
          </div>
        )}

        {!isLoading && !error && data?.data.length === 0 ? (
          <Empty className="rounded-none border-x-0 border-y border-solid border-border/70 py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Certificate01Icon} />
              </EmptyMedia>
              <EmptyTitle>Nenhuma calibração encontrada</EmptyTitle>
              <EmptyDescription>
                {search || statusFilter
                  ? 'Nenhuma calibração corresponde aos filtros aplicados.'
                  : 'Este cliente ainda não possui calibrações.'}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent />
          </Empty>
        ) : (
          !error && (
            <DataTable
              columns={calibrationColumns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={setPage}
            />
          )
        )}
      </ClientPanelBody>
    </ClientPanel>
  )
}
