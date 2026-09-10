import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowRight02Icon,
  Building02Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  MultiplicationSignIcon,
  Target02Icon,
} from '@hugeicons/core-free-icons'

import { useActiveOrganization } from '@calibra-facil/auth/client'
import { useDashboardContextState } from '@/contexts/dashboard-context'
import { ChartCalibrations } from '@/features/dashboard/components/chart-calibrations'
import { Button } from '@/components/ui/button'
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
import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import { cn } from '@/lib/utils'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { setStoredDashboardActiveUnitIdForOrganization } from '@/features/dashboard/dashboard-scope-storage'
import {
  useComparisonReportData,
  useExecutiveReportData,
  useTrendReportData,
} from '@/features/reports/queries'
import type {
  ComparisonResponse,
  ReportPeriod,
  ReportsQueryInput,
} from '@/features/reports/types'
import {
  formatReportRange,
  getEffectiveSelectedUnitIds,
  getHealthBadgeVariant,
  getHealthLabel,
  getNextComparisonSort,
  getNextSelectedUnitIds,
  REPORT_PERIOD_LABELS,
  REPORT_PERIOD_OPTIONS,
  sortComparisonRows,
  type ComparisonSortKey,
  type SortDirection,
} from '@/features/reports/model'

export function ConsolidatedReportsPage() {
  const navigate = useNavigate()
  const { data: activeOrg } = useActiveOrganization()
  const { activeOrganizationId, isContextSwitching } =
    useDashboardContextState()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const [period, setPeriod] = useState<ReportPeriod>('30d')
  const [selectedUnitIds, setSelectedUnitIds] = useState<number[]>([])
  const [sortKey, setSortKey] = useState<ComparisonSortKey>(
    'jobsCreatedInPeriod',
  )
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const currentRole =
    typeof activeOrg?.members?.[0]?.role === 'string'
      ? activeOrg.members[0].role
      : 'member'
  const canAccessReports = currentRole === 'owner' || currentRole === 'admin'
  const unitIdsParam =
    selectedUnitIds.length > 0 ? selectedUnitIds.join(',') : undefined
  const reportsInput = {
    organizationId: activeOrganizationId,
    period,
    unitIds: unitIdsParam,
  } satisfies ReportsQueryInput
  const reportsEnabled =
    !isContextSwitching && canAccessReports && !cloudOnlyUnavailable

  const executiveQuery = useExecutiveReportData({
    input: reportsInput,
    enabled: reportsEnabled,
  })

  const comparisonQuery = useComparisonReportData({
    input: reportsInput,
    enabled: reportsEnabled,
  })

  const trendQuery = useTrendReportData({
    input: reportsInput,
    enabled: reportsEnabled,
  })

  const availableUnits = executiveQuery.data?.availableUnits ?? []
  const effectiveSelectedUnitIds = getEffectiveSelectedUnitIds(
    selectedUnitIds,
    availableUnits,
  )

  const sortedRows = useMemo(() => {
    return sortComparisonRows({
      rows: comparisonQuery.data?.rows ?? [],
      sortKey,
      sortDirection,
    })
  }, [comparisonQuery.data?.rows, sortDirection, sortKey])

  const isLoading =
    executiveQuery.isPending ||
    comparisonQuery.isPending ||
    trendQuery.isPending

  if (isContextSwitching) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Carregando o contexto da organização ativa.
        </p>
      </Panel>
    )
  }

  if (!canAccessReports) {
    return (
      <Panel className="p-6 sm:p-8">
        <PanelHeader
          title="Relatórios consolidados"
          description="Disponíveis apenas para administradores globais da organização."
        />
      </Panel>
    )
  }

  if (cloudOnlyUnavailable) {
    return <CloudOnlyOfflineState title="Relatórios indisponíveis offline" />
  }

  if (executiveQuery.error || comparisonQuery.error || trendQuery.error) {
    const error =
      executiveQuery.error ?? comparisonQuery.error ?? trendQuery.error ?? null

    return (
      <Panel className="p-8 text-center">
        <p className="text-sm font-medium">Falha ao carregar relatórios</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : 'Não foi possível carregar o consolidado multiunidade.'}
        </p>
      </Panel>
    )
  }

  const toggleUnit = (unitId: number) => {
    setSelectedUnitIds((current) =>
      getNextSelectedUnitIds({
        unitId,
        selectedUnitIds: current,
        availableUnits,
      }),
    )
  }

  const clearUnitFilter = () => {
    setSelectedUnitIds([])
  }

  const handleSort = (key: ComparisonSortKey) => {
    const next = getNextComparisonSort({
      currentSortKey: sortKey,
      currentSortDirection: sortDirection,
      nextSortKey: key,
    })
    setSortKey(next.sortKey)
    setSortDirection(next.sortDirection)
  }

  const handleDrilldown = async (unitId: number) => {
    if (!activeOrg?.id) return

    setStoredDashboardActiveUnitIdForOrganization(activeOrg.id, String(unitId))

    await navigate({ to: '/dashboard' })
  }

  const metrics = executiveQuery.data?.metrics
  const scope = executiveQuery.data?.scopeSummary

  const metricTiles: Array<{
    icon: Parameters<typeof HugeiconsIcon>[0]['icon']
    label: string
    value: string
    hint?: string
    tone: SignalTone
  }> = [
    {
      icon: Clock01Icon,
      label: 'Pendentes',
      value: String(metrics?.pendingCalibrations ?? 0),
      hint: 'agora',
      tone: 'neutral',
    },
    {
      icon: CheckmarkCircle02Icon,
      label: 'Aprovadas',
      value: String(metrics?.approvedInPeriod ?? 0),
      hint: 'no período',
      tone: 'neutral',
    },
    {
      icon: MultiplicationSignIcon,
      label: 'Rejeitadas',
      value: String(metrics?.rejectedInPeriod ?? 0),
      hint: 'no período',
      tone: (metrics?.rejectedInPeriod ?? 0) > 0 ? 'critical' : 'neutral',
    },
    {
      icon: Target02Icon,
      label: 'Taxa de aprovação',
      value: `${(metrics?.approvalRate ?? 0).toFixed(0)}%`,
      hint: 'aprovação',
      tone: 'ok',
    },
    {
      icon: Alert02Icon,
      label: 'Atrasadas',
      value: String(metrics?.overdueJobs ?? 0),
      hint: 'jobs',
      tone: (metrics?.overdueJobs ?? 0) > 0 ? 'warning' : 'neutral',
    },
    {
      icon: Calendar03Icon,
      label: 'Padrões vencendo',
      value: String(metrics?.expiringStandards ?? 0),
      hint: 'em breve',
      tone: (metrics?.expiringStandards ?? 0) > 0 ? 'warning' : 'neutral',
    },
    {
      icon: Building02Icon,
      label: 'Unidades em risco',
      value: String(metrics?.atRiskUnitsCount ?? 0),
      hint: `de ${metrics?.unitsIncluded ?? 0}`,
      tone: (metrics?.atRiskUnitsCount ?? 0) > 0 ? 'critical' : 'neutral',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Hero: scope, period, unit filter, and the canonical metrics (shown once) */}
      <Panel className="relative overflow-hidden">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Relatórios consolidados
              </p>
              <h1 className="text-balance text-2xl font-semibold tracking-tight">
                Visão executiva multiunidade
              </h1>
              <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                {scope?.label ?? 'Consolidado'} ·{' '}
                {formatReportRange(executiveQuery.data?.range)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {REPORT_PERIOD_OPTIONS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={period === value ? 'default' : 'outline'}
                  onClick={() => setPeriod(value)}
                  className={ACTION_BUTTON_CLASS}
                >
                  {REPORT_PERIOD_LABELS[value]}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2 border-t border-foreground/10 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Unidades
              </span>
              {isLoading && availableUnits.length === 0
                ? [1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-8 w-24 rounded-lg" />
                  ))
                : availableUnits.map((unit) => {
                    const isSelected = effectiveSelectedUnitIds.includes(
                      unit.id,
                    )
                    return (
                      <Button
                        key={unit.id}
                        type="button"
                        size="sm"
                        variant={isSelected ? 'default' : 'outline'}
                        onClick={() => toggleUnit(unit.id)}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {unit.name}
                      </Button>
                    )
                  })}
              {selectedUnitIds.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={clearUnitFilter}
                  className={ACTION_BUTTON_CLASS}
                >
                  Limpar
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedUnitIds.length === 0
                ? `Comparando todas as ${metrics?.unitsIncluded ?? availableUnits.length} unidade(s) ativas.`
                : `Comparando ${effectiveSelectedUnitIds.length} unidade(s).`}
            </p>
          </div>

          {isLoading ? (
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              {Array.from({ length: 7 }).map((_item, index) => (
                <Skeleton key={index} className="h-[88px] rounded-xl" />
              ))}
            </div>
          ) : (
            <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              {metricTiles.map((tile) => (
                <StaggerItem key={tile.label}>
                  <SignalTile
                    icon={tile.icon}
                    label={tile.label}
                    value={tile.value}
                    hint={tile.hint}
                    tone={tile.tone}
                  />
                </StaggerItem>
              ))}
            </StaggerGroup>
          )}
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-3">
        <ExecutiveHighlightCard
          title="Maior volume"
          description="Unidade com maior carga de calibrações no período."
          value={
            executiveQuery.data?.highlights.highestVolumeUnit?.unitName ??
            'Sem destaque'
          }
          supporting={
            executiveQuery.data?.highlights.highestVolumeUnit
              ? `${executiveQuery.data.highlights.highestVolumeUnit.jobsCreatedInPeriod} calibrações no período`
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

      <ChartCalibrations
        data={trendQuery.data?.data ?? []}
        isLoading={isLoading}
      />

      <Panel className="p-4 sm:p-5">
        <PanelHeader
          title="Comparativo por unidade"
          description="Estado de saúde por unidade no período, com drill-down direto."
        />
        <div className="mt-4">
          <ComparisonTable
            rows={sortedRows}
            sortDirection={sortDirection}
            sortKey={sortKey}
            isLoading={isLoading}
            onSort={handleSort}
            onDrilldown={handleDrilldown}
          />
        </div>
      </Panel>
    </div>
  )
}

function ExecutiveHighlightCard({
  title,
  value,
  supporting,
  tone = 'default',
}: {
  title: string
  description?: string
  value: string
  supporting: string
  tone?: 'default' | 'positive' | 'warning' | 'critical'
}) {
  return (
    <Panel className="p-4 sm:p-5">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      <p
        className={cn(
          'mt-2 text-lg font-semibold',
          tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
          tone === 'critical' && 'text-destructive',
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-pretty text-sm text-muted-foreground">
        {supporting}
      </p>
    </Panel>
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
                <HugeiconsIcon
                  icon={ArrowRight02Icon}
                  className="ml-1 size-4"
                />
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
