import { Link, createFileRoute, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
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

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { DataTable } from '@/components/ui/data-table'
import { cn } from '@/lib/utils'
import { jobRouteId } from '@/lib/route-identifiers'
import {
  ClientPanel,
  ClientPanelBody,
  Toolbar,
} from './-components/client-detail-ui'

export const Route = createFileRoute('/dashboard/clients/$id/calibrations')({
  component: ClientCalibrationsTab,
})

type JobStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'GENERATING_PDF'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'SUPERSEDED'

type Job = {
  id: number
  jobId: string
  status: JobStatus
  performedAt: string | null
  approvedAt: string | null
  createdAt: string
  assetName: string | null
  assetTag: string | null
  serviceName: string | null
  technicianName: string | null
  methodName: string | null
  methodVersion: number | null
}

const statusLabels: Record<JobStatus, string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em Execução',
  REVIEW: 'Em Revisão',
  GENERATING_PDF: 'Gerando PDF',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CANCELED: 'Cancelado',
  SUPERSEDED: 'Retificado',
}

const statusVariants: Record<
  JobStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  DRAFT: 'secondary',
  IN_PROGRESS: 'default',
  REVIEW: 'outline',
  GENERATING_PDF: 'outline',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CANCELED: 'secondary',
  SUPERSEDED: 'outline',
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR')
}

function formatJobDate(job: Job): string {
  return formatDate(job.performedAt ?? job.approvedAt ?? job.createdAt)
}

function LoadingDots() {
  return (
    <span className="inline-flex" aria-hidden="true">
      <span
        className="animate-[bounce_1s_ease-in-out_infinite]"
        style={{ animationDelay: '0ms' }}
      >
        .
      </span>
      <span
        className="animate-[bounce_1s_ease-in-out_infinite]"
        style={{ animationDelay: '150ms' }}
      >
        .
      </span>
      <span
        className="animate-[bounce_1s_ease-in-out_infinite]"
        style={{ animationDelay: '300ms' }}
      >
        .
      </span>
    </span>
  )
}

const calibrationColumns: ColumnDef<Job>[] = [
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
      const status = row.original.status
      const isGenerating = status === 'GENERATING_PDF'

      return (
        <Badge
          variant={statusVariants[status]}
          className={
            isGenerating
              ? 'bg-amber-100 text-amber-700 border-amber-300 animate-pulse dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700'
              : ''
          }
        >
          {isGenerating ? (
            <span className="inline-flex">
              <span className="animate-[ellipsis_1.5s_infinite]">
                Gerando PDF
              </span>
              <span className="w-4 text-left">
                <LoadingDots />
              </span>
            </span>
          ) : (
            statusLabels[status]
          )}
        </Badge>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
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

function ClientCalibrationsTab() {
  const { id } = useParams({ from: '/dashboard/clients/$id/calibrations' })

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<JobStatus | ''>('')

  const limit = 20

  const { data: customer } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      return calibraApi.customers.get<{ id: number }>(id)
    },
  })

  const customerId = customer?.id

  const { data, isLoading, error } = useQuery({
    queryKey: ['jobs', 'customer', customerId, page, search, statusFilter],
    queryFn: async () => {
      return calibraApi.jobs.list({
        page,
        limit,
        customerId,
        query: search || undefined,
        status: statusFilter || undefined,
      }) as Promise<{
        data: Array<Job>
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }>
    },
    enabled: customerId !== undefined,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  return (
    <ClientPanel
      eyebrow="Calibrações"
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
                setStatusFilter(value as JobStatus | '')
                setPage(1)
              }}
            >
              <SelectTrigger className="w-44">
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
                <SelectItem value="SUPERSEDED">Retificado</SelectItem>
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
