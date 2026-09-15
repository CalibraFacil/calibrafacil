import type { Table } from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import { Settings02Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function columnLabel(meta: unknown, fallback: string): string {
  if (
    meta !== null &&
    typeof meta === 'object' &&
    'label' in meta &&
    typeof meta.label === 'string'
  ) {
    return meta.label
  }
  return fallback
}

/** Column visibility toggle for a TanStack table (columns with enableHiding). */
export function DataTableViewOptions<TData>({
  table,
}: {
  table: Table<TData>
}) {
  const hideable = table.getAllColumns().filter((column) => column.getCanHide())

  if (hideable.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="ml-auto" />}
      >
        <HugeiconsIcon icon={Settings02Icon} className="mr-2 size-4" />
        Colunas
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Exibir colunas</DropdownMenuLabel>
          {hideable.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(value) =>
                column.toggleVisibility(value === true)
              }
            >
              {columnLabel(column.columnDef.meta, column.id)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
