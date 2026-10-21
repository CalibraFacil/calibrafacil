import { renderToStaticMarkup } from 'react-dom/server'
import {
  createTable,
  flexRender,
  getCoreRowModel,
  type ColumnDef,
} from '@tanstack/react-table'
import { describe, expect, it } from 'vitest'

import { assetsColumns, type Asset } from '@/features/assets/components/columns'
import {
  buildAssetCalibrationStatus,
  formatDate as formatAssetDate,
} from '@/features/assets/detail-model'
import { formatDueDate } from '@/features/dashboard/dashboard-model'
import { formatTimelineDate } from '@/features/customers/financial-timeline-model'
import { InstallmentsBlock } from '@/features/finance/installments-block'
import { jobsColumns } from '@/features/jobs/components/columns'
import type { Job } from '@/features/jobs/types'
import { formatDate as formatServiceOrderDate } from '@/features/service-orders/detail-model'
import { dateOnlyToLocalDate } from '@/lib/date-only'

// REQ-CAL-001: the calendar-date columns are Postgres `date` columns, so the
// API always returns them as UTC midnight of the day they name ("2026-10-15T00:
// 00:00.000Z"). Read in the browser's zone (America/Sao_Paulo, pinned by the
// vitest global setup) that instant is the EVENING BEFORE, so every screen must
// show it by the day it names.

const STORED = '2026-10-15T00:00:00.000Z'

/** A row of a table definition, from the few fields a cell reads. */
function rowOf<T>(fields: object): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a table cell only reads the fields the test sets; building every field of a list item would hide what is under test.
  return fields as T
}

/** Renders one cell of a table definition, as the table would. */
function renderCell<T extends object>(
  columns: ColumnDef<T>[],
  accessorKey: string,
  data: T,
): string {
  const table = createTable<T>({
    data: [data],
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {},
    onStateChange: () => {},
    renderFallbackValue: null,
  })
  table.setOptions((previous) => ({
    ...previous,
    state: { ...table.initialState },
  }))
  const [row] = table.getRowModel().rows
  const cell = row?.getVisibleCells().find((candidate) => {
    const def = candidate.column.columnDef
    return 'accessorKey' in def && def.accessorKey === accessorKey
  })
  if (!cell) throw new Error(`no ${accessorKey} column`)
  return renderToStaticMarkup(
    flexRender(cell.column.columnDef.cell, cell.getContext()),
  )
}

describe('stored calendar dates show on the day they name (REQ-CAL-001)', () => {
  it('shows a job due date in the jobs table', () => {
    const html = renderCell(
      jobsColumns,
      'dueDate',
      rowOf<Job>({
        id: 1,
        jobId: 'CAL-1',
        status: 'DRAFT',
        dueDate: STORED,
        isOverdue: false,
        daysUntilDue: 0,
      }),
    )
    expect(html).toContain('15/10/2026')
    expect(html).not.toContain('14/10/2026')
  })

  it("shows an instrument's next calibration in the assets table", () => {
    const html = renderCell(
      assetsColumns,
      'nextCalibrationDate',
      rowOf<Asset>({ nextCalibrationDate: STORED }),
    )
    expect(html).toBe('15/10/2026')
  })

  it("shows an instrument's calibration dates on its detail screen", () => {
    expect(formatAssetDate(STORED)).toBe('15/10/2026')
    expect(formatAssetDate('2026-10-15T15:00:00.000Z')).toBe('15/10/2026')
    expect(formatAssetDate(null)).toBe('—')
  })

  it("counts an instrument's days to the next calibration by the day it names", () => {
    // 09:00 on the 15th in Sao Paulo: due today, not yesterday.
    const today = new Date('2026-10-15T12:00:00.000Z')
    const status = buildAssetCalibrationStatus(
      { status: 'ACTIVE', nextCalibrationDate: STORED },
      today,
    )
    expect(status.daysUntilNext).toBe(0)
    expect(status.level).toBe('due_soon')
    // The evening before (22:00 on the 14th in Sao Paulo): one day to go.
    expect(
      buildAssetCalibrationStatus(
        { status: 'ACTIVE', nextCalibrationDate: STORED },
        new Date('2026-10-15T01:00:00.000Z'),
      ).daysUntilNext,
    ).toBe(1)
  })

  it('reads a job due date as today on its own day (dashboard)', () => {
    expect(
      formatDueDate(STORED, false, new Date('2026-10-15T12:00:00.000Z')),
    ).toBe('Hoje')
    expect(
      formatDueDate(STORED, false, new Date('2026-10-14T12:00:00.000Z')),
    ).toBe('Amanhã')
    expect(
      formatDueDate(STORED, false, new Date('2026-10-16T12:00:00.000Z')),
    ).toBe('Atrasada há 1 dia')
  })

  it('shows an installment due date and a document due date', () => {
    const html = renderToStaticMarkup(
      <InstallmentsBlock
        installments={[
          {
            id: 7,
            installmentNumber: 1,
            status: 'OPEN',
            label: 'Parcela 1',
            amountCents: 10_000,
            currency: 'BRL',
            dueDate: STORED,
            paidAt: null,
            paymentMethod: null,
          },
        ]}
        summary={{
          total: 1,
          openCount: 1,
          paidCount: 0,
          overdueCount: 0,
          voidCount: 0,
          totalCents: 10_000,
          openCents: 10_000,
          paidCents: 0,
          overdueCents: 0,
        }}
      />,
    )
    expect(html).toContain('Vencimento 15/10/2026')
    expect(formatTimelineDate(STORED)).toBe('15/10/2026')
    expect(formatServiceOrderDate(STORED)).toBe('15/10/2026')
  })

  it('prefills a date picker with the day the value names, as a local date', () => {
    const picked = dateOnlyToLocalDate(STORED)
    expect(picked?.getFullYear()).toBe(2026)
    expect(picked?.getMonth()).toBe(9)
    expect(picked?.getDate()).toBe(15)
    expect(picked?.getHours()).toBe(0)
    // Saving it again names the same day for the laboratory.
    expect(picked?.toISOString()).toBe('2026-10-15T03:00:00.000Z')
    expect(dateOnlyToLocalDate(null)).toBeUndefined()
    expect(dateOnlyToLocalDate('not a date')).toBeUndefined()
  })
})
