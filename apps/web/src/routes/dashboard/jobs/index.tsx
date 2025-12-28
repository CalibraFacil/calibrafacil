import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { parseAsInteger, useQueryState } from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  Calendar03Icon,
  ClipboardIcon,
  MoreHorizontalIcon,
  PlusSignIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

export const Route = createFileRoute('/dashboard/jobs/')({
  head: () => ({
    meta: [{ title: 'Ordens de Servico | CalibraFacil' }],
  }),
  component: JobsListPage,
})

type JobStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'

interface Job {
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
}

const statusLabels: Record<JobStatus, string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em Execucao',
  REVIEW: 'Em Revisao',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CANCELED: 'Cancelado',
}

const statusVariants: Record<
  JobStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  DRAFT: 'secondary',
  IN_PROGRESS: 'default',
  REVIEW: 'outline',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CANCELED: 'secondary',
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR')
}

function JobsListPage() {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<JobStatus | ''>('')

  const limit = 20

  // Fetch jobs
  const { data, isLoading, error } = useQuery({
    queryKey: ['jobs', page, search, statusFilter],
    queryFn: async () => {
      const res = await api.api.jobs.$get({
        query: {
          page: String(page),
          limit: String(limit),
          query: search || undefined,
          status: statusFilter || undefined,
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar ordens de servico')
      }

      return res.json() as Promise<{
        data: Array<Job>
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }>
    },
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar ordens de servico: {error.message}
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
            <CardTitle>Ordens de Servico</CardTitle>
            <CardDescription>
              Gerencie as calibracoes do laboratorio
            </CardDescription>
          </div>
          <Button
            render={
              <Link to="/dashboard/jobs/new">
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                Nova Ordem
              </Link>
            }
          />
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <form onSubmit={handleSearch} className="flex gap-4 mb-6">
            <Input
              placeholder="Buscar por numero da OS..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as JobStatus | '')
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
                <SelectItem value="IN_PROGRESS">Em Execucao</SelectItem>
                <SelectItem value="REVIEW">Em Revisao</SelectItem>
                <SelectItem value="APPROVED">Aprovado</SelectItem>
                <SelectItem value="REJECTED">Rejeitado</SelectItem>
                <SelectItem value="CANCELED">Cancelado</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" variant="secondary">
              Buscar
            </Button>
          </form>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : data?.data.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={ClipboardIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhuma ordem de servico encontrada</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter
                    ? 'Nenhuma ordem encontrada para os filtros aplicados.'
                    : 'Comece criando sua primeira ordem de servico'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && !statusFilter && (
                  <Button render={<Link to="/dashboard/jobs/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Nova Ordem
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
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>OS</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead>Servico</TableHead>
                    <TableHead>Tecnico</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((job) => (
                    <TableRow
                      key={job.id}
                      className={job.status === 'CANCELED' ? 'opacity-60' : ''}
                    >
                      <TableCell>
                        <Link
                          to="/dashboard/jobs/$id"
                          params={{ id: String(job.id) }}
                          className="font-mono font-medium hover:underline"
                        >
                          {job.jobId}
                        </Link>
                      </TableCell>
                      <TableCell>{job.customerName || '-'}</TableCell>
                      <TableCell>
                        <div>
                          <span className="font-medium">{job.assetName}</span>
                          {job.assetTag && (
                            <span className="text-sm text-muted-foreground ml-2">
                              ({job.assetTag})
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {job.serviceName || '-'}
                        {job.methodName && (
                          <span className="block text-xs text-muted-foreground">
                            {job.methodName} v{job.methodVersion}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {job.technicianName || (
                          <span className="text-muted-foreground italic">
                            Nao atribuido
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {job.isOverdue && (
                            <HugeiconsIcon
                              icon={AlertCircleIcon}
                              className="h-4 w-4 text-destructive"
                            />
                          )}
                          <span
                            className={
                              job.isOverdue
                                ? 'text-destructive font-medium'
                                : ''
                            }
                          >
                            {formatDate(job.dueDate)}
                          </span>
                          {job.daysUntilDue !== null &&
                            job.daysUntilDue <= 7 &&
                            job.daysUntilDue > 0 && (
                              <Badge variant="outline" className="text-xs">
                                {job.daysUntilDue}d
                              </Badge>
                            )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariants[job.status]}>
                          {statusLabels[job.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon" />}
                          >
                            <HugeiconsIcon
                              icon={MoreHorizontalIcon}
                              className="h-4 w-4"
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              render={() => (
                                <Link
                                  to="/dashboard/jobs/$id"
                                  params={{ id: String(job.id) }}
                                >
                                  <HugeiconsIcon
                                    icon={ViewIcon}
                                    className="mr-2 h-4 w-4"
                                  />
                                  Ver Detalhes
                                </Link>
                              )}
                            />
                            {job.status === 'DRAFT' && (
                              <DropdownMenuItem
                                render={() => (
                                  <Link
                                    to="/dashboard/jobs/$id"
                                    params={{ id: String(job.id) }}
                                  >
                                    <HugeiconsIcon
                                      icon={Calendar03Icon}
                                      className="mr-2 h-4 w-4"
                                    />
                                    Iniciar Execucao
                                  </Link>
                                )}
                              />
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {data && data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Mostrando{' '}
                    {(data.pagination.page - 1) * data.pagination.limit + 1} a{' '}
                    {Math.min(
                      data.pagination.page * data.pagination.limit,
                      data.pagination.total,
                    )}{' '}
                    de {data.pagination.total} ordens
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page - 1)}
                      disabled={page === 1}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page + 1)}
                      disabled={page >= data.pagination.totalPages}
                    >
                      Proximo
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
