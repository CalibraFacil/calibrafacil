import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowRight02Icon,
  PieChartIcon,
} from '@hugeicons/core-free-icons'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { api } from '@/utils/api'
import { useDashboardContextState } from './route'
import { SectionCards } from './-components/section-cards'
import { ChartCalibrations } from './-components/chart-calibrations'
import { Button } from '@/components/ui/button'
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
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const DASHBOARD_UNIT_KEY_PREFIX = 'dashboard-active-unit:'

type ReportPeriod = '7d' | '30d' | '90d' | 'month'
type ComparisonSortKey =
  | 'unitName'
  | 'jobsCreatedInPeriod'
  | 'approvedInPeriod'
  | 'rejectedInPeriod'
  | 'pendingNow'
  | 'overdueNow'
  | 'approvalRate'

type UnitOption = {
  id: number
  name: string
  slug: string
}

type ExecutiveOverviewResponse = {
  period: ReportPeriod
  label: string
  range: {
    startDate: string
    endDate: string
  }
  availableUnits: UnitOption[]
  selectedUnits: UnitOption[]
  scopeSummary: {
    label: string
    description: string
    unitsIncluded: number
    isAllUnits: boolean
  }
  metrics: {
    pendingCalibrations: number
    approvedInPeriod: number
    rejectedInPeriod: number
    approvalRate: number
    overdueJobs: number
    expiringStandards: number
    unitsIncluded: number
    atRiskUnitsCount: number
  }
  highlights: {
    highestVolumeUnit: {
      unitId: number
      unitName: string
      jobsCreatedInPeriod: number
    } | null
    bestApprovalUnit: {
      unitId: number
      unitName: string
      approvalRate: number
      approvedInPeriod: number
    } | null
    attentionUnit: {
      unitId: number
      unitName: string
      healthStatus: 'healthy' | 'attention' | 'critical'
      healthReason: string
      overdueNow: number
      rejectedInPeriod: number
      expiringStandardsSoon: number
    } | null
  }
}

function getHealthBadgeVariant(status: ComparisonResponse['rows'][number]['healthStatus']) {
  if (status === 'critical') return 'destructive' as const
  if (status === 'attention') return 'secondary' as const
  return 'outline' as const
}

function getHealthLabel(status: ComparisonResponse['rows'][number]['healthStatus']) {
  if (status === 'critical') return 'Crítica'
  if (status === 'attention') return 'Atenção'
  return 'Saudável'
}

type TrendResponse = {
  period: ReportPeriod
  label: string
  availableUnits: UnitOption[]
  selectedUnits: UnitOption[]
  data: Array<{
    date: string
    approved: number
    rejected: number
  }>
}

type ComparisonResponse = {
  period: ReportPeriod
  label: string
  availableUnits: UnitOption[]
  selectedUnits: UnitOption[]
  rows: Array<{
    unitId: number
    unitName: string
    unitSlug: string
    jobsCreatedInPeriod: number
    approvedInPeriod: number
    rejectedInPeriod: number
    pendingNow: number
    overdueNow: number
    expiringStandardsSoon: number
    approvalRate: number
    healthStatus: 'healthy' | 'attention' | 'critical'
    healthReason: string
  }>
}

export const Route = createFileRoute('/dashboard/reports')({
  head: () => ({
    meta: [{ title: 'Relatórios Consolidados | CalibraFácil' }],
  }),
  component: ConsolidatedReportsPage,
})

function ConsolidatedReportsPage() {
  const navigate = useNavigate()
  const { data: activeOrg } = useActiveOrganization()
  const { activeOrganizationId, isContextSwitching } = useDashboardContextState()
  const [period, setPeriod] = useState<ReportPeriod>('30d')
  const [selectedUnitIds, setSelectedUnitIds] = useState<number[]>([])
  const [sortKey, setSortKey] = useState<ComparisonSortKey>('jobsCreatedInPeriod')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const currentRole =
    typeof activeOrg?.members?.[0]?.role === 'string'
      ? activeOrg.members[0].role
      : 'member'
  const canAccessReports = currentRole === 'owner' || currentRole === 'admin'
  const unitIdsParam =
    selectedUnitIds.length > 0 ? selectedUnitIds.join(',') : undefined

  const executiveQuery = useQuery({
    queryKey: [
      'reports',
      'executive-overview',
      activeOrganizationId ?? 'no-org',
      period,
      unitIdsParam ?? 'all',
    ],
    enabled: !isContextSwitching && canAccessReports,
    queryFn: async () => {
      const res = await api.api.reports.consolidated['executive-overview'].$get({
        query: {
          period,
          unitIds: unitIdsParam,
        },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao carregar visão executiva',
        )
      }

      return res.json() as Promise<ExecutiveOverviewResponse>
    },
  })

  const comparisonQuery = useQuery({
    queryKey: [
      'reports',
      'comparison',
      activeOrganizationId ?? 'no-org',
      period,
      unitIdsParam ?? 'all',
    ],
    enabled: !isContextSwitching && canAccessReports,
    queryFn: async () => {
      const res = await api.api.reports.consolidated.comparison.$get({
        query: {
          period,
          unitIds: unitIdsParam,
        },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao carregar comparativo consolidado',
        )
      }

      return res.json() as Promise<ComparisonResponse>
    },
  })

  const trendQuery = useQuery({
    queryKey: [
      'reports',
      'trend',
      activeOrganizationId ?? 'no-org',
      period,
      unitIdsParam ?? 'all',
    ],
    enabled: !isContextSwitching && canAccessReports,
    queryFn: async () => {
      const res = await api.api.reports.consolidated.trend.$get({
        query: {
          period,
          unitIds: unitIdsParam,
        },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : 'Falha ao carregar tendência consolidada',
        )
      }

      return res.json() as Promise<TrendResponse>
    },
  })

  const availableUnits = executiveQuery.data?.availableUnits ?? []
  const effectiveSelectedUnitIds =
    selectedUnitIds.length > 0
      ? selectedUnitIds
      : availableUnits.map((unit) => unit.id)

  const sortedRows = useMemo(() => {
    const rows = [...(comparisonQuery.data?.rows ?? [])]

    rows.sort((a, b) => {
      const aValue = a[sortKey]
      const bValue = b[sortKey]

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue, 'pt-BR')
          : bValue.localeCompare(aValue, 'pt-BR')
      }

      const left = Number(aValue)
      const right = Number(bValue)
      return sortDirection === 'asc' ? left - right : right - left
    })

    return rows
  }, [comparisonQuery.data?.rows, sortDirection, sortKey])

  const isLoading =
    executiveQuery.isPending || comparisonQuery.isPending || trendQuery.isPending

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

  if (!canAccessReports) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Acesso restrito</CardTitle>
          <CardDescription>
            Relatórios consolidados ficam disponíveis apenas para administradores
            globais da organização.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (executiveQuery.error || comparisonQuery.error || trendQuery.error) {
    const error =
      executiveQuery.error ?? comparisonQuery.error ?? trendQuery.error ?? null

    return (
      <Card>
        <CardHeader>
          <CardTitle>Falha ao carregar relatórios</CardTitle>
          <CardDescription>
            {error instanceof Error
              ? error.message
              : 'Não foi possível carregar o consolidado multiunidade.'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const toggleUnit = (unitId: number) => {
    const currentSelection =
      selectedUnitIds.length > 0
        ? selectedUnitIds
        : availableUnits.map((unit) => unit.id)

    const nextSelection = currentSelection.includes(unitId)
      ? currentSelection.filter((id) => id !== unitId)
      : [...currentSelection, unitId]

    if (nextSelection.length === 0) {
      return
    }

    if (nextSelection.length === availableUnits.length) {
      setSelectedUnitIds([])
      return
    }

    setSelectedUnitIds(nextSelection.sort((a, b) => a - b))
  }

  const clearUnitFilter = () => {
    setSelectedUnitIds([])
  }

  const handleSort = (key: ComparisonSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortKey(key)
    setSortDirection(key === 'unitName' ? 'asc' : 'desc')
  }

  const handleDrilldown = async (unitId: number) => {
    if (!activeOrg?.id) return

    window.localStorage.setItem(
      `${DASHBOARD_UNIT_KEY_PREFIX}${activeOrg.id}`,
      String(unitId),
    )

    await navigate({ to: '/dashboard' })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Relatórios Consolidados
          </h1>
          <p className="text-muted-foreground">
            Visão executiva multiunidade para{' '}
            {executiveQuery.data?.label ?? 'o período selecionado'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['7d', '30d', '90d', 'month'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={period === value ? 'default' : 'outline'}
              onClick={() => setPeriod(value)}
            >
              {value === '7d'
                ? '7 dias'
                : value === '30d'
                  ? '30 dias'
                  : value === '90d'
                    ? '90 dias'
                    : 'Mês atual'}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={PieChartIcon} className="size-5" />
            Recorte executivo
          </CardTitle>
          <CardDescription>
            Compare todas as unidades ou reduza o consolidado para um subconjunto específico.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && availableUnits.length === 0 ? (
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3].map((item) => (
                <Skeleton key={item} className="h-9 w-28" />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableUnits.map((unit) => {
                const isSelected = effectiveSelectedUnitIds.includes(unit.id)

                return (
                  <Button
                    key={unit.id}
                    type="button"
                    size="sm"
                    variant={isSelected ? 'default' : 'outline'}
                    onClick={() => toggleUnit(unit.id)}
                  >
                    {unit.name}
                  </Button>
                )
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>
              {selectedUnitIds.length === 0
                ? 'Comparando todas as unidades ativas.'
                : `Comparando ${effectiveSelectedUnitIds.length} unidade(s).`}
            </span>
            {selectedUnitIds.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearUnitFilter}
              >
                Limpar filtro
              </Button>
            ) : null}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {executiveQuery.data?.scopeSummary.label ?? 'Consolidado'}
                </Badge>
                <Badge variant="outline">
                  {executiveQuery.data?.metrics.unitsIncluded ?? 0} unidade(s)
                </Badge>
                <Badge
                  variant={
                    (executiveQuery.data?.metrics.atRiskUnitsCount ?? 0) > 0
                      ? 'destructive'
                      : 'outline'
                  }
                >
                  {executiveQuery.data?.metrics.atRiskUnitsCount ?? 0} em risco
                </Badge>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {executiveQuery.data?.scopeSummary.description ??
                  'Leitura gerencial do recorte consolidado atual.'}
              </p>
            </div>

            <div className="rounded-xl border p-4">
              <p className="text-sm font-medium">Janela analisada</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {executiveQuery.data
                  ? `${new Intl.DateTimeFormat('pt-BR', {
                      dateStyle: 'medium',
                    }).format(new Date(executiveQuery.data.range.startDate))} até ${new Intl.DateTimeFormat(
                      'pt-BR',
                      {
                        dateStyle: 'medium',
                      },
                    ).format(new Date(executiveQuery.data.range.endDate))}`
                  : 'Período selecionado'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <SectionCards
        pendingCalibrations={
          executiveQuery.data?.metrics.pendingCalibrations ?? 0
        }
        approvedThisMonth={executiveQuery.data?.metrics.approvedInPeriod ?? 0}
        expiringStandards={executiveQuery.data?.metrics.expiringStandards ?? 0}
        approvalRate={executiveQuery.data?.metrics.approvalRate ?? 0}
        overdueJobs={executiveQuery.data?.metrics.overdueJobs ?? 0}
        isLoading={isLoading}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <ExecutiveHighlightCard
          title="Maior volume"
          description="Unidade com maior carga de OS no período."
          value={
            executiveQuery.data?.highlights.highestVolumeUnit?.unitName ??
            'Sem destaque'
          }
          supporting={
            executiveQuery.data?.highlights.highestVolumeUnit
              ? `${executiveQuery.data.highlights.highestVolumeUnit.jobsCreatedInPeriod} OS no período`
              : 'Nenhuma unidade com volume registrado.'
          }
        />
        <ExecutiveHighlightCard
          title="Melhor taxa"
          description="Maior taxa de aprovação dentro do recorte atual."
          value={
            executiveQuery.data?.highlights.bestApprovalUnit?.unitName ??
            'Sem decisões'
          }
          supporting={
            executiveQuery.data?.highlights.bestApprovalUnit
              ? `${executiveQuery.data.highlights.bestApprovalUnit.approvalRate.toFixed(1)}% · ${executiveQuery.data.highlights.bestApprovalUnit.approvedInPeriod} aprovações`
              : 'Nenhuma unidade com decisões suficientes.'
          }
          tone="positive"
        />
        <ExecutiveHighlightCard
          title="Precisa de atenção"
          description="Maior foco de risco executivo no consolidado."
          value={
            executiveQuery.data?.highlights.attentionUnit?.unitName ??
            'Sem alertas'
          }
          supporting={
            executiveQuery.data?.highlights.attentionUnit?.healthReason ??
            'Nenhuma unidade em atenção neste período.'
          }
          tone={
            executiveQuery.data?.highlights.attentionUnit?.healthStatus ===
            'critical'
              ? 'critical'
              : executiveQuery.data?.highlights.attentionUnit?.healthStatus ===
                  'attention'
                ? 'warning'
                : 'default'
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <ChartCalibrations
          data={trendQuery.data?.data ?? []}
          isLoading={isLoading}
        />

        <Card>
          <CardHeader>
            <CardTitle>Leitura do período</CardTitle>
            <CardDescription>
              Corte de {executiveQuery.data?.label ?? 'período selecionado'} com foco em throughput, risco e qualidade.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((item) => (
                  <Skeleton key={item} className="h-14 w-full" />
                ))}
              </div>
            ) : (
              <>
                <SummaryMetric
                  label="Aprovadas no período"
                  value={executiveQuery.data?.metrics.approvedInPeriod ?? 0}
                  tone="positive"
                />
                <SummaryMetric
                  label="Rejeitadas no período"
                  value={executiveQuery.data?.metrics.rejectedInPeriod ?? 0}
                  tone="critical"
                />
                <SummaryMetric
                  label="Pendentes agora"
                  value={executiveQuery.data?.metrics.pendingCalibrations ?? 0}
                />
                <SummaryMetric
                  label="Unidades em risco"
                  value={executiveQuery.data?.metrics.atRiskUnitsCount ?? 0}
                  tone={
                    (executiveQuery.data?.metrics.atRiskUnitsCount ?? 0) > 0
                      ? 'warning'
                      : 'default'
                  }
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Comparativo por Unidade</CardTitle>
          <CardDescription>
            Ranking executivo do período selecionado com estado de saúde por unidade e drill-down direto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ComparisonTable
            rows={sortedRows}
            sortDirection={sortDirection}
            sortKey={sortKey}
            isLoading={isLoading}
            onSort={handleSort}
            onDrilldown={handleDrilldown}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'positive' | 'warning' | 'critical'
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            'text-2xl font-semibold tabular-nums',
            tone === 'positive' && 'text-green-600 dark:text-green-500',
            tone === 'warning' && 'text-amber-600 dark:text-amber-500',
            tone === 'critical' && 'text-destructive',
          )}
        >
          {value}
        </p>
      </div>
    </div>
  )
}

function ExecutiveHighlightCard({
  title,
  description,
  value,
  supporting,
  tone = 'default',
}: {
  title: string
  description: string
  value: string
  supporting: string
  tone?: 'default' | 'positive' | 'warning' | 'critical'
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            'text-xl font-semibold',
            tone === 'positive' && 'text-green-600 dark:text-green-500',
            tone === 'warning' && 'text-amber-600 dark:text-amber-500',
            tone === 'critical' && 'text-destructive',
          )}
        >
          {value}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{supporting}</p>
      </CardContent>
    </Card>
  )
}

function ComparisonTable({
  rows,
  sortKey,
  sortDirection,
  isLoading,
  onSort,
  onDrilldown,
}: {
  rows: ComparisonResponse['rows']
  sortKey: ComparisonSortKey
  sortDirection: 'asc' | 'desc'
  isLoading: boolean
  onSort: (key: ComparisonSortKey) => void
  onDrilldown: (unitId: number) => void
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        Nenhuma unidade disponível para o comparativo selecionado.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead
            label="Unidade"
            column="unitName"
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={onSort}
          />
          <TableHead>Saúde</TableHead>
          <SortableHead
            label="Volume"
            column="jobsCreatedInPeriod"
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={onSort}
            align="right"
          />
          <SortableHead
            label="Aprovadas"
            column="approvedInPeriod"
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={onSort}
            align="right"
          />
          <SortableHead
            label="Rejeitadas"
            column="rejectedInPeriod"
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={onSort}
            align="right"
          />
          <SortableHead
            label="Pendentes"
            column="pendingNow"
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={onSort}
            align="right"
          />
          <SortableHead
            label="Atrasadas"
            column="overdueNow"
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={onSort}
            align="right"
          />
          <TableHead className="text-right">Padrões</TableHead>
          <SortableHead
            label="Taxa de aprovação"
            column="approvalRate"
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={onSort}
            align="right"
          />
          <TableHead className="w-28 text-right">Drill-down</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.unitId}>
            <TableCell>
              <div className="space-y-1">
                <p className="font-medium">{row.unitName}</p>
                <p className="text-xs text-muted-foreground">{row.unitSlug}</p>
              </div>
            </TableCell>
            <TableCell>
              <div className="space-y-1">
                <Badge variant={getHealthBadgeVariant(row.healthStatus)}>
                  {getHealthLabel(row.healthStatus)}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  {row.healthReason}
                </p>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.jobsCreatedInPeriod}
            </TableCell>
            <TableCell className="text-right tabular-nums text-green-600 dark:text-green-500">
              {row.approvedInPeriod}
            </TableCell>
            <TableCell className="text-right tabular-nums text-destructive">
              {row.rejectedInPeriod}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.pendingNow}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <Badge variant={row.overdueNow > 0 ? 'destructive' : 'outline'}>
                {row.overdueNow}
              </Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <Badge
                variant={
                  row.expiringStandardsSoon > 0 ? 'secondary' : 'outline'
                }
              >
                {row.expiringStandardsSoon}
              </Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.approvalRate.toFixed(1)}%
            </TableCell>
            <TableCell className="text-right">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onDrilldown(row.unitId)}
              >
                Abrir
                <HugeiconsIcon icon={ArrowRight02Icon} className="ml-1 size-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SortableHead({
  label,
  column,
  sortKey,
  sortDirection,
  onSort,
  align = 'left',
}: {
  label: string
  column: ComparisonSortKey
  sortKey: ComparisonSortKey
  sortDirection: 'asc' | 'desc'
  onSort: (key: ComparisonSortKey) => void
  align?: 'left' | 'right'
}) {
  const isActive = sortKey === column

  return (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
          align === 'right' && 'ml-auto',
          isActive && 'text-foreground',
        )}
        onClick={() => onSort(column)}
      >
        <span>{label}</span>
        {isActive ? (
          <HugeiconsIcon
            icon={sortDirection === 'asc' ? ArrowUp01Icon : ArrowDown01Icon}
            className="size-3.5"
          />
        ) : null}
      </button>
    </TableHead>
  )
}
