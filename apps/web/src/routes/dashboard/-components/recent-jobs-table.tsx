import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  ViewIcon,
  ArrowRight02Icon,
} from '@hugeicons/core-free-icons'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { jobRouteId } from '@/lib/route-identifiers'

type JobStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'GENERATING_PDF'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'SUPERSEDED'

interface RecentJob {
  id: number
  jobId: string
  customerName: string | null
  assetName: string | null
  serviceName: string | null
  technicianName: string | null
  status: JobStatus
  dueDate: string | null
  isOverdue: boolean | null
  createdAt: string
}

interface RecentJobsTableProps {
  jobs: RecentJob[]
  isLoading?: boolean
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

export function RecentJobsTable({ jobs, isLoading }: RecentJobsTableProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-40 mt-1" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ordens de Serviço Recentes</CardTitle>
        <CardDescription>Últimas 10 ordens de calibração</CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/dashboard/jobs" />}
          >
            Ver Todas
            <HugeiconsIcon icon={ArrowRight02Icon} className="ml-1 size-4" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Nenhuma ordem de serviço encontrada
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OS</TableHead>
                <TableHead className="hidden sm:table-cell">Cliente</TableHead>
                <TableHead className="hidden md:table-cell">Ativo</TableHead>
                <TableHead className="hidden lg:table-cell">Prazo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-mono font-medium">
                    <Link
                      to="/dashboard/jobs/$id"
                      params={{ id: jobRouteId(job) }}
                      className="hover:underline"
                    >
                      {job.jobId}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {job.customerName || '-'}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {job.assetName || '-'}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex items-center gap-2">
                      {job.isOverdue && (
                        <HugeiconsIcon
                          icon={AlertCircleIcon}
                          className="h-4 w-4 text-destructive"
                        />
                      )}
                      <span
                        className={
                          job.isOverdue ? 'text-destructive font-medium' : ''
                        }
                      >
                        {formatDate(job.dueDate)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={job.status} />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      render={
                        <Link
                          to="/dashboard/jobs/$id"
                          params={{ id: jobRouteId(job) }}
                        />
                      }
                    >
                      <HugeiconsIcon icon={ViewIcon} className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: JobStatus }) {
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
      {isGenerating ? 'Gerando...' : statusLabels[status]}
    </Badge>
  )
}
