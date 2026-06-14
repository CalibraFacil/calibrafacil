import { type ColumnDef } from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import { Building03Icon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import type { CustomerGroupsListData } from '@calibra-facil/client-runtime'

export type CustomerGroupRow = CustomerGroupsListData['data'][number]

export const customerGroupsColumns: ColumnDef<CustomerGroupRow>[] = [
  {
    accessorKey: 'name',
    header: 'Nome',
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/10"
        >
          <HugeiconsIcon icon={Building03Icon} className="size-4" />
        </span>
        <span className="font-medium">{row.original.name}</span>
      </div>
    ),
  },
  {
    accessorKey: 'branchCount',
    header: 'Unidades',
    cell: ({ row }) => (
      <Badge variant="secondary" className="font-mono tabular-nums">
        {row.original.branchCount}{' '}
        {row.original.branchCount === 1 ? 'unidade' : 'unidades'}
      </Badge>
    ),
  },
]
