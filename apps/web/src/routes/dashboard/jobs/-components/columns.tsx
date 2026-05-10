import { type ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  Calendar03Icon,
  MoreHorizontalIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SyncStateBadge } from '@/components/sync-state-badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { getFinancialStatusLabel } from '@calibra-facil/shared'
import { jobRouteId } from '@/lib/route-identifiers'
import { usePathPrewarmIntent } from '@/lib/use-route-prewarm-intent'

// Animated dots for loading states
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

type JobStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'GENERATING_PDF'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'SUPERSEDED'

export interface Job {
  id: number
  jobId: string
  status: JobStatus
  dueDate: string | null
  performedAt: string | null
  createdAt: string
  updatedAt: string
  approvedAt: string | null
  customerId: number
  customerName: string | null
  assetId: number
  assetName: string | null
  assetTag: string | null
  serviceId: number
  serviceName: string | null
  technicianId: string | null
  technicianName: string | null
  methodName: string | null
  methodVersion: number | null
  isOverdue: boolean | null
  daysUntilDue: number | null
  financialStatus?: 'UNBILLED' | 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE'
  invoiceDocumentNumber?: string | null
  invoiceEligibility?: boolean
  overdueBalanceFlag?: boolean
  syncState?: string | null
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

function getFinancialVariant(status: Job['financialStatus']) {
  switch (status) {
    case 'PAID':
      return 'outline'
    case 'OVERDUE':
      return 'destructive'
    case 'ISSUED':
      return 'default'
    case 'DRAFT':
      return 'secondary'
    case 'UNBILLED':
    default:
      return 'secondary'
  }
}

function jobDetailPath(job: Job) {
  return `/dashboard/jobs/${encodeURIComponent(jobRouteId(job))}`
}

function jobExecutePath(job: Job) {
  return `${jobDetailPath(job)}/execute`
}

function JobDetailLink({ job }: { job: Job }) {
  const routeId = jobRouteId(job)
  const prewarmIntentHandlers = usePathPrewarmIntent(jobDetailPath(job))

  return (
    <Link
      to="/dashboard/jobs/$id"
      params={{ id: routeId }}
      className="font-mono font-medium hover:underline"
      preload="intent"
      {...prewarmIntentHandlers}
    >
      {job.jobId}
    </Link>
  )
}

function JobDropdownLink({
  job,
  to,
  linkProps,
  className,
  children,
}: {
  job: Job
  to: '/dashboard/jobs/$id' | '/dashboard/jobs/$id/execute'
  linkProps?: ComponentPropsWithoutRef<'a'>
  className?: string
  children: ReactNode
}) {
  const routeId = jobRouteId(job)
  const prewarmIntentHandlers = usePathPrewarmIntent(
    to.endsWith('/execute') ? jobExecutePath(job) : jobDetailPath(job),
  )

  return (
    <Link
      {...linkProps}
      to={to}
      params={{ id: routeId }}
      className={className}
      preload="intent"
      {...prewarmIntentHandlers}
    >
      {children}
    </Link>
  )
}

export const jobsColumns: ColumnDef<Job>[] = [
  {
    accessorKey: 'jobId',
    header: 'Calibração',
    cell: ({ row }) => <JobDetailLink job={row.original} />,
  },
  {
    accessorKey: 'customerName',
    header: 'Cliente',
    cell: ({ row }) => row.original.customerName || '-',
  },
  {
    accessorKey: 'assetName',
    header: 'Ativo',
    cell: ({ row }) => (
      <div>
        <span className="font-medium">{row.original.assetName}</span>
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
    accessorKey: 'dueDate',
    header: 'Prazo',
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        {row.original.isOverdue && (
          <HugeiconsIcon
            icon={AlertCircleIcon}
            className="h-4 w-4 text-destructive"
          />
        )}
        <span
          className={
            row.original.isOverdue ? 'text-destructive font-medium' : ''
          }
        >
          {formatDate(row.original.dueDate)}
        </span>
        {row.original.daysUntilDue !== null &&
          row.original.daysUntilDue <= 7 &&
          row.original.daysUntilDue > 0 && (
            <Badge variant="outline" className="text-xs">
              {row.original.daysUntilDue}d
            </Badge>
          )}
      </div>
    ),
  },
  {
    accessorKey: 'financialStatus',
    header: 'Financeiro',
    cell: ({ row }) => {
      const financialStatus = row.original.financialStatus ?? 'UNBILLED'

      return (
        <div>
          <Badge variant={getFinancialVariant(financialStatus)}>
            {getFinancialStatusLabel(financialStatus)}
          </Badge>
          {row.original.invoiceDocumentNumber && (
            <span className="block text-xs text-muted-foreground mt-1">
              {row.original.invoiceDocumentNumber}
            </span>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = row.original.status
      const isGenerating = status === 'GENERATING_PDF'

      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={statusVariants[status]}
            className={
              isGenerating
                ? 'bg-amber-100 text-amber-700 border-amber-300 animate-pulse dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700'
                : ''
            }
          >
            {isGenerating && (
              <span className="inline-flex">
                <span className="animate-[ellipsis_1.5s_infinite]">
                  Gerando PDF
                </span>
                <span className="w-4 text-left">
                  <LoadingDots />
                </span>
              </span>
            )}
            {!isGenerating && statusLabels[status]}
          </Badge>
          <SyncStateBadge syncState={row.original.syncState} />
        </div>
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
              <JobDropdownLink
                to="/dashboard/jobs/$id"
                job={row.original}
                linkProps={props}
                className={cn(props.className, 'w-full flex items-center')}
              >
                <HugeiconsIcon icon={ViewIcon} className="mr-2 h-4 w-4" />
                Ver Detalhes
              </JobDropdownLink>
            )}
          />
          {row.original.status === 'DRAFT' && (
            <DropdownMenuItem
              render={(props) => (
                <JobDropdownLink
                  to="/dashboard/jobs/$id/execute"
                  job={row.original}
                  linkProps={props}
                  className={cn(props.className, 'w-full flex items-center')}
                >
                  <HugeiconsIcon
                    icon={Calendar03Icon}
                    className="mr-2 h-4 w-4"
                  />
                  Iniciar Execução
                </JobDropdownLink>
              )}
            />
          )}
          {(row.original.status === 'IN_PROGRESS' ||
            row.original.status === 'REJECTED') && (
            <DropdownMenuItem
              render={(props) => (
                <JobDropdownLink
                  to="/dashboard/jobs/$id/execute"
                  job={row.original}
                  linkProps={props}
                  className={cn(props.className, 'w-full flex items-center')}
                >
                  <HugeiconsIcon
                    icon={Calendar03Icon}
                    className="mr-2 h-4 w-4"
                  />
                  Continuar Execução
                </JobDropdownLink>
              )}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
]
