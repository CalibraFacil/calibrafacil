import { describe, expect, it } from 'vitest'

import type { ComparisonResponse, ReportUnitOption } from './types'
import {
  formatReportRange,
  getEffectiveSelectedUnitIds,
  getHealthBadgeVariant,
  getHealthLabel,
  getNextComparisonSort,
  getNextSelectedUnitIds,
  REPORT_PERIOD_LABELS,
  sortComparisonRows,
} from './model'

const units: ReportUnitOption[] = [
  { id: 1, name: 'Matriz', slug: 'matriz' },
  { id: 2, name: 'Sul', slug: 'sul' },
  { id: 3, name: 'Norte', slug: 'norte' },
]

describe('reports model', () => {
  it('maps report period and health labels', () => {
    expect(REPORT_PERIOD_LABELS['30d']).toBe('30 dias')
    expect(getHealthLabel('critical')).toBe('Crítica')
    expect(getHealthBadgeVariant('critical')).toBe('destructive')
    expect(getHealthLabel('attention')).toBe('Atenção')
    expect(getHealthBadgeVariant('healthy')).toBe('outline')
  })

  it('derives effective and next selected unit filters', () => {
    expect(getEffectiveSelectedUnitIds([], units)).toEqual([1, 2, 3])
    expect(getEffectiveSelectedUnitIds([2], units)).toEqual([2])

    expect(
      getNextSelectedUnitIds({
        unitId: 2,
        selectedUnitIds: [],
        availableUnits: units,
      }),
    ).toEqual([1, 3])
    expect(
      getNextSelectedUnitIds({
        unitId: 3,
        selectedUnitIds: [1, 2],
        availableUnits: units,
      }),
    ).toEqual([])
    expect(
      getNextSelectedUnitIds({
        unitId: 1,
        selectedUnitIds: [1],
        availableUnits: units,
      }),
    ).toEqual([1])
  })

  it('sorts comparison rows by strings and numbers', () => {
    const rows: ComparisonResponse['rows'] = [
      comparisonRow({ unitId: 1, unitName: 'Sul', approvalRate: 80 }),
      comparisonRow({ unitId: 2, unitName: 'Matriz', approvalRate: 95 }),
    ]

    expect(
      sortComparisonRows({
        rows,
        sortKey: 'unitName',
        sortDirection: 'asc',
      }).map((row) => row.unitName),
    ).toEqual(['Matriz', 'Sul'])
    expect(
      sortComparisonRows({
        rows,
        sortKey: 'approvalRate',
        sortDirection: 'desc',
      }).map((row) => row.approvalRate),
    ).toEqual([95, 80])
    expect(rows.map((row) => row.unitName)).toEqual(['Sul', 'Matriz'])
  })

  it('derives next sort state and formats report ranges', () => {
    expect(
      getNextComparisonSort({
        currentSortKey: 'approvalRate',
        currentSortDirection: 'desc',
        nextSortKey: 'approvalRate',
      }),
    ).toEqual({ sortKey: 'approvalRate', sortDirection: 'asc' })
    expect(
      getNextComparisonSort({
        currentSortKey: 'approvalRate',
        currentSortDirection: 'asc',
        nextSortKey: 'unitName',
      }),
    ).toEqual({ sortKey: 'unitName', sortDirection: 'asc' })
    expect(formatReportRange(null)).toBe('Período selecionado')
    expect(
      formatReportRange({
        startDate: '2026-05-01T00:00:00.000Z',
        endDate: '2026-05-20T00:00:00.000Z',
      }),
    ).toBe('1 de mai. de 2026 até 20 de mai. de 2026')
  })
})

function comparisonRow(
  overrides: Partial<ComparisonResponse['rows'][number]>,
): ComparisonResponse['rows'][number] {
  return {
    unitId: 1,
    unitName: 'Matriz',
    unitSlug: 'matriz',
    jobsCreatedInPeriod: 10,
    approvedInPeriod: 8,
    rejectedInPeriod: 1,
    pendingNow: 2,
    overdueNow: 0,
    expiringStandardsSoon: 0,
    approvalRate: 80,
    healthStatus: 'healthy',
    healthReason: 'Sem alertas',
    ...overrides,
  }
}
