// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ColumnDef } from '@tanstack/react-table'

import { DataTable } from './data-table'

type Row = {
  id: number
  name: string
}

const columns: Array<ColumnDef<Row>> = [
  {
    accessorKey: 'name',
    header: 'Nome',
  },
]

describe('DataTable row interactions', () => {
  it('activates clickable rows with the keyboard', () => {
    const onRowClick = vi.fn()
    render(
      <DataTable
        columns={columns}
        data={[{ id: 1, name: 'NC-001' }]}
        onRowClick={onRowClick}
      />,
    )

    const row = screen.getByText('NC-001').closest('tr')
    expect(row).not.toBeNull()

    fireEvent.keyDown(row!, { key: 'Enter' })

    expect(onRowClick).toHaveBeenCalledWith({ id: 1, name: 'NC-001' })
  })

  it('does not trigger row clicks from nested interactive controls', () => {
    const onRowClick = vi.fn()
    render(
      <DataTable
        columns={[
          {
            id: 'action',
            header: 'Ação',
            cell: () => <button type="button">Abrir menu</button>,
          },
        ]}
        data={[{ id: 1, name: 'NC-001' }]}
        onRowClick={onRowClick}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))

    expect(onRowClick).not.toHaveBeenCalled()
  })
})
