import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { parseAsInteger, useQueryState } from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
  RefreshIcon,
  UserIcon,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'

export const Route = createFileRoute('/dashboard/standards/')({
  head: () => ({
    meta: [{ title: 'Padroes de Referencia | CalibraFacil' }],
  }),
  component: StandardsListPage,
})

interface ReferenceStandard {
  id: number
  name: string
  type: string | null
  serialNumber: string
  manufacturer: string | null
  model: string | null
  certificateNumber: string
  calibratedBy: string | null
  calibrationDate: string
  nextCalibrationDate: string
  referenceValue: number | null
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
  distribution: 'normal' | 'rectangular'
  drift: number | null
  certifiedValues: Array<{
    nominal: string
    value: number
    uncertainty: number
    unit: string
  }> | null
  status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_TOLERANCE' | 'SENT_FOR_CALIBRATION'
  isExpired: boolean
  daysUntilExpiry: number
  createdAt: string
  updatedAt: string
}

type StatusFilter =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'OUT_OF_TOLERANCE'
  | 'SENT_FOR_CALIBRATION'
  | ''

/**
 * Get badge variant and label for calibration status
 * Using available badge variants: default, secondary, destructive, outline
 */
function getCalibrationBadge(daysUntilExpiry: number, isExpired: boolean) {
  if (isExpired) {
    return { variant: 'destructive' as const, label: 'Vencido' }
  } else if (daysUntilExpiry <= 30) {
    return {
      variant: 'outline' as const,
      label: `${daysUntilExpiry} dias`,
      className: 'border-orange-500 text-orange-600',
    }
  } else {
    return {
      variant: 'outline' as const,
      label: 'Valido',
      className: 'border-green-500 text-green-600',
    }
  }
}

/**
 * Get badge variant and label for standard status
 */
function getStatusBadge(status: ReferenceStandard['status']) {
  switch (status) {
    case 'ACTIVE':
      return { variant: 'default' as const, label: 'Ativo' }
    case 'INACTIVE':
      return { variant: 'secondary' as const, label: 'Inativo' }
    case 'OUT_OF_TOLERANCE':
      return { variant: 'destructive' as const, label: 'Fora de Tolerancia' }
    case 'SENT_FOR_CALIBRATION':
      return { variant: 'outline' as const, label: 'Em Calibração' }
    default:
      return { variant: 'secondary' as const, label: status }
  }
}

/**
 * Format date to Brazilian format
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('pt-BR')
}

/**
 * Format uncertainty value with unit
 */
function formatUncertainty(standard: ReferenceStandard): string {
  if (standard.certifiedValues && standard.certifiedValues.length > 0) {
    return `${standard.certifiedValues.length} valores`
  }
  if (standard.uncertainty != null && standard.uncertaintyUnit) {
    return `${standard.uncertainty} ${standard.uncertaintyUnit}`
  }
  return '-'
}

function StandardsListPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')

  const limit = 20

  // Fetch standards
  const { data, isLoading, error } = useQuery({
    queryKey: ['standards', page, search, statusFilter],
    queryFn: async () => {
      const res = await api.api.standards.$get({
        query: {
          page: String(page),
          limit: String(limit),
          query: search || undefined,
          status: statusFilter || undefined,
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar padroes')
      }

      return res.json() as Promise<{
        data: Array<ReferenceStandard>
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }>
    },
  })

  // Delete (soft) mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.api.standards[':id'].$delete({
        param: { id: String(id) },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao remover',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standards'] })
      toast.success('Padrão removido com sucesso')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Status change mutation
  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: number
      status: ReferenceStandard['status']
    }) => {
      const res = await api.api.standards[':id'].$put({
        param: { id: String(id) },
        json: { status },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao atualizar status',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standards'] })
      toast.success('Status atualizado com sucesso')
    },
    onError: (error) => {
      toast.error(error.message)
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
            Erro ao carregar padroes: {error.message}
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
            <CardTitle>Padrões de Referência</CardTitle>
            <CardDescription>
              Gerencie os padrões e equipamentos de calibração do laboratório
            </CardDescription>
          </div>
          <Button
            render={
              <Link to="/dashboard/standards/new">
                <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                Novo Padrão
              </Link>
            }
          />
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <form onSubmit={handleSearch} className="flex gap-4 mb-6">
            <Input
              placeholder="Buscar por nome, série ou certificado..."
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
                  {statusFilter === 'ACTIVE'
                    ? 'Ativos'
                    : statusFilter === 'INACTIVE'
                      ? 'Inativos'
                      : statusFilter === 'OUT_OF_TOLERANCE'
                        ? 'Fora de Tolerancia'
                        : statusFilter === 'SENT_FOR_CALIBRATION'
                          ? 'Em Calibração'
                          : 'Todos os Status'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os Status</SelectItem>
                <SelectItem value="ACTIVE">Ativos</SelectItem>
                <SelectItem value="INACTIVE">Inativos</SelectItem>
                <SelectItem value="OUT_OF_TOLERANCE">
                  Fora de Tolerancia
                </SelectItem>
                <SelectItem value="SENT_FOR_CALIBRATION">
                  Em Calibração
                </SelectItem>
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
                  <HugeiconsIcon icon={UserIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum padrão encontrado</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter
                    ? 'Nenhum padrão encontrado para os filtros aplicados.'
                    : 'Comece cadastrando seu primeiro padrão de referência'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {!search && !statusFilter && (
                  <Button render={<Link to="/dashboard/standards/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Novo Padrão
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
                    <TableHead>Nome</TableHead>
                    <TableHead>N Série</TableHead>
                    <TableHead>Certificado</TableHead>
                    <TableHead>Incerteza (U)</TableHead>
                    <TableHead>Próxima Calibração</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((standard) => {
                    const calBadge = getCalibrationBadge(
                      standard.daysUntilExpiry,
                      standard.isExpired,
                    )
                    const statusBadge = getStatusBadge(standard.status)

                    return (
                      <TableRow
                        key={standard.id}
                        className={
                          standard.status === 'INACTIVE' ? 'opacity-60' : ''
                        }
                      >
                        <TableCell>
                          <Link
                            to="/dashboard/standards/$id/edit"
                            params={{ id: String(standard.id) }}
                            className="font-medium hover:underline"
                          >
                            {standard.name}
                          </Link>
                          {standard.type && (
                            <p className="text-sm text-muted-foreground">
                              {standard.type}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {standard.serialNumber}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-sm">
                            {standard.certificateNumber}
                          </span>
                          {standard.calibratedBy && (
                            <p className="text-xs text-muted-foreground">
                              {standard.calibratedBy}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {formatUncertainty(standard)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              {formatDate(standard.nextCalibrationDate)}
                            </span>
                            <Badge
                              variant={calBadge.variant}
                              className={
                                'className' in calBadge
                                  ? calBadge.className
                                  : undefined
                              }
                            >
                              {calBadge.label}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusBadge.variant}>
                            {statusBadge.label}
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
                                    to="/dashboard/standards/$id/edit"
                                    params={{ id: String(standard.id) }}
                                  >
                                    <HugeiconsIcon
                                      icon={Edit02Icon}
                                      className="mr-2 h-4 w-4"
                                    />
                                    Editar
                                  </Link>
                                )}
                              />
                              <DropdownMenuItem
                                render={() => (
                                  <Link
                                    to="/dashboard/standards/$id/edit"
                                    params={{ id: String(standard.id) }}
                                    search={{ renew: true }}
                                  >
                                    <HugeiconsIcon
                                      icon={RefreshIcon}
                                      className="mr-2 h-4 w-4"
                                    />
                                    Renovar Certificado
                                  </Link>
                                )}
                              />
                              <DropdownMenuSeparator />
                              {standard.status === 'ACTIVE' && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      statusMutation.mutate({
                                        id: standard.id,
                                        status: 'SENT_FOR_CALIBRATION',
                                      })
                                    }
                                  >
                                    <HugeiconsIcon
                                      icon={RefreshIcon}
                                      className="mr-2 h-4 w-4"
                                    />
                                    Enviar para Calibração
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      statusMutation.mutate({
                                        id: standard.id,
                                        status: 'OUT_OF_TOLERANCE',
                                      })
                                    }
                                    className="text-orange-600"
                                  >
                                    <HugeiconsIcon
                                      icon={AlertCircleIcon}
                                      className="mr-2 h-4 w-4"
                                    />
                                    Marcar Fora de Tolerancia
                                  </DropdownMenuItem>
                                </>
                              )}
                              {standard.status !== 'ACTIVE' &&
                                standard.status !== 'INACTIVE' && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      statusMutation.mutate({
                                        id: standard.id,
                                        status: 'ACTIVE',
                                      })
                                    }
                                  >
                                    <HugeiconsIcon
                                      icon={CheckmarkCircle02Icon}
                                      className="mr-2 h-4 w-4"
                                    />
                                    Reativar
                                  </DropdownMenuItem>
                                )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  deleteMutation.mutate(standard.id)
                                }
                                className="text-destructive"
                              >
                                <HugeiconsIcon
                                  icon={Cancel01Icon}
                                  className="mr-2 h-4 w-4"
                                />
                                Remover
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
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
                    de {data.pagination.total} padroes
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
