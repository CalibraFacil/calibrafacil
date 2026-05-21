import type {
  ComparisonResponse,
  ReportPeriod,
  ReportUnitOption,
} from './types'

export type ComparisonSortKey =
  | 'unitName'
  | 'jobsCreatedInPeriod'
  | 'approvedInPeriod'
  | 'rejectedInPeriod'
  | 'pendingNow'
  | 'overdueNow'
  | 'approvalRate'

export type SortDirection = 'asc' | 'desc'

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
  month: 'Mês atual',
}

export const REPORT_PERIOD_OPTIONS = Object.keys(
  REPORT_PERIOD_LABELS,
) as ReportPeriod[]

export function getHealthBadgeVariant(
  status: ComparisonResponse['rows'][number]['healthStatus'],
) {
  if (status === 'critical') return 'destructive' as const
  if (status === 'attention') return 'secondary' as const
  return 'outline' as const
}

export function getHealthLabel(
  status: ComparisonResponse['rows'][number]['healthStatus'],
) {
  if (status === 'critical') return 'Crítica'
  if (status === 'attention') return 'Atenção'
  return 'Saudável'
}

export function getEffectiveSelectedUnitIds(
  selectedUnitIds: number[],
  availableUnits: ReportUnitOption[],
) {
  return selectedUnitIds.length > 0
    ? selectedUnitIds
    : availableUnits.map((unit) => unit.id)
}

export function getNextSelectedUnitIds({
  unitId,
  selectedUnitIds,
  availableUnits,
}: {
  unitId: number
  selectedUnitIds: number[]
  availableUnits: ReportUnitOption[]
}) {
  const currentSelection = getEffectiveSelectedUnitIds(
    selectedUnitIds,
    availableUnits,
  )

  const nextSelection = currentSelection.includes(unitId)
    ? currentSelection.filter((id) => id !== unitId)
    : [...currentSelection, unitId]

  if (nextSelection.length === 0) {
    return selectedUnitIds
  }

  if (nextSelection.length === availableUnits.length) {
    return []
  }

  return nextSelection.sort((a, b) => a - b)
}

export function sortComparisonRows({
  rows,
  sortKey,
  sortDirection,
}: {
  rows: ComparisonResponse['rows']
  sortKey: ComparisonSortKey
  sortDirection: SortDirection
}) {
  return [...rows].sort((a, b) => {
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
}

export function getNextComparisonSort({
  currentSortKey,
  currentSortDirection,
  nextSortKey,
}: {
  currentSortKey: ComparisonSortKey
  currentSortDirection: SortDirection
  nextSortKey: ComparisonSortKey
}): { sortKey: ComparisonSortKey; sortDirection: SortDirection } {
  if (currentSortKey === nextSortKey) {
    return {
      sortKey: currentSortKey,
      sortDirection: currentSortDirection === 'asc' ? 'desc' : 'asc',
    }
  }

  return {
    sortKey: nextSortKey,
    sortDirection: nextSortKey === 'unitName' ? 'asc' : 'desc',
  }
}

export function formatReportRange(
  range: { startDate: string; endDate: string } | null | undefined,
) {
  if (!range) return 'Período selecionado'

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
  })

  return `${formatter.format(new Date(range.startDate))} até ${formatter.format(
    new Date(range.endDate),
  )}`
}
