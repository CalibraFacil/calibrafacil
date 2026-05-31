// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'

import { FinanceDataTable } from './finance-data-table'

type Row = { id: string; name: string; status: string }

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', id: 'name', header: 'Nome', meta: { label: 'Nome' } },
  {
    accessorKey: 'status',
    id: 'status',
    header: 'Status',
    filterFn: 'arrIncludesSome',
    meta: { label: 'Status' },
  },
]

const data: Row[] = [
  { id: '1', name: 'Alpha', status: 'OPEN' },
  { id: '2', name: 'Beta', status: 'PAID' },
]

afterEach(cleanup)

describe('FinanceDataTable', () => {
  // Guards against runtime crashes from the toolbar (e.g. the column-visibility
  // menu must mount without "MenuGroupRootContext is missing").
  it('renders rows, the search box and the column-visibility control', () => {
    render(
      <FinanceDataTable
        columns={columns}
        data={data}
        getRowId={(row) => row.id}
        facets={[
          {
            columnId: 'status',
            title: 'Status',
            options: [
              { value: 'OPEN', label: 'Aberto' },
              { value: 'PAID', label: 'Pago' },
            ],
          },
        ]}
      />,
    )

    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('Colunas')).toBeTruthy()
  })

  it('renders the empty state when there is no data', () => {
    render(
      <FinanceDataTable
        columns={columns}
        data={[]}
        getRowId={(row) => row.id}
        emptyState="Nada aqui."
      />,
    )
    expect(screen.getByText('Nada aqui.')).toBeTruthy()
  })
})
