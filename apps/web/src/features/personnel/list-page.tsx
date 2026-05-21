import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { parseAsInteger, parseAsStringLiteral, useQueryState } from 'nuqs'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon, UserIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
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
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { cn } from '@/lib/utils'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import {
  COMPETENCES_LIST_LIMIT,
  useCompetencesListData,
  useCompetencesMatrixData,
} from '@/features/personnel/queries'
import {
  competenceColumns,
  getStatusBadge,
} from '@/features/personnel/components/columns'
import {
  COMPETENCE_STATUSES,
  type CompetencesMatrixData,
  type CompetenceStatus,
} from '@/features/personnel/types'
type StatusFilter = CompetenceStatus | ''
type ViewMode = 'list' | 'matrix'

const STATUS_LABELS: Record<CompetenceStatus, string> = {
  REQUESTED: 'Solicitada',
  TRAINING_ASSIGNED: 'Treinamento Atribuído',
  IN_TRAINING: 'Em Treinamento',
  PENDING_EVALUATION: 'Aguardando Avaliação',
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  EXPIRED: 'Expirada',
  CANCELLED: 'Cancelada',
}

export function PersonnelPage() {
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1))
  const [statusFilter, setStatusFilter] = useQueryState(
    'status',
    parseAsStringLiteral([...COMPETENCE_STATUSES, '']).withDefault(''),
  )
  const [viewMode, setViewMode] = useState<ViewMode>('list')

  const { data, isLoading, error } = useCompetencesListData({
    activeOrganizationId,
    enabled:
      Boolean(activeOrganizationId) &&
      !isContextSwitching &&
      viewMode === 'list',
    page,
    limit: COMPETENCES_LIST_LIMIT,
    statusFilter,
  })

  const { data: matrixData, isLoading: matrixLoading } =
    useCompetencesMatrixData({
      activeOrganizationId,
      enabled:
        Boolean(activeOrganizationId) &&
        !isContextSwitching &&
        viewMode === 'matrix',
    })

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar competências: {error.message}
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
            <CardTitle>Competências do Pessoal</CardTitle>
            <CardDescription>Gestão de qualificações</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border">
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('list')}
              >
                Lista
              </Button>
              <Button
                variant={viewMode === 'matrix' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('matrix')}
              >
                Matriz
              </Button>
            </div>
            <Button
              render={
                <Link to="/dashboard/personnel/new">
                  <HugeiconsIcon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                  Nova Solicitação
                </Link>
              }
            />
          </div>
        </CardHeader>
        <CardContent className="min-w-0">
          {viewMode === 'list' ? (
            <>
              {/* Filters */}
              <div className="flex gap-4 mb-6">
                <Select
                  value={statusFilter}
                  onValueChange={(v) => {
                    setStatusFilter(v as StatusFilter)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="w-56">
                    <span>
                      {statusFilter
                        ? STATUS_LABELS[statusFilter]
                        : 'Todos os Status'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Todos os Status</SelectItem>
                    {(Object.keys(STATUS_LABELS) as CompetenceStatus[]).map(
                      (status) => (
                        <SelectItem key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                {statusFilter && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setStatusFilter('')
                      setPage(1)
                    }}
                  >
                    Limpar filtros
                  </Button>
                )}
              </div>

              {/* Empty State */}
              {!isLoading && data?.data.length === 0 ? (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon icon={UserIcon} />
                    </EmptyMedia>
                    <EmptyTitle>Nenhuma competência encontrada</EmptyTitle>
                    <EmptyDescription>
                      {statusFilter
                        ? 'Nenhuma competência encontrada para o filtro aplicado.'
                        : 'Nenhuma competência registrada. Crie a primeira solicitação de qualificação.'}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    {!statusFilter && (
                      <Button render={<Link to="/dashboard/personnel/new" />}>
                        <HugeiconsIcon
                          icon={PlusSignIcon}
                          className="mr-2 size-4"
                        />
                        Nova Solicitação
                      </Button>
                    )}
                    {statusFilter && (
                      <Button
                        variant="outline"
                        onClick={() => {
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
                  columns={competenceColumns}
                  data={data?.data ?? []}
                  isLoading={isLoading}
                  pagination={data?.pagination}
                  onPageChange={setPage}
                />
              )}
            </>
          ) : (
            /* Matrix View */
            <MatrixView data={matrixData} isLoading={matrixLoading} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MatrixView({
  data,
  isLoading,
}: {
  data: CompetencesMatrixData | undefined
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        Carregando matriz...
      </p>
    )
  }

  if (!data || data.technicians.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={UserIcon} />
          </EmptyMedia>
          <EmptyTitle>Nenhum técnico encontrado</EmptyTitle>
          <EmptyDescription>
            Adicione membros com papel de técnico para visualizar a matriz de
            competências.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (data.assetTypes.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={UserIcon} />
          </EmptyMedia>
          <EmptyTitle>Nenhum tipo de instrumento cadastrado</EmptyTitle>
          <EmptyDescription>
            Cadastre tipos de instrumentos para visualizar a matriz de
            competências.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const getCell = (userId: string, assetTypeId: number) => {
    return data.competences.find(
      (c) => c.userId === userId && c.assetTypeId === assetTypeId,
    )
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-auto">
      <table className="min-w-max text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 px-2 font-medium sticky left-0 bg-background">
              Técnico
            </th>
            {data.assetTypes.map((at) => (
              <th
                key={at.id}
                className="text-center py-3 px-2 font-medium min-w-[120px]"
              >
                {at.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.technicians.map((tech) => (
            <tr key={tech.userId} className="border-b last:border-b-0">
              <td className="py-3 px-2 font-medium sticky left-0 bg-background">
                {tech.userName}
              </td>
              {data.assetTypes.map((at) => {
                const comp = getCell(tech.userId, at.id)
                if (!comp) {
                  return (
                    <td key={at.id} className="text-center py-3 px-2">
                      <span className="text-muted-foreground">-</span>
                    </td>
                  )
                }
                const badge = getStatusBadge(comp.status)
                return (
                  <td key={at.id} className="text-center py-3 px-2">
                    <Link
                      to="/dashboard/personnel/$id"
                      params={{ id: String(comp.id) }}
                    >
                      <Badge
                        variant={badge.variant}
                        className={cn('cursor-pointer', badge.className)}
                      >
                        {badge.label}
                      </Badge>
                    </Link>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
